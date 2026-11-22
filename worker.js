// Chorus Omnis Worker: API (login, content, media) + static site. Single file on purpose.

// ---------- auth helpers
const enc = new TextEncoder();
const COOKIE = 'co_admin';

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const secretOf = env => env.SESSION_SECRET || env.ADMIN_PASSWORD;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

async function checkPassword(env, password) {
  if (!env.ADMIN_PASSWORD) return null; // not configured
  const a = await hmac('pw-check', String(password || ''));
  const b = await hmac('pw-check', env.ADMIN_PASSWORD);
  return safeEq(a, b);
}
async function sessionCookie(env) {
  const exp = Date.now() + 7 * 864e5;
  const sig = await hmac(secretOf(env), 'admin.' + exp);
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 86400}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

async function isAdmin(request, env) {
  if (!secretOf(env)) return false;
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]+)`));
  if (!m) return false;
  if (Number(m[1]) < Date.now()) return false;
  return safeEq(m[2], await hmac(secretOf(env), 'admin.' + m[1]));
}
// Returns a Response if the request must be rejected, otherwise null.
async function requireAdmin(request, env) {
  if (!(await isAdmin(request, env))) return json({ error: 'Not signed in' }, 401);
  if (request.method !== 'GET' && request.headers.get('x-requested-with') !== 'admin')
    return json({ error: 'Bad request' }, 400);
  return null;
}

// ---------- /api/login
const loginApi = (() => {

async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const ok = await checkPassword(env, body.password);
  if (ok === null) return json({ error: 'ADMIN_PASSWORD is not set in Cloudflare. See the README.' }, 500);
  if (!ok) {
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'Wrong password' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env) });
}

return { onRequestPost };
})();

// ---------- /api/logout
const logoutApi = (() => {
async function onRequestPost() {
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}

return { onRequestPost };
})();

// ---------- /api/session
const sessionApi = (() => {
async function onRequestGet({ request, env }) {
  return json({ admin: await isAdmin(request, env), configured: !!env.ADMIN_PASSWORD, r2: !!env.MEDIA });
}

return { onRequestGet };
})();

// ---------- /api/content
const contentApi = (() => {

const KEY = 'site/content.json';

async function defaults(request, env) {
  const r = await env.ASSETS.fetch(new URL('/assets/default-content.json', request.url));
  return r.json();
}

async function onRequestGet({ request, env }) {
  let data = null;
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(KEY);
    if (obj) data = await obj.json();
  }
  if (!data) data = await defaults(request, env);
  return json(data, 200, { 'cache-control': 'no-cache' });
}

async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.MEDIA) return json({ error: 'R2 storage (MEDIA) is not connected. See the README.' }, 500);
  const text = await request.text();
  if (text.length > 900000) return json({ error: 'Content is too large' }, 413);
  let data;
  try { data = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Invalid content' }, 400);
  await env.MEDIA.put(KEY, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true });
}

return { onRequestGet, onRequestPut };
})();

// ---------- /api/media
const mediaApi = (() => {

const TYPES = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
};
const MAX = 95 * 1024 * 1024; // Cloudflare request body limit is 100 MB on Free and Pro plans

async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.MEDIA) return json({ error: 'R2 binding MEDIA is not set up. See the README.' }, 500);
  const items = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix: 'uploads/', cursor, include: ['httpMetadata', 'customMetadata'] });
    for (const o of page.objects) {
      const type = o.httpMetadata?.contentType || '';
      items.push({
        key: o.key, url: '/media/' + o.key.slice('uploads/'.length), size: o.size,
        kind: TYPES[type] || 'image', name: o.customMetadata?.name || o.key, uploaded: o.uploaded,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && items.length < 2000);
  items.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
  return json({ items });
}

async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.MEDIA) return json({ error: 'R2 binding MEDIA is not set up. See the README.' }, 500);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) return json({ error: 'Only JPG, PNG, WebP, GIF, MP4, WebM and MOV files are allowed.' }, 415);
  const len = Number(request.headers.get('content-length') || 0);
  if (!len) return json({ error: 'Missing file size' }, 411);
  if (len > MAX) return json({ error: 'File is larger than 95 MB. Compress it or upload it to YouTube and add the link instead.' }, 413);
  const original = new URL(request.url).searchParams.get('name') || 'file';
  const safe = original.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '').slice(-80) || 'file';
  const id = crypto.randomUUID().slice(0, 8);
  const key = `uploads/${Date.now()}-${id}-${safe}`;
  await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType: type },
    customMetadata: { name: original.slice(0, 120) },
  });
  return json({ ok: true, key, url: '/media/' + key.slice('uploads/'.length), kind: TYPES[type], size: len, name: original });
}

async function onRequestDelete({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith('uploads/') || key.includes('..')) return json({ error: 'Bad key' }, 400);
  await env.MEDIA.delete(key);
  return json({ ok: true });
}

return { onRequestGet, onRequestPut, onRequestDelete };
})();

// ---------- /api/contact (public) and /api/messages (admin inbox)
const MSG_PREFIX = 'messages/';
const EMAIL_RE = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]{2,}$/;

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
const clean = s => String(s ?? '').replace(/\r/g, '').trim();
const oneLine = s => clean(s).replace(/[\n<>"]/g, ' ').slice(0, 100);
const b64 = s => { const b = new TextEncoder().encode(s); let t = ''; b.forEach(x => t += String.fromCharCode(x)); return btoa(t); };

// Optional email alert. Works only if a send_email binding named MAIL and a NOTIFY_EMAIL variable are set (see README).
async function notifyByEmail(env, host, m) {
  if (!env.MAIL || !env.NOTIFY_EMAIL) return;
  const to = env.NOTIFY_EMAIL;
  const { EmailMessage } = await import('cloudflare:email');
  const from = env.MAIL_FROM || `website@${host}`;
  const subject = `New website message from ${oneLine(m.name)}`;
  const body = `From: ${m.name} <${m.email}>\n\n${m.message}\n`;
  const raw = [
    `From: Chorus Omnis Website <${from}>`, `To: ${to}`, `Reply-To: ${oneLine(m.name)} <${m.email}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`, `Message-ID: <${crypto.randomUUID()}@${host}>`,
    `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', b64(body).replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
  await env.MAIL.send(new EmailMessage(from, to, raw));
}

