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

  return { clientId, redirectUri };
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

function createSignedState(secret) {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(32).toString('hex');
  const payload = `${issuedAt}.${nonce}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
}

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export default async (req) => {
  try {
    if (req.method !== 'GET') {
      return new Response('Método não permitido.', {
        status: 405,
        headers: {
          'X-Sapucaia-Discord-Version': VERSION
        }
      });
    }

    const sessionSecret = String(
      process.env.DISCORD_SESSION_SECRET || ''
    ).trim();

    if (sessionSecret.length < 16) {
      console.error('DISCORD_SESSION_SECRET ausente ou muito curto.');

      return new Response(
        'Discord OAuth não configurado corretamente no servidor. Verifique DISCORD_SESSION_SECRET.',
        {
          status: 503,
          headers: {
            'X-Sapucaia-Discord-Version': VERSION
          }
        }
      );
    }

    const { clientId, redirectUri } = getDiscordConfig(req);

    if (!clientId) {
      return new Response(
        'Discord OAuth não configurado: DISCORD_CLIENT_ID ausente.',
        {
          status: 503,
          headers: {
            'X-Sapucaia-Discord-Version': VERSION
          }
        }
      );
    }

    if (!isValidHttpsUrl(redirectUri)) {
      console.error('DISCORD_REDIRECT_URI inválida:', redirectUri);

      return new Response(
        'Discord OAuth não configurado: DISCORD_REDIRECT_URI precisa ser uma URL HTTPS válida.',
        {
          status: 503,
          headers: {
            'X-Sapucaia-Discord-Version': VERSION
          }
        }
      );
    }

    const redirectUrl = new URL(redirectUri);

    if (redirectUrl.hostname === BLOCKED_OLD_REDIRECT_HOST) {
      console.error(
        'REDIRECT_URI aponta para o projeto antigo:',
        redirectUri
      );

      return new Response(
        'Discord OAuth está configurado para o site antigo. Atualize DISCORD_REDIRECT_URI no Netlify para este projeto.',
        {
          status: 503,
          headers: {
            'X-Sapucaia-Discord-Version': VERSION
          }
        }
      );
    }

    const state = createSignedState(sessionSecret);

    const authUrl = new URL(
      'https://discord.com/oauth2/authorize'
    );

    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'identify email');
    authUrl.searchParams.set('state', state);

    const headers = new Headers({
      Location: authUrl.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      'X-Sapucaia-Discord-Version': VERSION
    });

    headers.append(
      'Set-Cookie',
      buildCookie(
        'sapucaia_oauth_state',
        state,
        600
      )
    );

    console.log('DISCORD START V2:', {
      clientId,
      redirectUri,
      version: VERSION
    });

    return new Response(null, {
      status: 302,
      headers
    });
  } catch (error) {
    console.error(
      'discord-start v2 error:',
      error?.stack ||
        error?.message ||
        error
    );

    return new Response(
      'Erro ao iniciar o login com Discord.',
      {
        status: 500,
        headers: {
          'X-Sapucaia-Discord-Version': VERSION
        }
      }
    );
  }
};
