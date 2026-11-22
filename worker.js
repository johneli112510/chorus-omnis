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
  return json({ admin: await isAdmin(request, env), configured: !!env.ADMIN_PASSWORD, r2: !!env.MEDIA, email: !!env.EMAIL });
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
const MAX_ATTACH = 17 * 1024 * 1024; // email limit is 25 MiB including encoding overhead
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|pif|js|jse|vbs|vbe|wsf|msi|jar|ps1|lnk|dll|reg)$/i;
const EMAIL_RE = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]{2,}$/;

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
const clean = s => String(s ?? '').replace(/\r/g, '').trim();
const oneLine = s => clean(s).replace(/[\n<>"]/g, ' ').slice(0, 100);

// ---------- email sending (Cloudflare Email Service, binding named EMAIL)
const fromAddress = (env, host) => ({ email: env.MAIL_FROM || ('website@' + host.replace(/^www\./, '')), name: 'Chorus Omnis Website' });
async function siteContactEmail(env) {
  try { const o = await env.MEDIA.get('site/content.json'); const c = o && await o.json(); const e = c && c.contact && c.contact.email; return EMAIL_RE.test(e || '') ? e : ''; } catch { return ''; }
}
async function alertRecipients(env, host) {
  const own = addrList(env.NOTIFY_EMAIL);
  if (own.length) return { list: own, source: 'NOTIFY_EMAIL setting' };
  const c = await siteContactEmail(env);
  if (c && !/your-domain\.com$/i.test(c)) return { list: [c], source: 'Contact email set in this admin' };
  return { list: ['info@' + host.replace(/^www\./, '')], source: 'default (info@ your domain)' };
}
const addrList = v => String(v || '').split(',').map(x => x.trim()).filter(x => EMAIL_RE.test(x)).slice(0, 5);
const errText = e => (e && (e.code ? '[' + e.code + '] ' : '') + (e.message || String(e))) || 'unknown error';
async function recordMail(env, rec) {
  try { await env.MEDIA.put('site/mail-status.json', JSON.stringify({ ...rec, date: new Date().toISOString() }), { httpMetadata: { contentType: 'application/json' } }); } catch {}
}
async function sendToList(env, host, list, build) {
  const results = await Promise.allSettled(list.map(to => env.EMAIL.send({ to, from: fromAddress(env, host), ...build(to) })));
  return results.map((r, i) => r.status === 'fulfilled' ? { to: list[i], ok: true } : { to: list[i], ok: false, error: errText(r.reason) });
}
// Alert to the choir inbox(es) when a visitor sends a message: every address in NOTIFY_EMAIL (comma separated).
async function notifyByEmail(env, host, m) {
  if (!env.EMAIL) return recordMail(env, { kind: 'alert', error: 'The EMAIL connection is missing. Redeploy after adding it to wrangler.jsonc.' });
  const { list } = await alertRecipients(env, host);
  const results = await sendToList(env, host, list, () => ({
    replyTo: { email: m.email, name: m.name }, subject: `New website message from ${oneLine(m.name)}`,
    text: `From: ${m.name} <${m.email}>\nDate: ${m.date}\n\n${m.message}\n\nPress Reply in your mail app to answer ${m.name} directly.`,
  }));
  await recordMail(env, { kind: 'alert', results, from: fromAddress(env, host).email });
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
  async function onRequestPost({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const key = keyOf(request);
    if (!key) return json({ error: 'Bad key' }, 400);
    if (!env.EMAIL) return json({ error: 'Email sending is not set up yet. Make sure the EMAIL connection is in wrangler.jsonc and redeploy.' }, 501);
    let b = {}, files = [];
    try {
      if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
        const fd = await request.formData();
        b = { subject: fd.get('subject'), body: fd.get('body'), cc: fd.get('cc') };
        files = fd.getAll('files').filter(f => f && typeof f !== 'string');
      } else b = await request.json();
    } catch { return json({ error: 'Invalid request.' }, 400); }
    const subject = oneLine(b.subject) || 'Reply from Chorus Omnis';
    const body = clean(b.body);
    if (!body) return json({ error: 'Please write your reply.' }, 400);
    if (body.length > 10000) return json({ error: 'Reply is too long.' }, 400);
    if (files.length > 10) return json({ error: 'You can attach up to 10 files.' }, 400);
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_ATTACH) return json({ error: `Attachments are ${(total / 1048576).toFixed(1)} MB in total. The limit is ${MAX_ATTACH / 1048576} MB per email. Upload big files in Photos and Videos and paste the link in your reply.` }, 413);
    const bad = files.find(f => BLOCKED_EXT.test(f.name || ''));
    if (bad) return json({ error: `"${bad.name}" is a file type that email services block. Zip it or share a link instead.` }, 400);
    const obj = await env.MEDIA.get(key);
    if (!obj) return json({ error: 'Not found' }, 404);
    const m = await obj.json();
    const host = new URL(request.url).hostname, domain = host.replace(/^www\./, '');
    const inbox = (await alertRecipients(env, host)).list;
    const contact = await siteContactEmail(env);
    const replyTo = contact && !/your-domain\.com$/i.test(contact) ? contact : inbox[0];
    // the reply is sent from the choir address; a hidden copy goes to the choir inbox(es), e.g. info@chorus-omnis.com
    const copies = [...new Set(inbox.map(x => x.toLowerCase()))].filter(x => x !== String(m.email).toLowerCase());
    const quoted = String(m.message || '').split('\n').map(l => '> ' + l).join('\n');
    const msg = {
      to: { email: m.email, name: m.name }, from: { email: env.REPLY_FROM || ('info@' + domain), name: 'Chorus Omnis' }, subject,
      text: `${body}\n\n--\nChorus Omnis\n\nOn ${m.date ? new Date(m.date).toUTCString() : 'an earlier date'}, ${m.name} wrote:\n${quoted}\n`,
    };
    if (replyTo) msg.replyTo = replyTo;
    const cc = addrList(b.cc).filter(x => x.toLowerCase() !== String(m.email).toLowerCase());
    if (cc.length) msg.cc = cc;
    if (copies.length) msg.bcc = copies.filter(x => !cc.some(c => c.toLowerCase() === x));
    if (!msg.bcc || !msg.bcc.length) delete msg.bcc;
    const sentFiles = [];
    if (files.length) {
      msg.attachments = [];
      for (const f of files) {
        const filename = String(f.name || 'file').replace(/[\\/\x00-\x1f"<>|:*?]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file';
        const type = /^[\w.+-]+\/[\w.+-]+$/.test(f.type || '') ? f.type : 'application/octet-stream';
        msg.attachments.push({ content: await f.arrayBuffer(), filename, type, disposition: 'attachment' });
        sentFiles.push({ name: filename, size: f.size });
      }
    }
    try { await env.EMAIL.send(msg); }
    catch (e) {
      const t = errText(e);
      if (/not a verified address|verified destination|E_RECIPIENT_PLAN_RESTRICTED/i.test(t))
        return json({ error: 'Cloudflare is only allowing email to verified addresses. In Cloudflare open Email Service and finish enabling chorus-omnis.com for sending (see README). Details: ' + t }, 502);
      return json({ error: 'The email could not be sent: ' + t }, 502);
    }
    m.read = true;
    m.replies = [...(m.replies || []), { date: new Date().toISOString(), subject, body, cc, files: sentFiles }].slice(-20);
    await env.MEDIA.put(key, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true, replies: m.replies, copiedTo: msg.bcc || [] });
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
  return { onRequestGet, onRequestPost, onRequestPut, onRequestDelete };
})();

const mailApi = (() => {
  async function onRequestGet({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    let last = null;
    try { const o = await env.MEDIA.get('site/mail-status.json'); if (o) last = await o.json(); } catch {}
    const host = new URL(request.url).hostname; const rc = await alertRecipients(env, host);
    return json({ binding: !!env.EMAIL, notify: rc.list, source: rc.source, from: fromAddress(env, host).email, last });
  }
  async function onRequestPost({ request, env }) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    if (!env.EMAIL) return json({ error: 'The EMAIL connection is missing. Make sure wrangler.jsonc contains "send_email": [{ "name": "EMAIL" }] and redeploy.' }, 501);
    const host = new URL(request.url).hostname;
    const { list } = await alertRecipients(env, host);
    const results = await sendToList(env, host, list, () => ({ subject: 'Test email from your Chorus Omnis website', text: 'If you can read this, your website can send email to this address.' }));
    await recordMail(env, { kind: 'test', results, from: fromAddress(env, host).email });
    return json({ results });
  }
  return { onRequestGet, onRequestPost };
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
  '/api/mailstatus': mailApi,
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
