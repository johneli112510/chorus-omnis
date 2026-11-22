(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => { u = String(u || ''); return /^(\/(?!\/)|https?:\/\/)/.test(u) && !/["'()<>\s]/.test(u) ? u : ''; };
  const H = { 'X-Requested-With': 'admin' };

  let C = {}, msgs = null, unread = 0, openPosts = new Set(), media = [], tab = 'home', dirty = false, mediaLoaded = false, pickResolve = null, setup = {};

  async function api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { ...H, ...(opt.headers || {}) }, credentials: 'same-origin' });
    if (r.status === 401 && !url.includes('login')) { showLogin(); throw new Error('Signed out'); }
    return r;
  }
  const errOf = async r => { try { return (await r.json()).error || 'Something went wrong'; } catch { return 'Something went wrong'; } };

  // ---------- state helpers
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), C);
  const set = (p, v) => {
    const ks = p.split('.'); let o = C;
    ks.slice(0, -1).forEach(k => { if (o[k] == null) o[k] = {}; o = o[k]; });
    o[ks.at(-1)] = v; markDirty();
  };
  function markDirty() { dirty = true; $('#save').disabled = false; status('Unsaved changes', 'dirty'); }
  function status(t, cls = '') { const s = $('#status'); s.textContent = t; s.className = 'status ' + cls; }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- auth
  function showLogin(msg) { $('#app').hidden = true; $('#login').hidden = false; $('#loginErr').textContent = msg || ''; $('#pw').focus(); }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }), headers: { 'content-type': 'application/json' } });
    if (!r.ok) return showLogin(await errOf(r));
    $('#pw').value = ''; start();
  });
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

  async function start() {
    let s;
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no-api');
      s = await r.json();
    } catch {
      $('#app').hidden = true; $('#login').hidden = false; $('#loginForm').hidden = true;
      $('#login').insertAdjacentHTML('beforeend', '<div class="login-msg"><h1>Admin is not available yet</h1><p>The site\'s server functions are not running. Check that:</p><ol><li>The project was deployed from GitHub, not by drag-and-drop upload.</li><li>The deploy finished without errors and the repo root has <code>wrangler.jsonc</code> and the <code>src</code> folder.</li><li>You opened the deployed address (https://...pages.dev/admin.html), not a file on your computer.</li></ol></div>');
      return;
    }
    setup = s;
    if (!s.admin) return showLogin(s.configured ? '' : 'ADMIN_PASSWORD is not set in Cloudflare yet. Add it under Settings, Variables and Secrets, then retry the deployment.');
    C = await (await fetch('/api/content')).json();
    ['hero', 'quote', 'about', 'vmo', 'contact', 'social'].forEach(k => C[k] ??= {});
    ['org', 'concerts', 'recordings', 'gallery', 'news'].forEach(k => C[k] ??= []);
    C.about.paragraphs ??= []; C.vmo.objectives ??= [];
    C.hero.slides ??= [];
    if (!C.hero.slides.length && C.hero.image) { C.hero.slides = [{ url: C.hero.image }]; C.hero.image = ''; }
    C.hero.transition ??= 'slide'; C.hero.interval ??= 10;
    C.news.forEach(p => {
      p.id ||= Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      if (!Array.isArray(p.blocks)) {
        p.blocks = String(p.body || '').split(/\n{2,}/).filter(x => x.trim()).map(text => ({ type: 'text', text }));
        delete p.body;
      }
      p.summary ??= ''; p.imageCaption ??= '';
    });
    $('#login').hidden = true; $('#app').hidden = false;
    dirty = false; $('#save').disabled = true; status('');
    renderTabs(); renderPanel(); loadMsgs();
    if (!s.r2) status('Setup incomplete: the R2 storage (MEDIA) is not connected', 'dirty');
  }

  // ---------- save
  $('#save').onclick = async () => {
    status('Saving...');
    const r = await api('/api/content', { method: 'PUT', body: JSON.stringify(C), headers: { 'content-type': 'application/json' } });
    if (r.ok) { dirty = false; $('#save').disabled = true; status('Saved. The site is updated.', 'ok'); }
    else status(await errOf(r), 'dirty');
  };

  // ---------- tabs
  const TABS = [['home', 'Home'], ['news', 'Latest News'], ['about', 'About'], ['org', 'Organization'], ['vmo', 'Vision and Mission'], ['concerts', 'Concerts'],
    ['recordings', 'Recordings'], ['gallery', 'Gallery'], ['media', 'Photos and Videos'], ['messages', 'Messages'], ['contact', 'Contact and Social']];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" aria-selected="${k === tab}">${l}${k === 'messages' && unread ? ` (${unread})` : ''}</button>`).join('');
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; renderTabs(); renderPanel(); });

  // ---------- field builders
  const text = (label, p, o = {}) => `<label>${label}${o.area
    ? `<textarea rows="${o.rows || 4}" data-p="${p}">${esc(get(p))}</textarea>`
    : `<input type="${o.type || 'text'}" data-p="${p}" value="${esc(get(p))}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}>`}</label>`;
  const imgField = (label, p) => { const u = safe(get(p)); return `<div><div class="note" style="margin:0 0 .3rem;font-weight:500;color:inherit">${label}</div>
    <div class="imgf" data-ip="${p}"><div class="thumb">${u ? `<img src="${esc(u)}" alt="">` : 'No photo'}</div>
    <div class="btns"><button type="button" class="btn ghost sm" data-act="pick">Choose photo</button>${u ? '<button type="button" class="btn ghost sm" data-act="clear">Remove</button>' : ''}</div></div></div>`; };
  const cardHead = (list, i, title) => `<div class="card-head"><strong>${esc(title)}</strong><div class="btns">
    <button type="button" class="btn ghost sm" data-act="up" data-l="${list}" data-i="${i}" aria-label="Move up">&uarr;</button>
    <button type="button" class="btn ghost sm" data-act="down" data-l="${list}" data-i="${i}" aria-label="Move down">&darr;</button>
    <button type="button" class="btn danger sm" data-act="del" data-l="${list}" data-i="${i}">Delete</button></div></div>`;
  const addBtn = (list, label) => `<button type="button" class="btn ghost" data-act="add" data-l="${list}">${label}</button>`;
  const NEW = {
    news: () => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: '', date: new Date().toISOString().slice(0, 10), image: '', imageCaption: '', summary: '', blocks: [] }),
    org: { name: '', role: '', photo: '' }, concerts: { title: '', date: '', time: '', venue: '', image: '', link: '' },
    recordings: { title: '', year: '', link: '', cover: '' }, 'about.paragraphs': '', 'vmo.objectives': '',
  };

  const blockCard = (i, j, b) => {
    const base = `news.${i}.blocks.${j}`, l = `news.${i}.blocks`;
    let body;
    if (b.type === 'image') {
      const u = safe(b.url);
      body = `<div class="imgf"><div class="thumb">${u ? `<img src="${esc(u)}" alt="">` : 'No photo'}</div><div style="flex:1">${text('Caption (optional)', base + '.caption')}</div></div>`;
    } else if (b.type === 'heading') body = text('Heading', base + '.text');
    else body = text('Text', base + '.text', { area: 1, rows: 5 });
    return `<div class="card block">${cardHead(l, j, b.type === 'image' ? 'Photo' : b.type === 'heading' ? 'Heading' : 'Paragraph')}${body}</div>`;
  };
  const postCard = (p, i) => `<details class="card post" data-pid="${esc(p.id)}" ${openPosts.has(p.id) ? 'open' : ''}>
    <summary><strong>${esc(p.title || 'New story')}</strong> <span class="muted">${esc(p.date || '')}</span></summary>
    <div class="fields" style="margin-top:1rem">${cardHead('news', i, 'Story options')}
      ${text('Title', `news.${i}.title`)}${text('Date', `news.${i}.date`, { type: 'date' })}
      ${text('Short summary (shown on cards and when shared)', `news.${i}.summary`, { area: 1, rows: 2 })}
      ${imgField('Cover photo', `news.${i}.image`)}${text('Cover photo caption (optional)', `news.${i}.imageCaption`)}
      <div><strong>Story</strong>${p.blocks.map((b, j) => blockCard(i, j, b)).join('')}
      <div class="btns"><button type="button" class="btn ghost" data-act="addblock" data-t="text" data-l="news.${i}.blocks">+ Paragraph</button>
      <button type="button" class="btn ghost" data-act="addblock" data-t="heading" data-l="news.${i}.blocks">+ Heading</button>
      <button type="button" class="btn ghost" data-act="addphotos" data-l="news.${i}.blocks">+ Photos</button></div></div>
      ${p.id ? `<p class="note">Page address: /news/${esc(p.id)}</p>` : ''}</div></details>`;

  const fmtDT = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const replyOpen = new Set(); let copyTo = [];
  const attach = new Map();                       // message key -> files chosen for the reply
  const MAX_ATT = 17 * 1024 * 1024;
  const attList = key => { const l = attach.get(key) || [], tot = l.reduce((n, f) => n + f.size, 0);
    return l.map((f, i) => `<div class="att"><span>${esc(f.name)} <span class="muted">(${esc(fmtSize(f.size))})</span></span><button type="button" class="btn ghost sm" data-m="rmfile" data-key="${esc(key)}" data-i="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></div>`).join('')
      + (l.length ? `<div class="muted ${tot > MAX_ATT ? 'err' : ''}">${l.length} file${l.length > 1 ? 's' : ''}, ${esc(fmtSize(tot))} of ${MAX_ATT / 1048576} MB</div>` : ''); };
  const msgCard = m => `<div class="card msg ${m.read ? '' : 'unread'}"><div class="card-head"><strong>${esc(m.name)}</strong><span class="muted">${esc(fmtDT(m.date))}</span></div>
    <div><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div><div class="msg-body">${esc(m.message)}</div>
    ${(m.replies || []).map(r => `<div class="reply-sent"><div class="muted">You replied on ${esc(fmtDT(r.date))}${(r.cc || []).length ? ' (Cc: ' + esc(r.cc.join(', ')) + ')' : ''}</div><div class="msg-body">${esc(r.body)}</div>
      ${(r.files || []).length ? `<div class="muted">Attached: ${r.files.map(f => esc(f.name) + ' (' + esc(fmtSize(f.size)) + ')').join(', ')}</div>` : ''}</div>`).join('')}
    ${replyOpen.has(m.key) ? `<div class="reply-box" data-key="${esc(m.key)}"><div class="to-line"><strong>To:</strong> ${esc(m.name)} &lt;${esc(m.email)}&gt;</div>
      <label>Cc (optional, separate with commas)<input data-r="cc" placeholder="name@example.com, other@example.com"></label>
      <label>Subject<input data-r="subject" value="${esc('Re: your message to Chorus Omnis')}"></label>
      <label>Message<textarea data-r="body" rows="8" placeholder="Write your reply..."></textarea></label>
      <div class="attach-zone"><label class="btn ghost sm attach-btn">Attach files<input type="file" multiple data-r="files" hidden></label>
        <span class="muted">or drag files here. Up to 10 files, 17 MB in total.</span><div class="att-list" data-r="list">${attList(m.key)}</div></div>
      <p class="note" style="margin:0">Sent from the choir address. A hidden copy also goes to ${esc(copyTo.join(', ') || 'your choir inbox')}.</p>
      <div class="btns"><button type="button" class="btn sm" data-m="send" data-key="${esc(m.key)}">Send reply</button>
      <button type="button" class="btn ghost sm" data-m="cancel" data-key="${esc(m.key)}">Cancel</button></div><p class="form-status" data-r="status" role="status"></p></div>` : ''}
    <div class="btns">${replyOpen.has(m.key) ? '' : `<button type="button" class="btn sm" data-m="reply" data-key="${esc(m.key)}">Reply</button>`}
    <button type="button" class="btn ghost sm" data-m="toggle" data-key="${esc(m.key)}">${m.read ? 'Mark unread' : 'Mark read'}</button>
    <button type="button" class="btn danger sm" data-m="del" data-key="${esc(m.key)}">Delete</button></div></div>`;
  const msgList = () => msgs.length ? msgs.map(msgCard).join('') : '<p>No messages yet.</p>';
  const mailLine = (label, ok, text) => `<div class="mline ${ok ? 'good' : 'bad'}"><strong>${label}</strong> ${text}</div>`;
  const resultsHtml = rs => (rs || []).map(r => `<div class="mline ${r.ok ? 'good' : 'bad'}">${r.ok ? 'Delivered to' : 'Failed for'} ${esc(r.to)}${r.ok ? '' : ': ' + esc(r.error)}</div>`).join('');
  async function loadMail() {
    const box = $('#mailbox'); if (!box) return;
    try {
      const r = await api('/api/mailstatus'); if (!r.ok) { box.textContent = await errOf(r); return; }
      const m = await r.json(), l = m.last; copyTo = m.notify || [];
      box.innerHTML = `<strong>Email settings</strong>
        ${mailLine('Email connection:', m.binding, m.binding ? 'connected' : 'NOT connected. Redeploy so the EMAIL connection from wrangler.jsonc is applied.')}
        ${mailLine('New messages are emailed to:', m.notify.length, esc(m.notify.join(', ')) + ' <span class="muted">(' + esc(m.source) + ')</span>')}
        <div class="mline"><strong>Sending from:</strong> ${esc(m.from)}</div>
        ${l ? `<div class="mline"><strong>Last ${esc(l.kind)}:</strong> ${esc(fmtDT(l.date))}</div>${l.error ? `<div class="mline bad">${esc(l.error)}</div>` : resultsHtml(l.results)}` : '<div class="mline">No alert has been attempted yet.</div>'}
        <div class="btns"><button type="button" class="btn ghost sm" data-m="mailtest">Send test email</button></div><div id="mailtest" class="form-status" role="status"></div>`;
    } catch {}
  }
  $('#panel').addEventListener('click', async e => {
    if (!e.target.closest('[data-m=mailtest]')) return;
    const out = $('#mailtest'); out.className = 'form-status'; out.textContent = 'Sending test email...';
    const r = await api('/api/mailstatus', { method: 'POST' });
    if (!r.ok) { out.className = 'form-status err'; out.textContent = await errOf(r); return; }
    await loadMail();
  });
  function postForm(url, fd, onProg) {
    return new Promise(resolve => {
      const x = new XMLHttpRequest(); x.open('POST', url); x.setRequestHeader('X-Requested-With', 'admin');
      x.upload.onprogress = e => { if (e.lengthComputable) onProg(e.loaded / e.total); };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} if (x.status === 401) showLogin(); resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, json: j }); };
      x.onerror = () => resolve({ ok: false, status: 0, json: { error: 'Network error. Please try again.' } });
      x.send(fd);
    });
  }
  function addFiles(box, files) {
    const key = box.dataset.key, l = attach.get(key) || []; attach.set(key, l);
    for (const f of files) { if (l.length >= 10) break; if (!l.some(x => x.name === f.name && x.size === f.size)) l.push(f); }
    box.querySelector('[data-r=list]').innerHTML = attList(key);
  }
  $('#panel').addEventListener('change', e => { if (e.target.dataset.r === 'files') { addFiles(e.target.closest('.reply-box'), [...e.target.files]); e.target.value = ''; } });
  ['dragenter', 'dragover'].forEach(n => $('#panel').addEventListener(n, e => { const z = e.target.closest && e.target.closest('.reply-box'); if (z) { e.preventDefault(); z.classList.add('drag'); } }));
  ['dragleave', 'drop'].forEach(n => $('#panel').addEventListener(n, e => { const z = e.target.closest && e.target.closest('.reply-box'); if (z) { e.preventDefault(); if (n === 'drop' || !z.contains(e.relatedTarget)) z.classList.remove('drag'); if (n === 'drop') addFiles(z, [...e.dataTransfer.files]); } }));
  async function loadMsgs() {
    try {
      const r = await api('/api/messages'); if (!r.ok) return;
      msgs = (await r.json()).items; unread = msgs.filter(m => !m.read).length;
      renderTabs(); const l = $('#mlist'); if (l && tab === 'messages') l.innerHTML = msgList();
    } catch {}
  }
  $('#panel').addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const key = b.dataset.key, m = msgs.find(x => x.key === key); if (!m) return;
    if (b.dataset.m === 'reply') { replyOpen.add(key); attach.set(key, attach.get(key) || []); $('#mlist').innerHTML = msgList(); const t = $('#mlist .reply-box textarea'); if (t) t.focus(); return; }
    if (b.dataset.m === 'cancel') { replyOpen.delete(key); attach.delete(key); $('#mlist').innerHTML = msgList(); return; }
    if (b.dataset.m === 'rmfile') { const l = attach.get(key) || []; l.splice(+b.dataset.i, 1); const box = b.closest('.reply-box'); box.querySelector('[data-r=list]').innerHTML = attList(key); return; }
    if (b.dataset.m === 'send') {
      const box = b.closest('.reply-box'), body = box.querySelector('[data-r=body]').value.trim(), subject = box.querySelector('[data-r=subject]').value;
      const cc = box.querySelector('[data-r=cc]').value, st = box.querySelector('[data-r=status]'), files = attach.get(key) || [];
      if (!body) { st.className = 'form-status err'; st.textContent = 'Please write your reply.'; return; }
      if (files.reduce((n, f) => n + f.size, 0) > MAX_ATT) { st.className = 'form-status err'; st.textContent = 'Attachments are over 17 MB. Remove some, or upload big files in Photos and Videos and paste the link in your reply.'; return; }
      const fd = new FormData(); fd.set('subject', subject); fd.set('body', body); fd.set('cc', cc);
      files.forEach(f => fd.append('files', f, f.name));
      b.disabled = true; st.className = 'form-status'; st.textContent = files.length ? 'Uploading 0%...' : 'Sending...';
      const res = await postForm('/api/messages?key=' + encodeURIComponent(key), fd, p => { st.textContent = p < 1 ? `Uploading ${Math.round(p * 100)}%...` : 'Sending...'; });
      if (!res.ok) { b.disabled = false; st.className = 'form-status err'; st.textContent = (res.json && res.json.error) || 'Something went wrong. Please try again.'; return; }
      m.replies = res.json.replies; m.read = true; replyOpen.delete(key); attach.delete(key);
      unread = msgs.filter(x => !x.read).length; renderTabs(); $('#mlist').innerHTML = msgList(); return;
    }
    if (b.dataset.m === 'del') {
      if (!confirm('Delete this message permanently?')) return;
      const r = await api('/api/messages?key=' + encodeURIComponent(key), { method: 'DELETE' });
      if (!r.ok) return alert(await errOf(r));
      msgs = msgs.filter(x => x.key !== key);
    } else {
      const read = !m.read;
      const r = await api('/api/messages?key=' + encodeURIComponent(key) + '&read=' + (read ? 1 : 0), { method: 'PUT' });
      if (!r.ok) return alert(await errOf(r));
      m.read = read;
    }
    unread = msgs.filter(x => !x.read).length; renderTabs(); $('#mlist').innerHTML = msgList();
  });

  // ---------- panels
  const PANELS = {
    home: () => `<h2>Home page</h2><p class="note">Photos behind the logo slide automatically. With no photos the home page shows the logo and ribbon.</p><div class="fields">
      <div><strong>Slideshow photos</strong>
      ${C.hero.slides.map((m, j) => `<div class="card slide-card">${cardHead('hero.slides', j, 'Photo ' + (j + 1))}<div class="imgf"><div class="thumb">${safe(m.url) ? `<img src="${esc(safe(m.url))}" alt="">` : 'Missing'}</div></div></div>`).join('')}
      <div class="btns"><button type="button" class="btn ghost" data-act="addphotos" data-l="hero.slides">+ Add photos</button></div></div>
      <div class="row2"><label>Transition<select data-p="hero.transition"><option value="slide" ${C.hero.transition !== 'fade' ? 'selected' : ''}>Slide</option><option value="fade" ${C.hero.transition === 'fade' ? 'selected' : ''}>Fade</option></select></label>
      ${text('Seconds between photos', 'hero.interval', { type: 'number' })}</div>${text('Headline', 'hero.tagline')}${text('Short intro', 'hero.lede', { area: 1, rows: 3 })}
      ${text('Button text', 'hero.buttonText')}${text('Quote', 'quote.text', { area: 1, rows: 3 })}${text('Quote by', 'quote.cite')}</div>`,
    news: () => `<h2>News stories</h2><p class="note">Each story has its own page. Build it like an article: add paragraphs, headings and photos (with captions) in any order. Photos added one after another show side by side. In text you can use *italic* and **bold**. The newest three stories appear on the home page.</p>
      <div class="fields">${C.news.map((p, i) => postCard(p, i)).join('')}${addBtn('news', 'Add story')}</div>`,
    about: () => `<h2>The Choir</h2><div class="fields">${imgField('Photo', 'about.image')}
      <div>${(C.about.paragraphs).map((p, i) => `<div class="card">${cardHead('about.paragraphs', i, 'Paragraph ' + (i + 1))}${text('Text', 'about.paragraphs.' + i, { area: 1, rows: 5 })}</div>`).join('')}
      ${addBtn('about.paragraphs', 'Add paragraph')}</div></div>`,
    org: () => `<h2>Organization</h2><div class="fields">${C.org.map((p, i) => `<div class="card">${cardHead('org', i, p.name || 'New person')}
      <div class="row2">${text('Name', `org.${i}.name`)}${text('Role', `org.${i}.role`)}</div>${imgField('Photo', `org.${i}.photo`)}</div>`).join('')}
      ${addBtn('org', 'Add person')}</div>`,
    vmo: () => `<h2>Vision, Mission and Objectives</h2><div class="fields">${text('Vision', 'vmo.vision', { area: 1 })}${text('Mission', 'vmo.mission', { area: 1 })}
      <div><strong>Objectives</strong>${C.vmo.objectives.map((o, i) => `<div class="card">${cardHead('vmo.objectives', i, 'Objective ' + (i + 1))}${text('Text', 'vmo.objectives.' + i, { area: 1, rows: 2 })}</div>`).join('')}
      ${addBtn('vmo.objectives', 'Add objective')}</div></div>`,
    concerts: () => `<h2>Concerts</h2><p class="note">Concerts with a past date move to "Past performances" automatically.</p><div class="fields">
      ${C.concerts.map((c, i) => `<div class="card">${cardHead('concerts', i, c.title || 'New concert')}
      ${text('Title', `concerts.${i}.title`)}<div class="row2">${text('Date', `concerts.${i}.date`, { type: 'date' })}${text('Time', `concerts.${i}.time`, { ph: '7:00 PM' })}</div>
      ${text('Venue', `concerts.${i}.venue`)}${text('Ticket or details link (optional)', `concerts.${i}.link`, { ph: 'https://' })}${imgField('Photo', `concerts.${i}.image`)}</div>`).join('')}
      ${addBtn('concerts', 'Add concert')}</div>`,
    recordings: () => `<h2>Recordings</h2><div class="fields">${C.recordings.map((r, i) => `<div class="card">${cardHead('recordings', i, r.title || 'New recording')}
      ${text('Title', `recordings.${i}.title`)}<div class="row2">${text('Year', `recordings.${i}.year`)}${text('Listen link (Spotify, YouTube...)', `recordings.${i}.link`, { ph: 'https://' })}</div>
      ${imgField('Cover', `recordings.${i}.cover`)}</div>`).join('')}${addBtn('recordings', 'Add recording')}</div>`,
    gallery: () => `<h2>Gallery</h2><p class="note">These photos and videos show on the Gallery page, in this order. Add more from the Photos and Videos tab.</p><div class="fields">
      ${C.gallery.length ? C.gallery.map((m, i) => `<div class="card">${cardHead('gallery', i, m.kind === 'video' ? 'Video' : 'Photo')}
      <div class="imgf"><div class="thumb">${m.kind === 'video' ? `<video src="${esc(safe(m.url))}#t=0.1" preload="metadata" muted style="width:100%;height:100%;object-fit:cover"></video>` : `<img src="${esc(safe(m.url))}" alt="">`}</div>
      <div style="flex:1">${text('Caption (optional)', `gallery.${i}.caption`)}</div></div></div>`).join('') : '<p>Nothing in the gallery yet. Go to Photos and Videos and tick "In gallery".</p>'}</div>`,
    messages: () => `<h2>Messages</h2><p class="note">Messages sent from the Contact page on your website appear here.</p><div id="mailbox" class="card mailbox">Checking email settings...</div><div id="mlist">${msgs === null ? 'Loading...' : msgList()}</div>`,
    contact: () => `<h2>Contact and Social</h2><div class="fields">${text('Email (messages from the contact form go here)', 'contact.email', { type: 'email' })}${text('Phone', 'contact.phone')}${text('Address', 'contact.address', { area: 1, rows: 2 })}
      <h3>Social links</h3><p class="note">Leave blank to hide a link.</p>${['facebook', 'instagram', 'youtube', 'spotify', 'tiktok'].map(k => text(k[0].toUpperCase() + k.slice(1), 'social.' + k, { ph: 'https://' })).join('')}</div>`,
    media: () => `<h2>Photos and Videos</h2>
      <div class="up" id="drop"><p><strong>Drag files here</strong> or</p><label class="btn">Choose files<input type="file" id="files" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden></label>
      <p class="note" style="margin:.6rem 0 0">JPG, PNG, WebP, GIF, MP4, WebM or MOV. Up to 95 MB each. For longer videos, upload to YouTube and add the link in Social.</p><div class="progress" id="prog"></div></div>
      <div class="mgrid" id="mgrid">${mediaLoaded ? '' : 'Loading...'}</div>`,
  };
  function renderPanel() {
    const p = $('#panel'); p.innerHTML = PANELS[tab]();
    if (tab === 'media') { bindUpload(); loadMedia(); }
    if (tab === 'messages') { loadMsgs(); loadMail(); }
  }

  // ---------- panel events
  $('#panel').addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.pid) { if (d.open) openPosts.add(d.dataset.pid); else openPosts.delete(d.dataset.pid); } }, true);
  $('#panel').addEventListener('input', e => { const p = e.target.dataset.p; if (p) set(p, e.target.type === 'number' ? Math.max(3, Number(e.target.value) || 10) : e.target.value); });
  $('#panel').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'pick' || act === 'clear') {
      const p = b.closest('[data-ip]').dataset.ip;
      if (act === 'clear') set(p, ''); else { const m = await pickImage(); if (!m) return; set(p, m.url); }
      return renderPanel();
    }
    if (act === 'addblock' || act === 'addphotos') {
      const arr = get(b.dataset.l);
      if (act === 'addblock') arr.push({ type: b.dataset.t === 'heading' ? 'heading' : 'text', text: '' });
      else { const picks = await pickImage(true); if (!picks.length) return; picks.forEach(m => arr.push({ type: 'image', url: m.url, caption: '' })); }
      markDirty(); return renderPanel();
    }
    const l = b.dataset.l, i = +b.dataset.i, arr = get(l);
    if (act === 'add') { const n = typeof NEW[l] === 'function' ? NEW[l]() : typeof NEW[l] === 'object' ? { ...NEW[l] } : NEW[l]; if (l === 'news') { arr.unshift(n); openPosts.add(n.id); } else arr.push(n); markDirty(); return renderPanel(); }
    if (act === 'del') { if (!confirm('Delete this item?')) return; arr.splice(i, 1); }
    if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    markDirty(); renderPanel();
  });

  // ---------- media library
  async function loadMedia() {
    const r = await api('/api/media');
    if (!r.ok) { $('#mgrid') && ($('#mgrid').textContent = await errOf(r)); return; }
    media = (await r.json()).items; mediaLoaded = true; renderMedia();
  }
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  const inGallery = url => C.gallery.some(g => g.url === url);
  function renderMedia() {
    const g = $('#mgrid'); if (!g) return;
    g.innerHTML = media.length ? media.map(m => `<div class="mcard"><${m.kind === 'video' ? `video src="${esc(m.url)}#t=0.1" preload="metadata" muted controls` : `img src="${esc(m.url)}" alt="" loading="lazy"`} class="pv">
      <div class="mi"><div class="nm" title="${esc(m.name)}">${esc(m.name)}</div><div>${fmtSize(m.size)}</div>
      <label><input type="checkbox" data-gal="${esc(m.url)}" data-kind="${m.kind}" ${inGallery(m.url) ? 'checked' : ''}> In gallery</label>
      <div class="btns"><button class="btn ghost sm" data-copy="${esc(m.url)}">Copy link</button><button class="btn danger sm" data-del="${esc(m.key)}" data-url="${esc(m.url)}">Delete</button></div></div></div>`).join('')
      : '<p>No uploads yet.</p>';
  }
  $('#panel').addEventListener('change', e => {
    const u = e.target.dataset.gal; if (!u) return;
    if (e.target.checked) C.gallery.push({ url: u, kind: e.target.dataset.kind, caption: '' });
    else C.gallery = C.gallery.filter(g => g.url !== u);
    markDirty();
  });
  $('#panel').addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]');
    if (c) { await navigator.clipboard.writeText(location.origin + c.dataset.copy); c.textContent = 'Copied'; setTimeout(() => c.textContent = 'Copy link', 1200); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!confirm('Delete this file permanently? It will disappear from anywhere it is used.')) return;
      const r = await api('/api/media?key=' + encodeURIComponent(d.dataset.del), { method: 'DELETE' });
      if (!r.ok) return alert(await errOf(r));
      const url = d.dataset.url;
      C.gallery = C.gallery.filter(g => g.url !== url);
      (function scrub(o) { for (const k in o) { if (o[k] === url) o[k] = ''; else if (o[k] && typeof o[k] === 'object') scrub(o[k]); } })(C);
      media = media.filter(m => m.key !== d.dataset.del); markDirty(); renderMedia();
    }
  });

  // ---------- upload
  function uploadOne(file, row) {
    return new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.open('PUT', '/api/media?name=' + encodeURIComponent(file.name));
      x.setRequestHeader('X-Requested-With', 'admin');
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = ev => { if (ev.lengthComputable) $('i', row).style.width = (ev.loaded / ev.total * 100) + '%'; };
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText); } catch {}
        if (x.status === 401) { showLogin(); return resolve(null); }
        if (x.status >= 200 && x.status < 300) { $('i', row).style.width = '100%'; row.firstChild.textContent = file.name + ' uploaded'; resolve(j); }
        else { row.classList.add('fail'); row.firstChild.textContent = file.name + ': ' + (j.error || 'upload failed'); resolve(null); }
      };
      x.onerror = () => { row.classList.add('fail'); row.firstChild.textContent = file.name + ': network error'; resolve(null); };
      x.send(file);
    });
  }
  async function uploadFiles(files, prog) {
    const out = [];
    for (const f of files) {
      const row = document.createElement('div'); row.className = 'prow';
      row.innerHTML = `<span>${esc(f.name)}</span><div class="bar2"><i></i></div>`; prog.appendChild(row);
      const j = await uploadOne(f, row); if (j) out.push(j);
    }
    return out;
  }
  function bindUpload() {
    const drop = $('#drop'), inp = $('#files'), prog = $('#prog');
    const go = async files => { const r = await uploadFiles([...files], prog); if (r.length) { await loadMedia(); } };
    inp.onchange = () => { go(inp.files); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', e => go(e.dataTransfer.files));
  }

  // ---------- image picker (single or multiple)
  function pickImage(multi = false) {
    return new Promise(async resolve => {
      const dlg = $('#picker'), grid = $('#pkGrid'), done = $('#pkDone');
      const sel = new Set(); let finished = false;
      const finish = v => { if (finished) return; finished = true; resolve(v); };
      $('#pkTitle').textContent = multi ? 'Choose photos (tap to select several)' : 'Choose a photo';
      done.hidden = !multi;
      if (!mediaLoaded) { const r = await api('/api/media'); if (r.ok) { media = (await r.json()).items; mediaLoaded = true; } }
      const upd = () => { done.textContent = `Add selected (${sel.size})`; done.disabled = !sel.size; };
      const draw = () => {
        const imgs = media.filter(m => m.kind === 'image');
        grid.innerHTML = imgs.length ? imgs.map(m => `<button class="mcard pick ${sel.has(m.url) ? 'sel' : ''}" data-url="${esc(m.url)}"><img class="pv" src="${esc(m.url)}" alt="${esc(m.name)}"><div class="mi"><div class="nm">${esc(m.name)}</div></div></button>`).join('') : '<p>No photos yet. Upload some above.</p>';
      };
      draw(); upd(); dlg.showModal();
      grid.onclick = e => {
        const b = e.target.closest('[data-url]'); if (!b) return;
        const u = b.dataset.url;
        if (!multi) { dlg.close(); finish({ url: u }); return; }
        if (sel.has(u)) sel.delete(u); else sel.add(u);
        b.classList.toggle('sel'); upd();
      };
      done.onclick = () => { dlg.close(); finish([...sel].map(url => ({ url }))); };
      $('#pkClose').onclick = () => dlg.close();
      dlg.onclose = () => finish(multi ? [] : null);
      $('#pkFile').onchange = async ev => {
        const files = [...ev.target.files]; ev.target.value = ''; if (!files.length) return;
        const tmp = document.createElement('div');
        const r = await uploadFiles(files, tmp); if (!r.length) return alert(tmp.textContent || 'Upload failed');
        await loadMedia(); if (multi) r.forEach(x => sel.add(x.url));
        draw(); upd();
      };
    });
  }

  start();
})();