const contactApi = (() => {
  async function onRequestPost({ request, env, ctx }) {
    if (!env.MEDIA) return json({ error: 'Messages are not available right now.' }, 500);
    const text = await request.text();
    if (text.length > 20000) return json({ error: 'Message is too long.' }, 413);
    let b; try { b = JSON.parse(text); } catch { return json({ error: 'Invalid request.' }, 400); }
    // bots: hidden field filled in, or form submitted within 2.5 seconds of loading
    const delta = Date.now() - Number(b.t);
    if (clean(b.website) || (delta >= 0 && delta < 2500)) return json({ ok: true });
    const name = oneLine(b.name), email = clean(b.email).slice(0, 200), message = clean(b.message);
    if (!name) return json({ error: 'Please enter your name.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
    if (!message) return json({ error: 'Please write a message.' }, 400);
    if (message.length > 5000) return json({ error: 'Message is too long (5000 characters maximum).' }, 400);
    // one message per visitor every 30 seconds
    const rl = 'rl/' + await sha(request.headers.get('cf-connecting-ip') || 'unknown');
    const seen = await env.MEDIA.head(rl);
    if (seen && Date.now() - new Date(seen.uploaded).getTime() < 30000)
      return json({ error: 'Please wait a moment before sending another message.' }, 429);
    await env.MEDIA.put(rl, '1');
    const key = MSG_PREFIX + String(9e12 - Date.now()).padStart(13, '0') + '-' + crypto.randomUUID().slice(0, 6);
    const m = { name, email, message, date: new Date().toISOString(), read: false };
    await env.MEDIA.put(key, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });
    const job = notifyByEmail(env, new URL(request.url).hostname, m).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    return json({ ok: true });
  }
  return { onRequestPost };
})();

const messagesApi = (() => {
  const keyOf = request => {
    const k = new URL(request.url).searchParams.get('key') || '';
    return k.startsWith(MSG_PREFIX) && !k.includes('..') ? k : '';
  };
  async function onRequestGet({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    if (!env.MEDIA) return json({ error: 'R2 storage is not connected.' }, 500);
    const page = await env.MEDIA.list({ prefix: MSG_PREFIX, limit: 200 });
    const items = (await Promise.all(page.objects.map(async o => {
      const obj = await env.MEDIA.get(o.key);
      if (!obj) return null;
      try { return { key: o.key, ...(await obj.json()) }; } catch { return null; }
    }))).filter(Boolean);
    return json({ items });
  }
  async function onRequestPut({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const key = keyOf(request);
    if (!key) return json({ error: 'Bad key' }, 400);
    const obj = await env.MEDIA.get(key);
    if (!obj) return json({ error: 'Not found' }, 404);
    const m = await obj.json();
    m.read = new URL(request.url).searchParams.get('read') === '1';
    await env.MEDIA.put(key, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true });
  }
  async function onRequestDelete({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const key = keyOf(request);
    if (!key) return json({ error: 'Bad key' }, 400);
    await env.MEDIA.delete(key);
    return json({ ok: true });
  }
  return { onRequestGet, onRequestPut, onRequestDelete };
})();

// ---------- /media/*
async function serveMedia(request, env, url) {
  if (!env.MEDIA) return new Response('Storage not configured', { status: 500 });
  let parts;
  try { parts = url.pathname.slice('/media/'.length).split('/').map(decodeURIComponent); } catch { return new Response('Not found', { status: 404 }); }
  if (parts.some(p => !p || p === '..' || p === '.')) return new Response('Not found', { status: 404 });
  const obj = await env.MEDIA.get('uploads/' + parts.join('/'), { range: request.headers });
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');

  let status = 200;
  if (obj.range) {
    let { offset, length, suffix } = obj.range;
    if (suffix !== undefined) { offset = obj.size - suffix; length = suffix; }
    offset = offset ?? 0;
    length = length ?? obj.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    status = 206;
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(obj.body, { status, headers });
}

// ---------- /news/<id> : story page with share-preview tags
const escA = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function servePost(request, env, url) {
  const id = decodeURIComponent(url.pathname.slice('/news/'.length)).replace(/\/+$/, '').replace(/[^a-z0-9-]/gi, '');
  const getPage = async () => {
    let r = await env.ASSETS.fetch(new Request(new URL('/post', url)));
    if (r.status >= 300 && r.status < 400 && r.headers.get('location'))
      r = await env.ASSETS.fetch(new Request(new URL(r.headers.get('location'), url)));
    return r;
  };
  const [page, cr] = await Promise.all([getPage(), contentApi.onRequestGet({ request, env })]);
  let html = await page.text();
  let C = {};
  try { C = await cr.json(); } catch {}
  const p = (C.news || []).find(x => String(x.id || '').replace(/[^a-z0-9-]/gi, '') === id);
  if (p) {
    const blocks = Array.isArray(p.blocks) ? p.blocks : [];
    const firstText = (blocks.find(b => b.type === 'text') || {}).text || p.body || '';
    const desc = String(p.summary || firstText).replace(/\*+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const imgUrl = p.image || (blocks.find(b => b.type === 'image' && b.url) || {}).url || '/assets/logo.png';
    const abs = /^(\/(?!\/)|https?:\/\/)/.test(imgUrl) ? new URL(imgUrl, url).href : new URL('/assets/logo.png', url).href;
    const title = String(p.title || 'News');
    const tags = `<meta name="description" content="${escA(desc)}"><meta property="og:type" content="article"><meta property="og:title" content="${escA(title)}"><meta property="og:description" content="${escA(desc)}"><meta property="og:image" content="${escA(abs)}"><meta property="og:url" content="${escA(url.origin + '/news/' + id)}"><meta name="twitter:card" content="summary_large_image">`;
    html = html.replace('<!--META-->', () => tags).replace(/<title>[^<]*<\/title>/, () => `<title>${escA(title)} | Chorus Omnis</title>`);
  } else {
    html = html.replace('<!--META-->', () => '<meta name="robots" content="noindex">');
  }
  return new Response(html, { status: p ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}

// ---------- router
const ROUTES = {
  '/api/login': loginApi,
  '/api/logout': logoutApi,
  '/api/session': sessionApi,
  '/api/content': contentApi,
  '/api/media': mediaApi,
  '/api/contact': contactApi,
  '/api/messages': messagesApi,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mod = ROUTES[url.pathname];
    if (mod) {
      const m = request.method;
      const handler = mod['onRequest' + m[0] + m.slice(1).toLowerCase()];
      if (!handler) return json({ error: 'Method not allowed' }, 405);
      try {
        return await handler({ request, env, ctx });
      } catch (e) {
        return json({ error: 'Server error: ' + (e && e.message ? e.message : 'unknown') }, 500);
      }
    }
    if (url.pathname.startsWith('/news/') && url.pathname.length > 6 && (request.method === 'GET' || request.method === 'HEAD')) {
      return servePost(request, env, url);
    }
    if (url.pathname.startsWith('/media/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveMedia(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
