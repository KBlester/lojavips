import crypto from 'crypto';

const CLIENT_ID = '1548916664895144046';

const REDIRECT_URI =
  'https://sapucaia-rj-lojaa-ofical.netlify.app/api/discord-callback';

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
      return false;
    }

    const [encodedPayload, signature] = parts;

    if (!encodedPayload || !signature) {
      return false;
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
      return false;
    }

    const separator = payload.indexOf('.');

    if (separator === -1) {
      return false;
    }

    const issuedAt = Number(
      payload.slice(0, separator)
    );

    if (!Number.isFinite(issuedAt)) {
      return false;
    }

    const age = Date.now() - issuedAt;

    if (age > 10 * 60 * 1000) {
      return false;
    }

    if (age < -60 * 1000) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store, no-cache, must-revalidate',
        Pragma:
          'no-cache',
        ...extraHeaders
      }
    }
  );
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

export default async (req) => {
  console.log(
    '========== SAPUCAIA DISCORD CALLBACK =========='
  );

  console.log(
    'METHOD:',
    req.method
  );

  try {
    if (req.method !== 'GET') {
      console.error(
        'Método inválido:',
        req.method
      );

      return json(
        {
          ok: false,
          stage: 'method',
          message:
            'O callback precisa receber uma requisição GET.',
          method: req.method
        },
        405
      );
    }

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
      'CALLBACK RECEBIDO:',
      {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasDiscordError: Boolean(discordError)
      }
    );

    /*
     * =====================================================
     * DISCORD CANCELou / RECUSOU A AUTORIZAÇÃO
     * =====================================================
     */

    if (discordError) {
      console.error(
        'Discord retornou erro de autorização:',
        discordError,
        discordErrorDescription
      );

      return json(
        {
          ok: false,
          stage: 'discord_authorization',
          message:
            'O Discord recusou ou cancelou a autorização.',
          discord_error:
            discordError,
          discord_error_description:
            discordErrorDescription || null
        },
        400
      );
    }

    /*
     * =====================================================
     * CODE + STATE
     * =====================================================
     */

    if (!code || !state) {
      console.error(
        'Code ou state ausente:',
        {
          hasCode: Boolean(code),
          hasState: Boolean(state)
        }
      );

      return json(
        {
          ok: false,
          stage: 'callback_parameters',
          message:
            'O Discord chegou ao callback, mas não enviou code e state.',
          has_code:
            Boolean(code),
          has_state:
            Boolean(state)
        },
        400
      );
    }

    /*
     * =====================================================
     * VARIÁVEIS DO NETLIFY
     * =====================================================
     */

    const clientSecret = String(
      process.env.DISCORD_CLIENT_SECRET || ''
    ).trim();

    const sessionSecret = String(
      process.env.DISCORD_SESSION_SECRET || ''
    ).trim();

    console.log(
      'CONFIGURAÇÃO:',
      {
        clientId:
          CLIENT_ID,
        clientSecret:
          clientSecret
            ? 'OK'
            : 'AUSENTE',
        sessionSecret:
          sessionSecret
            ? 'OK'
            : 'AUSENTE',
        redirectUri:
          REDIRECT_URI
      }
    );

    if (!clientSecret) {
      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_CLIENT_SECRET não está configurado no Netlify.'
        },
        503
      );
    }

    if (!sessionSecret) {
      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_SESSION_SECRET não está configurado no Netlify.'
        },
        503
      );
    }

    /*
     * =====================================================
     * VALIDAR STATE
     * =====================================================
     */

    console.log(
      'VALIDANDO STATE...'
    );

    const validState =
      verifySignedState(
        state,
        sessionSecret
      );

    console.log(
      'STATE VÁLIDO:',
      validState
    );

    if (!validState) {
      return json(
        {
          ok: false,
          stage: 'state_validation',
          message:
            'O state recebido do Discord é inválido, expirou ou foi assinado com outro DISCORD_SESSION_SECRET.'
        },
        400
      );
    }

    /*
     * =====================================================
     * TROCA DO CODE PELO TOKEN
     * =====================================================
     */

    console.log(
      'INICIANDO TOKEN EXCHANGE...'
    );

    const basicCredentials =
      Buffer
        .from(
          `${CLIENT_ID}:${clientSecret}`,
          'utf8'
        )
        .toString('base64');

    const tokenBody =
      new URLSearchParams({
        grant_type:
          'authorization_code',

        code,

        redirect_uri:
          REDIRECT_URI
      });

    const tokenRes =
      await fetch(
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
      'TOKEN RESPONSE:',
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
        'TOKEN EXCHANGE FALHOU:',
        tokenResponse.text
      );

      return json(
        {
          ok: false,
          stage: 'token_exchange',

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
      'TOKEN OBTIDO COM SUCESSO.'
    );

    /*
     * =====================================================
     * BUSCAR USUÁRIO
     * =====================================================
     */

    console.log(
      'BUSCANDO USUÁRIO DO DISCORD...'
    );

    const userRes =
      await fetch(
        'https://discord.com/api/v10/users/@me',
        {
          method: 'GET',

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
      'USER RESPONSE:',
      {
        status:
          userResponse.status,

        ok:
          userResponse.ok,

        hasId:
          Boolean(user.id),

        hasUsername:
          Boolean(user.username)
      }
    );

    if (
      !userResponse.ok ||
      !user.id
    ) {
      console.error(
        'FALHA AO OBTER USUÁRIO:',
        userResponse.text
      );

      return json(
        {
          ok: false,
          stage: 'user_lookup',

          message:
            'O token foi obtido, mas não foi possível obter o usuário do Discord.',

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

    /*
     * =====================================================
     * CRIAR SESSÃO
     * =====================================================
     */

    console.log(
      'CRIANDO SESSÃO...'
    );

    const now =
      Date.now();

    const sessionData = {
      id:
        String(user.id),

      username:
        String(
          user.username || ''
        ),

      global_name:
        String(
          user.global_name ||
          user.username ||
          ''
        ),

      email:
        user.email ||
        null,

      avatar:
        user.avatar ||
        null,

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

    /*
     * =====================================================
     * COOKIES
     * =====================================================
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
      'SESSÃO CRIADA.'
    );

    /*
     * =====================================================
     * SUCESSO
     * =====================================================
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

    <h2>
      Discord conectado
    </h2>

    <p>
      Redirecionando para a loja...
    </p>

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
      '========== DISCORD LOGIN CONCLUÍDO =========='
    );

    return new Response(
      html,
      {
        status: 200,
        headers
      }
    );

  } catch (error) {

    console.error(
      '========== ERRO INESPERADO =========='
    );

    console.error(
      'NAME:',
      error?.name || null
    );

    console.error(
      'MESSAGE:',
      error?.message ||
      String(error)
    );

    console.error(
      'STACK:',
      error?.stack || null
    );

    return json(
      {
        ok: false,

        stage:
          'unexpected_error',

        message:
          'Ocorreu um erro inesperado dentro do callback do Discord.',

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
