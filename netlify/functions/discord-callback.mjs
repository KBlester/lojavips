import crypto from 'crypto';

const DEFAULT_CLIENT_ID = '1548916664895144046';

function getDiscordConfig() {
  const clientId = String(
    process.env.DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  ).trim();

  const redirectUri =
    'https://sapucaia-rj-lojaa-ofical.netlify.app/api/discord-callback';

  return {
    clientId,
    redirectUri
  };
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));

  return (
    aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb)
  );
}

function verifySignedState(state, secret) {
  try {
    const parts = String(state || '').split('.');

    if (parts.length !== 2) {
      return {
        valid: false,
        reason: 'state não possui o formato esperado.'
      };
    }

    const [encodedPayload, signature] = parts;

    if (!encodedPayload || !signature) {
      return {
        valid: false,
        reason: 'state está incompleto.'
      };
    }

    const payload = Buffer
      .from(encodedPayload, 'base64url')
      .toString('utf8');

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    if (
      !safeEqual(
        signature,
        expectedSignature
      )
    ) {
      return {
        valid: false,
        reason: 'assinatura do state é inválida.'
      };
    }

    const separator = payload.indexOf('.');

    if (separator === -1) {
      return {
        valid: false,
        reason: 'payload do state está inválido.'
      };
    }

    const issuedAt = Number(
      payload.slice(0, separator)
    );

    if (!Number.isFinite(issuedAt)) {
      return {
        valid: false,
        reason: 'data de emissão do state é inválida.'
      };
    }

    const age = Date.now() - issuedAt;

    if (age > 10 * 60 * 1000) {
      return {
        valid: false,
        reason: 'state expirou há mais de 10 minutos.'
      };
    }

    if (age < -60 * 1000) {
      return {
        valid: false,
        reason: 'data do state está mais de 1 minuto no futuro.'
      };
    }

    return {
      valid: true,
      reason: 'state válido.'
    };
  } catch (error) {
    return {
      valid: false,
      reason:
        error?.message ||
        String(error)
    };
  }
}

async function readDiscordResponse(response) {
  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    text,
    data
  };
}

function diagnosticResponse(stage, details, status = 502) {
  return new Response(
    JSON.stringify(
      {
        ok: false,
        diagnostic: true,
        stage,
        time: new Date().toISOString(),
        ...details
      },
      null,
      2
    ),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store, no-cache, must-revalidate',
        pragma: 'no-cache'
      }
    }
  );
}

