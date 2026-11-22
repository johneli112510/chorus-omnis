(async () => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => { u = String(u || '').trim(); return /^(\/(?!\/)|https?:\/\/)/.test(u) && !/["'()<>\s]/.test(u) ? u : ''; };
  const $ = (s, r = document) => r.querySelector(s);
  // light formatting: **bold**, *italic*, line breaks (everything is escaped first)
  const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');

  // Menu
  const btn = $('.menu-btn'), nav = $('#nav');
  btn.addEventListener('click', () => { const o = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });

  // Content
  let C;
  try { const r = await fetch('/api/content'); if (!r.ok) throw 0; C = await r.json(); }
  catch { C = await (await fetch('/assets/default-content.json')).json(); }
  const g = (o, k, d = '') => (o && o[k] != null ? o[k] : d);

  const ribbon = `<svg class="swirl" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 110 C 200 20, 400 170, 640 80 S 1050 10, 1200 90" fill="none" stroke="#a9c8f5" stroke-width="10" stroke-linecap="round"/>
    <path d="M0 125 C 220 50, 420 175, 650 100 S 1060 40, 1200 110" fill="none" stroke="#f3cf0c" stroke-width="5" stroke-linecap="round"/>
    <path d="M0 140 C 240 80, 440 180, 660 118 S 1070 70, 1200 130" fill="none" stroke="#d90f0f" stroke-width="8" stroke-linecap="round"/></svg>`;

  const img = (u, alt = '', cls = '') => safe(u) ? `<img class="${cls}" src="${esc(safe(u))}" alt="${esc(alt)}" loading="lazy">` : '';
  const pageHead = (t, sub) => `<section class="pagehead">${ribbon}<h1>${esc(t)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</section>`;
  const fmtDate = d => { const x = new Date(d + 'T00:00:00'); return isNaN(x) ? esc(d) : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const today = new Date().toISOString().slice(0, 10);
  const concerts = [...(C.concerts || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const upcoming = concerts.filter(c => !c.date || c.date >= today);
  const past = concerts.filter(c => c.date && c.date < today).reverse();
  const gallery = C.gallery || [];

  // ----- news
  const posts = [...(C.news || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const pid = p => String(p.id || '').replace(/[^a-z0-9-]/gi, '');
  const blocksOf = p => Array.isArray(p.blocks) ? p.blocks
    : String(p.body || '').split(/\n{2,}/).filter(x => x.trim()).map(text => ({ type: 'text', text }));
  const plain = s => String(s || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  const excerpt = (p, n = 170) => {
    const t = plain(p.summary || (blocksOf(p).find(b => b.type === 'text') || {}).text);
    return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '\u2026' : t;
  };
  const cover = p => p.image || (blocksOf(p).find(b => b.type === 'image' && safe(b.url)) || {}).url || '';
  const postCard = p => `<article class="post-card">
    ${safe(cover(p)) ? `<a href="/news/${pid(p)}">${img(cover(p), p.title, 'post-img')}</a>` : ''}
    <div class="post-meta">${p.date ? fmtDate(p.date) : ''}</div>
    <h3><a href="/news/${pid(p)}">${esc(p.title)}</a></h3><p>${esc(excerpt(p))}</p>
    <a class="readmore" href="/news/${pid(p)}">Read more</a></article>`;

  // ----- lightbox items for the current page
  let lbItems = [];

  const media = (m, i) => m.kind === 'video'
    ? `<figure class="gitem video"><video controls preload="metadata" playsinline src="${esc(safe(m.url))}"></video>${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`
    : `<figure class="gitem"><button data-lb="g${i}" aria-label="Open photo${m.caption ? ': ' + esc(m.caption) : ''}"><img src="${esc(safe(m.url))}" alt="${esc(m.caption)}" loading="lazy"></button>${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`;

  const event = c => `<article class="event">
    ${safe(c.image) ? img(c.image, c.title, 'event-img') : '<div class="event-img ph" aria-hidden="true"></div>'}
    <div class="event-date">${c.date ? fmtDate(c.date) : ''}${c.time ? `<span>${esc(c.time)}</span>` : ''}</div>
    <div class="event-body"><h3>${esc(c.title)}</h3><p>${esc(c.venue)}</p></div>
    ${safe(c.link) ? `<a class="btn small" href="${esc(safe(c.link))}" target="_blank" rel="noopener">Tickets and details</a>` : ''}</article>`;

  const heroSlides = h => {
    const l = (h.slides || []).map(x => typeof x === 'string' ? x : (x && x.url)).filter(u => safe(u));
    if (!l.length && safe(h.image)) l.push(h.image);
    return l.map(safe);
  };
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  function articleHtml(p) {
    const fig = b => {
      const k = 'p' + lbItems.length;
      lbItems.push({ k, url: safe(b.url), caption: plain(b.caption) });
      return `<figure class="fig"><button data-lb="${k}" aria-label="Enlarge photo"><img src="${esc(safe(b.url))}" alt="${esc(plain(b.caption))}" loading="lazy"></button>${b.caption ? `<figcaption>${fmt(b.caption)}</figcaption>` : ''}</figure>`;
    };
    let html = safe(p.image) ? fig({ url: p.image, caption: p.imageCaption }) : '';
    const bl = blocksOf(p);
    for (let i = 0; i < bl.length;) {
      const b = bl[i];
      if (b.type === 'image') {
        const grp = [];
        while (i < bl.length && bl[i].type === 'image') { if (safe(bl[i].url)) grp.push(bl[i]); i++; }
        if (grp.length === 1) html += fig(grp[0]);
        else if (grp.length > 1) html += `<div class="fig-grid n${Math.min(grp.length, 3)}">${grp.map(fig).join('')}</div>`;
        continue;
      }
      if (String(b.text || '').trim()) html += b.type === 'heading' ? `<h2>${esc(b.text)}</h2>` : `<p>${fmt(b.text)}</p>`;
      i++;
    }
    return html;
  }

  const views = {
    home() {
      const h = C.hero || {}, q = C.quote || {};
      const next = upcoming[0];
      const photos = gallery.filter(m => m.kind !== 'video').slice(0, 6);
      lbItems = gallery.map((m, i) => ({ k: 'g' + i, url: safe(m.url), caption: m.caption || '', video: m.kind === 'video' }));
      const slides = heroSlides(h), hasPhoto = slides.length > 0;
      const controls = slides.length > 1 ? `<button type="button" class="hero-arrow prev" data-dir="-1" aria-label="Previous photo">&#8249;</button><button type="button" class="hero-arrow next" data-dir="1" aria-label="Next photo">&#8250;</button>
        <div class="hero-dots" role="group" aria-label="Photo slideshow">${slides.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Show photo ${i + 1}"></button>`).join('')}</div>` : '';
      return `<section class="hero ${hasPhoto ? 'has-photo' : ''}">
        ${hasPhoto ? `<div class="hero-slides ${h.transition === 'fade' ? 'fade' : ''}" aria-hidden="true">${slides.map(() => '<div class="slide"></div>').join('')}</div><div class="hero-overlay"></div>` : ''}
        <div class="hero-inner"><div class="plate"><img src="${hasPhoto ? '/assets/logo-white.png' : '/assets/logo-transparent.png'}" alt="Chorus Omnis"></div>
        <h1>${esc(h.tagline)}</h1><p class="lede">${esc(h.lede)}</p>
        <a class="btn" href="/concerts.html">${esc(g(h, 'buttonText', 'See our concerts'))}</a></div>${controls}${ribbon}</section>
        ${q.text ? `<section class="band"><div class="narrow"><p class="quote">&ldquo;${esc(q.text)}&rdquo;</p><p class="cite">${esc(q.cite)}</p></div></section>` : ''}
        ${next ? `<section class="wrap"><h2 class="sec">Next concert</h2>${event(next)}</section>` : ''}
        ${posts.length ? `<section class="wrap"><h2 class="sec">Latest News</h2><div class="posts">${posts.slice(0, 3).map(postCard).join('')}</div>${posts.length > 3 ? '<p class="more"><a href="/news.html">All news</a></p>' : ''}</section>` : ''}
        ${photos.length ? `<section class="wrap"><h2 class="sec">From our gallery</h2><div class="gallery">${photos.map(m => media(m, gallery.indexOf(m))).join('')}</div><p class="more"><a href="/gallery.html">See all photos and videos</a></p></section>` : ''}
        <section class="grid3 wrap">
          <a class="tile" href="/about.html"><h2>About the choir</h2><p>Who we are and how we began.</p></a>
          <a class="tile" href="/recordings.html"><h2>Recordings</h2><p>Listen to our performances.</p></a>
          <a class="tile" href="/contact.html"><h2>Join or invite us</h2><p>Audition, book us, or say hello.</p></a></section>`;
    },
    news() {
      return pageHead('News', 'Stories and updates from Chorus Omnis') + `<section class="wrap"><div class="posts">${posts.map(postCard).join('') || '<p>No news yet. Check back soon.</p>'}</div></section>`;
    },
    post() {
      const m = location.pathname.match(/\/news\/([^/?#]+)/);
      let id = m ? decodeURIComponent(m[1]) : (new URLSearchParams(location.search).get('p') || '');
      id = id.replace(/[^a-z0-9-]/gi, '');
      const p = posts.find(x => pid(x) === id);
      if (!p) return pageHead('Story not found') + '<section class="wrap"><p><a href="/news.html">&larr; Back to News</a></p></section>';
      document.title = `${p.title} | Chorus Omnis`;
      const url = location.origin + '/news/' + pid(p);
      const enc = encodeURIComponent;
      const more = posts.filter(x => x !== p).slice(0, 4);
      const body = articleHtml(p);
      return `<section class="wrap article"><a class="back" href="/news.html">&larr; Back to News</a>
        <div class="post-meta">${p.date ? fmtDate(p.date) : ''}</div><h1>${esc(p.title)}</h1>
        <div class="story">${body}</div>
        <div class="share"><strong>Share this story</strong>
          <a href="https://wa.me/?text=${enc(p.title + ' \u2014 ' + url)}" target="_blank" rel="noopener">WhatsApp</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener">Facebook</a>
          <a href="https://twitter.com/intent/tweet?text=${enc(p.title)}&url=${enc(url)}" target="_blank" rel="noopener">X</a>
          <a href="mailto:?subject=${enc(p.title)}&body=${enc('Read this story: ' + url)}">Email</a></div>
        ${more.length ? `<div class="more-posts"><h2>More posts</h2><ul>${more.map(x => `<li><a href="/news/${pid(x)}">${esc(x.title)}</a><span>${x.date ? fmtDate(x.date) : ''}</span></li>`).join('')}</ul></div>` : ''}</section>`;
    },
    about() {
      const a = C.about || {};
      return pageHead('The Choir', 'Our story') + `<section class="wrap about ${safe(a.image) ? 'with-img' : ''}">
        ${safe(a.image) ? img(a.image, 'Chorus Omnis', 'about-img') : ''}
        <div class="prose">${(a.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}</div></section>`;
    },
    organization() {
      return pageHead('Organization', 'The people who lead and serve Chorus Omnis') + `<section class="wrap people">${(C.org || []).map(p => `
        <div class="person">${safe(p.photo) ? img(p.photo, p.name, 'avatar') : `<div class="avatar ph">${esc(initials(p.name))}</div>`}
        <h3>${esc(p.name)}</h3><p>${esc(p.role)}</p></div>`).join('')}</section>`;
    },
    vmo() {
      const v = C.vmo || {};
      return pageHead('Vision, Mission and Objectives') + `<section class="wrap prose">
        <h2>Vision</h2><p>${esc(v.vision)}</p><h2>Mission</h2><p>${esc(v.mission)}</p>
        <h2>Objectives</h2><ul>${(v.objectives || []).map(o => `<li>${esc(o)}</li>`).join('')}</ul></section>`;
    },
    concerts() {
      return pageHead('Concerts', 'Upcoming and past performances') + `<section class="wrap">
        <h2 class="sec">Upcoming</h2>${upcoming.map(event).join('') || '<p>No concerts are scheduled right now. Check back soon.</p>'}
        ${past.length ? `<h2 class="sec">Past performances</h2>${past.map(event).join('')}` : ''}</section>`;
    },
    gallery() {
      lbItems = gallery.map((m, i) => ({ k: 'g' + i, url: safe(m.url), caption: m.caption || '', video: m.kind === 'video' }));
      return pageHead('Gallery', 'Photos and videos from Chorus Omnis') + `<section class="wrap">${gallery.length
        ? `<div class="gallery">${gallery.map(media).join('')}</div>` : '<p>Photos and videos are coming soon.</p>'}</section>`;
    },
    recordings() {
      return pageHead('Recordings', 'Listen to Chorus Omnis') + `<section class="wrap grid3">${(C.recordings || []).map(r => `
        <div class="tile static rec">${safe(r.cover) ? img(r.cover, r.title, 'cover') : '<div class="cover ph">&#9835;</div>'}
        <h2>${esc(r.title)}</h2><p>${esc(r.year)}${safe(r.link) ? ` &middot; <a href="${esc(safe(r.link))}" target="_blank" rel="noopener">Listen</a>` : ''}</p></div>`).join('')}</section>`;
    },
    contact() {
      const c = C.contact || {};
      return pageHead('Contact', 'Audition, book us for an event, or send a message') + `<section class="wrap contact">
        <form id="cform"><label>Name<input name="name" required maxlength="100" autocomplete="name"></label><label>Email<input type="email" name="email" required maxlength="200" autocomplete="email"></label>
        <label>Message<textarea name="message" rows="6" required maxlength="5000"></textarea></label>
        <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn" type="submit">Send message</button><p class="form-status" id="cstatus" role="status"></p></form>
        <aside class="info"><h2>Get in touch</h2>${c.email ? `<p>${esc(c.email)}</p>` : ''}${c.phone ? `<p>${esc(c.phone)}</p>` : ''}${c.address ? `<p>${esc(c.address)}</p>` : ''}</aside></section>`;
    },
  };

  const root = $('#root');
  root.innerHTML = (views[root.dataset.page] || views.home)();

  // Hero slideshow
  const heroEl = $('.hero.has-photo');
  if (heroEl) {
    const urls = heroSlides(C.hero || {});
    const els = [...heroEl.querySelectorAll('.slide')];
    els.forEach((el, i) => { el.style.backgroundImage = `url("${encodeURI(urls[i])}")`; });
    els[0].classList.add('active');
    if (els.length > 1) {
      const dots = [...heroEl.querySelectorAll('.hero-dots button')];
      const delay = Math.max(3, Number(C.hero.interval) || 10) * 1000;
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      urls.forEach(u => { const im = new Image(); im.src = u; });
      let cur = 0, timer = null;
      const mark = () => dots.forEach((d, i) => d.setAttribute('aria-current', i === cur ? 'true' : 'false'));
      const go = (n, dir = 1) => {
        const old = cur; n = (n + els.length) % els.length;
        if (n === old) return;
        cur = n;
        els.forEach((el, i) => { if (i !== old && i !== n) { el.style.transition = 'none'; el.className = 'slide'; } });
        const nw = els[n], ol = els[old];
        nw.style.transition = 'none'; nw.className = dir > 0 ? 'slide' : 'slide prev';
        void nw.offsetWidth;
        nw.style.transition = ''; ol.style.transition = '';
        ol.className = dir > 0 ? 'slide prev' : 'slide';
        nw.className = 'slide active';
        mark();
      };
      const stop = () => { clearInterval(timer); timer = null; };
      const start = () => { stop(); if (!reduce) timer = setInterval(() => go(cur + 1), delay); };
      heroEl.addEventListener('click', e => {
        const d = e.target.closest('[data-slide]'), a = e.target.closest('[data-dir]');
        if (d) { const n = +d.dataset.slide; go(n, n > cur ? 1 : -1); start(); }
        else if (a) { go(cur + +a.dataset.dir, +a.dataset.dir); start(); }
      });
      heroEl.addEventListener('mouseenter', stop);
      heroEl.addEventListener('mouseleave', start);
      let x0 = null;
      heroEl.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
      heroEl.addEventListener('touchend', e => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 50) { go(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); start(); }
      }, { passive: true });
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
      mark(); start();
    }
  }

  // Home page: header fades away while scrolling down, returns when scrolling up
  if (root.dataset.page === 'home') {
    const top = $('.top'); let last = window.scrollY, ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (nav.classList.contains('open') || y < 80 || y < last - 4) top.classList.remove('fade');
        else if (y > last + 4 && y > 160) top.classList.add('fade');
        last = y; ticking = false;
      });
    }, { passive: true });
  }

  // Social links
  const labels = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', spotify: 'Spotify', tiktok: 'TikTok' };
  $('#social').innerHTML = Object.entries(labels).filter(([k]) => safe(C.social?.[k]))
    .map(([k, l]) => `<a href="${esc(safe(C.social[k]))}" target="_blank" rel="noopener">${l}</a>`).join('');

  // Contact form: sends the message to the website (the admin reads it under Messages)
  const f = $('#cform');
  if (f) {
    const t0 = Date.now();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const st = $('#cstatus'), bt = f.querySelector('button'), d = new FormData(f);
      bt.disabled = true; st.className = 'form-status'; st.textContent = 'Sending...';
      try {
        const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: d.get('name'), email: d.get('email'), message: d.get('message'), website: d.get('website'), t: t0 }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Could not send your message.');
        f.innerHTML = '<div class="thanks"><h2>Thank you!</h2><p>Your message was sent. We will get back to you soon.</p></div>';
      } catch (err) {
        st.className = 'form-status err';
        st.textContent = (err.message || 'Could not send your message.') + (C.contact && C.contact.email ? ` You can also email us at ${C.contact.email}.` : '');
        bt.disabled = false;
      }
    });
  }

  // Lightbox (photos only)
  const photos = lbItems.filter(m => !m.video && m.url);
  if (photos.length) {
    const dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.innerHTML = '<button class="lb-close" aria-label="Close">&times;</button><button class="lb-prev" aria-label="Previous">&#8249;</button><figure><img alt=""><figcaption></figcaption></figure><button class="lb-next" aria-label="Next">&#8250;</button>';
    document.body.appendChild(dlg);
    let cur = 0;
    const show = n => { cur = (n + photos.length) % photos.length; const m = photos[cur]; $('img', dlg).src = m.url; $('img', dlg).alt = m.caption; $('figcaption', dlg).textContent = m.caption; };
    root.addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (!b) return; const n = photos.findIndex(m => m.k === b.dataset.lb); if (n < 0) return; show(n); dlg.showModal(); });
    $('.lb-close', dlg).onclick = () => dlg.close();
    $('.lb-prev', dlg).onclick = () => show(cur - 1);
    $('.lb-next', dlg).onclick = () => show(cur + 1);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
  }
})();
