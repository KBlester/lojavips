import crypto from 'node:crypto';

const VERSION = 'sapucaia-discord-oauth-v2';
const DEFAULT_CLIENT_ID = '1548916664895144046';
const DEFAULT_REDIRECT_URI =
  'https://eloquent-babka-ec2dff.netlify.app/api/discord-callback';
const BLOCKED_OLD_REDIRECT_HOST = 'sapucaia-rj-lojaa-ofical.netlify.app';

function getDiscordConfig(req) {
  const clientId = String(
    process.env.DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  ).trim();

  const configuredRedirect = String(
    process.env.DISCORD_REDIRECT_URI || ''
  ).trim();

  let redirectUri = configuredRedirect;

  if (!redirectUri) {
    try {
      const currentUrl = new URL(req.url);
      redirectUri = `${currentUrl.origin}/api/discord-callback`;
    } catch {
      redirectUri = DEFAULT_REDIRECT_URI;
    }
  }

  return {
    clientId,
    redirectUri
  };
}

function buildCookie(name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ].join('; ');
}

function safeEqual(a, b) {
  const aa = Buffer.from(
    String(a || ''),
    'utf8'
  );

  const bb = Buffer.from(
    String(b || ''),
    'utf8'
  );

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

    const [
      encodedPayload,
      signature
    ] = parts;

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

    if (separator <= 0) {
      return false;
    }

    const issuedAt = Number(
      payload.slice(0, separator)
    );

    if (!Number.isFinite(issuedAt)) {
      return false;
    }

    const age = Date.now() - issuedAt;

    return (
      age >= -60_000 &&
      age <= 10 * 60_000
    );
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  const raw =
    req.headers.get('cookie') || '';

  const pattern = new RegExp(
    `(?:^|;\\s*)${name}=([^;]*)`
  );

  const match = raw.match(pattern);

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        'X-Sapucaia-Discord-Version':
          VERSION
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
    // Discord retornou conteúdo que não é JSON.
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    text,
    data
  };
}

function successResponse(sessionToken) {
  const headers = new Headers({
    Location: '/?discord=connected',
    'Cache-Control':
      'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Sapucaia-Discord-Version':
      VERSION
  });

  headers.append(
    'Set-Cookie',
    buildCookie(
      'sapucaia_discord_session',
      sessionToken,
      30 * 24 * 60 * 60
    )
  );

  headers.append(
    'Set-Cookie',
    buildCookie(
      'sapucaia_oauth_state',
      '',
      0
    )
  );

  return new Response(null, {
    status: 302,
    headers
  });
}

