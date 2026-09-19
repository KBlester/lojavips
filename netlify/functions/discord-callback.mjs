import * as crypto from 'node:crypto';

const DEFAULT_CLIENT_ID = '1548916664895144046';

const DISCORD_REDIRECT_URI =
  'https://sapucaia-rj-lojaa-ofical.netlify.app/api/discord-callback';

function getDiscordConfig() {
  const clientId = String(
    process.env.DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  ).trim();

  return {
    clientId,
    redirectUri: DISCORD_REDIRECT_URI
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

    // Estado válido durante 10 minutos.
    if (age > 10 * 60 * 1000) {
      return false;
    }

    // Pequena tolerância para diferença de relógio.
    if (age < -60 * 1000) {
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      'Discord state verification error:',
      error?.message || error
    );

    return false;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      }
    }
  );
}

async function readDiscordResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text.slice(0, 500)
    };
  }
}

export default async (req) => {
  try {
    if (req.method !== 'GET') {
      return new Response(
        'Método não permitido.',
        {
          status: 405,
          headers: {
            Allow: 'GET',
            'content-type':
              'text/plain; charset=utf-8'
          }
        }
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

    /*
     * O próprio Discord pode retornar o usuário para o callback
     * com ?error=access_denied, etc.
     */
    if (discordError) {
      console.error(
        'Discord authorization error:',
        {
          error: discordError,
          error_description:
            discordErrorDescription || null
        }
      );

      return new Response(
        'Autorização do Discord cancelada ou recusada.',
        {
          status: 400,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache'
          }
        }
      );
    }

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

    if (!clientSecret || !sessionSecret) {
      console.error(
        'Discord OAuth incompleto: falta DISCORD_CLIENT_SECRET ou DISCORD_SESSION_SECRET.'
      );

      return new Response(
        'Discord OAuth não configurado corretamente no servidor.',
        {
          status: 503,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store'
          }
        }
      );
    }

    if (!clientId) {
      console.error(
        'Discord OAuth incompleto: DISCORD_CLIENT_ID vazio.'
      );

      return new Response(
        'Discord OAuth não configurado corretamente no servidor.',
        {
          status: 503,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store'
          }
        }
      );
    }

    if (!code || !state) {
      return new Response(
        'Autorização do Discord inválida ou expirada.',
        {
          status: 400,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store'
          }
        }
      );
    }

    if (
      !verifySignedState(
        state,
        sessionSecret
      )
    ) {
      console.error(
        'Discord OAuth: state inválido ou expirado.'
      );

      return new Response(
        'Autorização do Discord inválida ou expirada.',
        {
          status: 400,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store'
          }
        }
      );
    }

    /*
     * ============================================================
     * 1. TROCA DO CODE PELO ACCESS TOKEN
     * ============================================================
     *
     * IMPORTANTE:
     * O redirect_uri precisa ser exatamente o mesmo usado
     * durante o início da autorização e cadastrado no Discord.
     */
    const tokenParams = new URLSearchParams();

    tokenParams.set(
      'client_id',
      clientId
    );

    tokenParams.set(
      'client_secret',
      clientSecret
    );

    tokenParams.set(
      'grant_type',
      'authorization_code'
    );

    tokenParams.set(
      'code',
      code
    );

    tokenParams.set(
      'redirect_uri',
      redirectUri
    );

    const tokenRes = await fetch(
      'https://discord.com/api/v10/oauth2/token',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
          Accept:
            'application/json'
        },

        body: tokenParams.toString()
      }
    );

    const tokenBody =
      await readDiscordResponse(tokenRes);

    if (
      !tokenRes.ok ||
      !tokenBody.access_token
    ) {
      /*
       * NÃO registrar:
       * - client_secret
       * - authorization code
       * - access_token
       *
       * Registramos somente a resposta de erro devolvida
       * pelo Discord.
       */
      console.error(
        'Discord token exchange failed:',
        {
          status: tokenRes.status,
          statusText: tokenRes.statusText,
          error:
            tokenBody.error || null,
          error_description:
            tokenBody.error_description || null
        }
      );

      /*
       * Retorna um identificador seguro do erro para facilitar
       * o diagnóstico no navegador sem expor nenhum segredo.
       */
      const safeError =
        String(
          tokenBody.error || 'unknown_error'
        )
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 80);

      return new Response(
        `Não foi possível concluir a autorização do Discord.${safeError ? ` Erro: ${safeError}.` : ''}`,
        {
          status: 502,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store, no-cache, must-revalidate',
            Pragma:
              'no-cache'
          }
        }
      );
    }

    const accessToken =
      String(
        tokenBody.access_token
      ).trim();

    /*
     * ============================================================
     * 2. BUSCAR USUÁRIO DO DISCORD
     * ============================================================
     */
    const userRes = await fetch(
      'https://discord.com/api/v10/users/@me',
      {
        method: 'GET',

        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          Accept:
            'application/json'
        }
      }
    );

    const user =
      await readDiscordResponse(userRes);

    if (
      !userRes.ok ||
      !user.id
    ) {
      console.error(
        'Discord user lookup failed:',
        {
          status: userRes.status,
          statusText: userRes.statusText,
          error:
            user.error || null,
          message:
            user.message || null
        }
      );

      return new Response(
        'Não foi possível obter o usuário do Discord.',
        {
          status: 502,
          headers: {
            'content-type':
              'text/plain; charset=utf-8',
            'cache-control':
              'no-store, no-cache, must-revalidate',
            Pragma:
              'no-cache'
          }
        }
      );
    }

    /*
     * ============================================================
     * 3. CRIAR SESSÃO DA SAPUCAIA
     * ============================================================
     */
    const now = Date.now();

    const sessionData = {
      id: String(user.id),

      username: String(
        user.username || ''
      ),

      global_name: String(
        user.global_name ||
          user.username ||
          ''
      ),

      email:
        user.email || null,

      avatar:
        user.avatar || null,

      iat: now,

      exp:
        now +
        30 * 24 * 60 * 60 * 1000
    };

    const payload = Buffer
      .from(
        JSON.stringify(sessionData),
        'utf8'
      )
      .toString('base64url');

    const signature = crypto
      .createHmac(
        'sha256',
        sessionSecret
      )
      .update(payload)
      .digest('base64url');

    const sessionToken =
      `${payload}.${signature}`;

    /*
     * ============================================================
     * 4. DEFINIR COOKIES E REDIRECIONAR
     * ============================================================
     */
    const headers = new Headers();

    headers.set(
      'content-type',
      'text/html; charset=utf-8'
    );

    headers.set(
      'cache-control',
      'no-store, no-cache, must-revalidate'
    );

    headers.set(
      'Pragma',
      'no-cache'
    );

    headers.append(
      'Set-Cookie',
      cookie(
        'sapucaia_discord_session',
        sessionToken,
        30 * 24 * 60 * 60
      )
    );

    /*
     * Limpa eventual estado antigo.
     */
    headers.append(
      'Set-Cookie',
      cookie(
        'sapucaia_oauth_state',
        '',
        0
      )
    );

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

    return new Response(
      html,
      {
        status: 200,
        headers
      }
    );

  } catch (error) {
    console.error(
      'discord-callback error:',
      error?.stack ||
        error?.message ||
        error
    );

    return new Response(
      'Erro ao conectar o Discord.',
      {
        status: 500,
        headers: {
          'content-type':
            'text/plain; charset=utf-8',
          'cache-control':
            'no-store'
        }
      }
    );
  }
};