export default async (req) => {
  console.log(
    '========== DISCORD CALLBACK =========='
  );

  console.log(
    'METHOD:',
    req.method
  );

  console.log(
    'URL:',
    req.url
  );

  try {
    /*
     * =========================================================
     * ETAPA 1 — MÉTODO
     * =========================================================
     */

    if (req.method !== 'GET') {
      console.error(
        '[1] Método HTTP inválido:',
        req.method
      );

      return diagnosticResponse(
        'method_check',
        {
          message:
            'O callback recebeu um método diferente de GET.',
          method: req.method
        },
        405
      );
    }

    /*
     * =========================================================
     * ETAPA 2 — PARÂMETROS DO DISCORD
     * =========================================================
     */

    const url = new URL(req.url);

    const code = String(
      url.searchParams.get('code') || ''
    ).trim();

    const state = String(
      url.searchParams.get('state') || ''
    ).trim();

    const discordError = String(
      url.searchParams.get('error') || ''
    ).trim();

    const discordErrorDescription = String(
      url.searchParams.get('error_description') || ''
    ).trim();

    console.log(
      '[2] Callback recebido:',
      {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasDiscordError: Boolean(discordError),
        hasDiscordErrorDescription:
          Boolean(discordErrorDescription)
      }
    );

    /*
     * IMPORTANTE:
     * Não exibimos o code nem o state completo.
     */

    if (discordError) {
      console.error(
        '[2] Discord devolveu erro diretamente:',
        {
          error: discordError,
          error_description:
            discordErrorDescription || null
        }
      );

      return diagnosticResponse(
        'discord_authorization',
        {
          message:
            'O Discord recusou ou cancelou a autorização.',
          discord_error: discordError,
          discord_error_description:
            discordErrorDescription || null
        },
        400
      );
    }

    if (!code || !state) {
      console.error(
        '[2] Code ou state ausente:',
        {
          hasCode: Boolean(code),
          hasState: Boolean(state)
        }
      );

      return diagnosticResponse(
        'callback_parameters',
        {
          message:
            'O callback foi chamado sem code e/ou state.',
          has_code: Boolean(code),
          has_state: Boolean(state)
        },
        400
      );
    }

    /*
     * =========================================================
     * ETAPA 3 — CONFIGURAÇÃO
     * =========================================================
     */

    const {
      clientId,
      redirectUri
    } = getDiscordConfig();

    const clientSecret = String(
      process.env.DISCORD_CLIENT_SECRET || ''
    ).trim();

    const sessionSecret = String(
      process.env.DISCORD_SESSION_SECRET || ''
    ).trim();

    console.log(
      '[3] Configuração:',
      {
        clientId: clientId
          ? 'CONFIGURADO'
          : 'AUSENTE',
        clientSecret:
          clientSecret
            ? 'CONFIGURADO'
            : 'AUSENTE',
        sessionSecret:
          sessionSecret
            ? 'CONFIGURADO'
            : 'AUSENTE',
        redirectUri
      }
    );

    if (!clientSecret || !sessionSecret) {
      console.error(
        '[3] Variáveis de ambiente ausentes.'
      );

      return diagnosticResponse(
        'server_configuration',
        {
          message:
            'As variáveis necessárias do Discord não estão configuradas.',
          client_id_configured:
            Boolean(clientId),
          client_secret_configured:
            Boolean(clientSecret),
          session_secret_configured:
            Boolean(sessionSecret),
          redirect_uri:
            redirectUri
        },
        503
      );
    }

    /*
     * =========================================================
     * ETAPA 4 — VALIDAR STATE
     * =========================================================
     */

    console.log(
      '[4] Validando state...'
    );

    const stateResult =
      verifySignedState(
        state,
        sessionSecret
      );

    console.log(
      '[4] Resultado do state:',
      {
        valid: stateResult.valid,
        reason: stateResult.reason
      }
    );

    if (!stateResult.valid) {
      console.error(
        '[4] STATE INVÁLIDO:',
        stateResult.reason
      );

      return diagnosticResponse(
        'state_validation',
        {
          message:
            'O state enviado pelo Discord não passou na validação.',
          reason:
            stateResult.reason
        },
        400
      );
    }

    /*
     * =========================================================
     * ETAPA 5 — TROCA DO CODE PELO TOKEN
     * =========================================================
     */

    console.log(
      '[5] Iniciando troca do authorization code com o Discord...'
    );

    const basicCredentials = Buffer
      .from(
        `${clientId}:${clientSecret}`,
        'utf8'
      )
      .toString('base64');

    const tokenBody =
      new URLSearchParams({
        grant_type:
          'authorization_code',
        code,
        redirect_uri:
          redirectUri
      });

    console.log(
      '[5] Enviando requisição para:',
      'https://discord.com/api/v10/oauth2/token'
    );

    const tokenRes = await fetch(
      'https://discord.com/api/v10/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
          Accept:
            'application/json',
          Authorization:
            `Basic ${basicCredentials}`
        },
        body:
          tokenBody.toString()
      }
    );

    const tokenResponse =
      await readDiscordResponse(
        tokenRes
      );

    const tokenData =
      tokenResponse.data || {};

    console.log(
      '[5] Resposta do Discord:',
      {
        status:
          tokenResponse.status,
        statusText:
          tokenResponse.statusText,
        ok:
          tokenResponse.ok,
        hasAccessToken:
          Boolean(
            tokenData.access_token
          ),
        error:
          tokenData.error || null,
        error_description:
          tokenData.error_description ||
          null
      }
    );

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      console.error(
        '[5] FALHA NA TROCA DO TOKEN:',
        {
          status:
            tokenResponse.status,
          error:
            tokenData.error || null,
          error_description:
            tokenData.error_description ||
            null,
          response:
            tokenResponse.text
        }
      );

      return diagnosticResponse(
        'token_exchange',
        {
          message:
            'O Discord recusou a troca do authorization code pelo access token.',
          http_status:
            tokenResponse.status,
          http_status_text:
            tokenResponse.statusText,
          discord_error:
            tokenData.error || null,
          discord_error_description:
            tokenData.error_description ||
            null,
          discord_response:
            tokenData &&
            Object.keys(tokenData).length
              ? tokenData
              : tokenResponse.text
        },
        502
      );
    }

    console.log(
      '[5] TOKEN OBTIDO COM SUCESSO.'
    );

    /*
     * =========================================================
     * ETAPA 6 — BUSCAR USUÁRIO
     * =========================================================
     */

    console.log(
      '[6] Buscando usuário no Discord...'
    );

    const userRes = await fetch(
      'https://discord.com/api/v10/users/@me',
      {
        headers: {
          Authorization:
            `Bearer ${tokenData.access_token}`,
          Accept:
            'application/json'
        }
      }
    );

    const userResponse =
      await readDiscordResponse(
        userRes
      );

    const user =
      userResponse.data || {};

    console.log(
      '[6] Resposta do usuário:',
      {
        status:
          userResponse.status,
        ok:
          userResponse.ok,
        hasId:
          Boolean(user.id),
        hasUsername:
          Boolean(user.username),
        hasEmail:
          Boolean(user.email)
      }
    );

    if (
      !userResponse.ok ||
      !user.id
    ) {
      console.error(
        '[6] FALHA AO BUSCAR USUÁRIO:',
        {
          status:
            userResponse.status,
          error:
            user.error || null,
          message:
            user.message || null,
          response:
            userResponse.text
        }
      );

      return diagnosticResponse(
        'user_lookup',
        {
          message:
            'O token foi obtido, mas o Discord não permitiu buscar o usuário.',
          http_status:
            userResponse.status,
          http_status_text:
            userResponse.statusText,
          discord_response:
            user &&
            Object.keys(user).length
              ? user
              : userResponse.text
        },
        502
      );
    }

    console.log(
      '[6] Usuário obtido com sucesso:',
      {
        id:
          String(user.id),
        username:
          String(user.username || ''),
        hasGlobalName:
          Boolean(user.global_name),
        hasEmail:
          Boolean(user.email),
        hasAvatar:
          Boolean(user.avatar)
      }
    );

    /*
     * =========================================================
     * ETAPA 7 — CRIAR SESSÃO
     * =========================================================
     */

    console.log(
      '[7] Criando sessão do usuário...'
    );

    const now = Date.now();

    const sessionData = {
      id:
        String(user.id),

      username:
        String(user.username || ''),

      global_name:
        String(
          user.global_name ||
          user.username ||
          ''
        ),

      email:
        user.email || null,

      avatar:
        user.avatar || null,

      iat:
        now,

      exp:
        now +
        30 * 24 * 60 * 60 * 1000
    };

    const payload =
      Buffer
        .from(
          JSON.stringify(
            sessionData
          ),
          'utf8'
        )
        .toString(
          'base64url'
        );

    const signature =
      crypto
        .createHmac(
          'sha256',
          sessionSecret
        )
        .update(payload)
        .digest(
          'base64url'
        );

    const sessionToken =
      `${payload}.${signature}`;

    console.log(
      '[7] Sessão criada com sucesso.'
    );

    /*
     * =========================================================
     * ETAPA 8 — COOKIES
     * =========================================================
     */

    const headers =
      new Headers({
        'content-type':
          'text/html; charset=utf-8',

        'cache-control':
          'no-store, no-cache, must-revalidate',

        Pragma:
          'no-cache'
      });

    headers.append(
      'Set-Cookie',
      cookie(
        'sapucaia_discord_session',
        sessionToken,
        30 * 24 * 60 * 60
      )
    );

    headers.append(
      'Set-Cookie',
      cookie(
        'sapucaia_oauth_state',
        '',
        0
      )
    );

    console.log(
      '[8] Cookies de sessão preparados.'
    );

    /*
     * =========================================================
     * ETAPA 9 — REDIRECIONAMENTO
     * =========================================================
     */

    const html = `
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <meta
    http-equiv="Cache-Control"
    content="no-store"
  >
  <title>Discord conectado</title>
</head>

<body style="
  background:#06060a;
  color:#fff;
  font-family:Arial,sans-serif;
  display:grid;
  place-items:center;
  min-height:100vh;
  margin:0;
">

  <div style="
    text-align:center;
    padding:24px;
  ">
    <h2>Discord conectado ✅</h2>
    <p>Redirecionando para a loja...</p>
  </div>

  <script>
    window.location.replace(
      '/?discord=connected'
    );
  </script>

</body>
</html>
`;

    console.log(
      '[9] Discord conectado com sucesso. Redirecionando para a loja.'
    );

    console.log(
      '========== DISCORD CALLBACK FINALIZADO =========='
    );

    return new Response(
      html,
      {
        status: 200,
        headers
      }
    );

  } catch (error) {

    /*
     * =========================================================
     * ERRO INESPERADO
     * =========================================================
     */

    console.error(
      '========== ERRO INESPERADO NO CALLBACK =========='
    );

    console.error(
      'MESSAGE:',
      error?.message || null
    );

    console.error(
      'NAME:',
      error?.name || null
    );

    console.error(
      'STACK:',
      error?.stack || null
    );

    return diagnosticResponse(
      'unexpected_error',
      {
        message:
          'Ocorreu um erro inesperado dentro do callback.',
        error_name:
          error?.name || null,
        error_message:
          error?.message ||
          String(error),
        error_stack:
          error?.stack || null
      },
      500
    );
  }
};