export default async (req) => {
  console.log(
    '========== SAPUCAIA DISCORD CALLBACK V2 =========='
  );

  try {
    if (req.method !== 'GET') {
      return json(
        {
          ok: false,
          stage: 'method',
          message:
            'O callback precisa receber uma requisição GET.',
          method: req.method,
          version: VERSION
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
      url.searchParams.get(
        'error_description'
      ) || ''
    ).trim();

    console.log('CALLBACK:', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasDiscordError: Boolean(discordError),
      hasStateCookie: Boolean(
        readCookie(
          req,
          'sapucaia_oauth_state'
        )
      ),
      version: VERSION
    });

    if (discordError) {
      return json(
        {
          ok: false,
          stage: 'discord_authorization',
          message:
            'O Discord recusou ou cancelou a autorização.',
          discord_error: discordError,
          discord_error_description:
            discordErrorDescription || null,
          version: VERSION
        },
        400
      );
    }

    if (!code || !state) {
      return json(
        {
          ok: false,
          stage: 'callback_parameters',
          message:
            'O Discord chegou ao callback, mas não enviou code e state.',
          has_code: Boolean(code),
          has_state: Boolean(state),
          version: VERSION
        },
        400
      );
    }

    const clientSecret = String(
      process.env.DISCORD_CLIENT_SECRET || ''
    ).trim();

    const sessionSecret = String(
      process.env.DISCORD_SESSION_SECRET || ''
    ).trim();

    const {
      clientId,
      redirectUri
    } = getDiscordConfig(req);

    if (!clientSecret) {
      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_CLIENT_SECRET não está configurado no Netlify.',
          version: VERSION
        },
        503
      );
    }

    if (sessionSecret.length < 16) {
      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_SESSION_SECRET ausente ou muito curto no Netlify.',
          version: VERSION
        },
        503
      );
    }

    if (!clientId) {
      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_CLIENT_ID ausente.',
          version: VERSION
        },
        503
      );
    }

    try {
      const redirect = new URL(
        redirectUri
      );

      if (
        redirect.protocol !== 'https:' ||
        !redirect.hostname
      ) {
        throw new Error(
          'redirect_uri precisa usar HTTPS'
        );
      }
    } catch (error) {
      console.error(
        'DISCORD_REDIRECT_URI inválida:',
        redirectUri,
        error
      );

      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_REDIRECT_URI precisa ser uma URL HTTPS válida.',
          version: VERSION
        },
        503
      );
    }

    const redirectUrl = new URL(
      redirectUri
    );

    if (
      redirectUrl.hostname ===
      BLOCKED_OLD_REDIRECT_HOST
    ) {
      console.error(
        'REDIRECT_URI aponta para o projeto antigo:',
        redirectUri
      );

      return json(
        {
          ok: false,
          stage: 'configuration',
          message:
            'DISCORD_REDIRECT_URI ainda aponta para a loja antiga. Atualize a variável no Netlify.',
          version: VERSION
        },
        503
      );
    }

    console.log('CONFIG:', {
      clientId,
      clientSecret: 'OK',
      sessionSecret: 'OK',
      redirectUri,
      version: VERSION
    });

    const validState =
      verifySignedState(
        state,
        sessionSecret
      );

    if (!validState) {
      return json(
        {
          ok: false,
          stage: 'state_validation',
          message:
            'O state recebido do Discord é inválido, expirou ou foi assinado com outro DISCORD_SESSION_SECRET.',
          version: VERSION
        },
        400
      );
    }

    console.log(
      'STATE OK. INICIANDO TOKEN EXCHANGE...'
    );

    const basicCredentials =
      Buffer
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

    console.log('TOKEN RESPONSE:', {
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
      errorDescription:
        tokenData.error_description ||
        null
    });

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      return json(
        {
          ok: false,
          stage:
            'token_exchange',
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
          version: VERSION
        },
        502
      );
    }

    console.log(
      'TOKEN OK. BUSCANDO USUÁRIO...'
    );

    const userRes = await fetch(
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
      return json(
        {
          ok: false,
          stage:
            'user_lookup',
          message:
            'O token foi obtido, mas não foi possível obter o usuário do Discord.',
          http_status:
            userResponse.status,
          http_status_text:
            userResponse.statusText,
          discord_error:
            user.error || null,
          discord_error_description:
            user.message || null,
          version: VERSION
        },
        502
      );
    }

    const now = Date.now();

    const sessionData = {
      id: String(user.id),
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
        user.email || null,
      avatar:
        user.avatar || null,
      iat:
        now,
      exp:
        now +
        30 *
          24 *
          60 *
          60 *
          1000
    };

    const payload =
      Buffer
        .from(
          JSON.stringify(
            sessionData
          ),
          'utf8'
        )
        .toString('base64url');

    const signature =
      crypto
        .createHmac(
          'sha256',
          sessionSecret
        )
        .update(payload)
        .digest('base64url');

    const sessionToken =
      `${payload}.${signature}`;

    console.log(
      'LOGIN DISCORD CONCLUÍDO:',
      {
        discordUserId:
          sessionData.id,
        version: VERSION
      }
    );

    return successResponse(
      sessionToken
    );
  } catch (error) {
    console.error(
      '========== DISCORD CALLBACK V2 ERROR =========='
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
        version: VERSION
      },
      500
    );
  }
};
