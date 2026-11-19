(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => { u = String(u || ''); return /^(\/(?!\/)|https?:\/\/)/.test(u) && !/["'()<>\s]/.test(u) ? u : ''; };
  const H = { 'X-Requested-With': 'admin' };

  let C = {}, media = [], tab = 'home', dirty = false, mediaLoaded = false, pickResolve = null, setup = {};

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
    $('#login').hidden = true; $('#app').hidden = false;
    dirty = false; $('#save').disabled = true; status('');
    renderTabs(); renderPanel();
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
    ['recordings', 'Recordings'], ['gallery', 'Gallery'], ['media', 'Photos and Videos'], ['contact', 'Contact and Social']];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('');
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
    news: () => ({ id: Date.now().toString(36), title: '', date: new Date().toISOString().slice(0, 10), image: '', body: '' }),
    org: { name: '', role: '', photo: '' }, concerts: { title: '', date: '', time: '', venue: '', image: '', link: '' },
    recordings: { title: '', year: '', link: '', cover: '' }, 'about.paragraphs': '', 'vmo.objectives': '',
  };

  // ---------- panels
  const PANELS = {
    home: () => `<h2>Home page</h2><p class="note">The big photo behind the logo is optional. Without it the home page shows the logo and ribbon.</p><div class="fields">
      ${imgField('Hero background photo', 'hero.image')}${text('Headline', 'hero.tagline')}${text('Short intro', 'hero.lede', { area: 1, rows: 3 })}
      ${text('Button text', 'hero.buttonText')}${text('Quote', 'quote.text', { area: 1, rows: 3 })}${text('Quote by', 'quote.cite')}</div>`,
    news: () => `<h2>Latest News</h2><p class="note">Posts show on the home page (newest three, by date) and on the News page. Separate paragraphs with a blank line.</p><div class="fields">
      ${C.news.map((p, i) => `<div class="card">${cardHead('news', i, p.title || 'New post')}${text('Title', `news.${i}.title`)}${text('Date', `news.${i}.date`, { type: 'date' })}
      ${imgField('Photo (optional)', `news.${i}.image`)}${text('Post', `news.${i}.body`, { area: 1, rows: 8 })}</div>`).join('')}${addBtn('news', 'Add post')}</div>`,
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
  }

  // ---------- panel events
  $('#panel').addEventListener('input', e => { const p = e.target.dataset.p; if (p) set(p, e.target.value); });
  $('#panel').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'pick' || act === 'clear') {
      const p = b.closest('[data-ip]').dataset.ip;
      if (act === 'clear') set(p, ''); else { const m = await pickImage(); if (!m) return; set(p, m.url); }
      return renderPanel();
    }
    const l = b.dataset.l, i = +b.dataset.i, arr = get(l);
    if (act === 'add') { const n = typeof NEW[l] === 'function' ? NEW[l]() : typeof NEW[l] === 'object' ? { ...NEW[l] } : NEW[l]; if (l === 'news') arr.unshift(n); else arr.push(n); markDirty(); return renderPanel(); }
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

  // ---------- image picker
  function pickImage() {
    return new Promise(async resolve => {
      const dlg = $('#picker'), grid = $('#pkGrid');
      pickResolve = resolve;
      if (!mediaLoaded) { const r = await api('/api/media'); if (r.ok) { media = (await r.json()).items; mediaLoaded = true; } }
      const draw = () => {
        const imgs = media.filter(m => m.kind === 'image');
        grid.innerHTML = imgs.length ? imgs.map(m => `<button class="mcard pick" data-url="${esc(m.url)}"><img class="pv" src="${esc(m.url)}" alt="${esc(m.name)}"><div class="mi"><div class="nm">${esc(m.name)}</div></div></button>`).join('') : '<p>No photos yet. Upload one above.</p>';
      };
      draw(); dlg.showModal();
      grid.onclick = e => { const b = e.target.closest('[data-url]'); if (!b) return; dlg.close(); resolve({ url: b.dataset.url }); pickResolve = null; };
      $('#pkClose').onclick = () => dlg.close();
      dlg.onclose = () => { if (pickResolve) { pickResolve(null); pickResolve = null; } };
      $('#pkFile').onchange = async ev => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
        const tmp = document.createElement('div');
        const r = await uploadFiles([f], tmp); if (!r.length) return alert(tmp.textContent || 'Upload failed');
        await loadMedia(); draw();
      };
    });
  }

  start();
})();
