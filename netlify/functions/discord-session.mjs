import crypto from 'node:crypto';

function readSession(req) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)sapucaia_discord_session=([^;]+)/);
  if (!m) return null;

  const token = decodeURIComponent(m[1]);
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const secret = String(process.env.DISCORD_SESSION_SECRET || '').trim();
  if (!secret) return null;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  const aa = Buffer.from(sig);
  const bb = Buffer.from(expected);
  if (aa.length !== bb.length || !crypto.timingSafeEqual(aa, bb)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() >= Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

export default async (req) => {
  const user = readSession(req);
  return new Response(JSON.stringify({
    connected: Boolean(user),
    user: user || null
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
};
