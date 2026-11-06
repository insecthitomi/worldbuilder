/* Media pieces shared by the Library, the Inbox and Boards: a mini audio player, an image lightbox with zoom,
   file badges and a few formatters. Loaded on demand with WB.loadScript. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  if (root.WBMediaKit) return;
  const K = root.WBMediaKit = {};

  K.time = s => (!isFinite(s) || s < 0 ? '0:00' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));
  K.ext = m => String((m && (m.file || m.name)) || '').split('.').pop().toUpperCase().slice(0, 4);
  K.kindIcon = k => ({ image: '▣', audio: '♪', video: '▶', file: '▤' })[k] || '▤';
  K.kindLabel = k => ({ image: 'Image', audio: 'Audio', video: 'Video', file: 'File' })[k] || 'File';
  K.dims = m => (m && m.width && m.height ? m.width + ' × ' + m.height : '');
  K.meta = m => [m.kind === 'image' ? K.dims(m) : '', (m.kind === 'audio' || m.kind === 'video') && m.duration ? K.time(m.duration) : '', m.size ? WB.fmt.bytes(m.size) : ''].filter(Boolean).join(' · ');
  /** a stable pseudo-waveform for an audio item (bars 0..1 from its id) */
  K.wave = (id, n = 36) => { let s = 0; for (const c of String(id || 'x')) s = (s * 31 + c.charCodeAt(0)) >>> 0; return Array.from({ length: n }, (_, i) => { s = (s * 1664525 + 1013904223) >>> 0; const env = Math.sin(Math.PI * (i + .5) / n); return .18 + .82 * env * (.35 + .65 * (s / 4294967296)); }); };
  K.waveEl = (id, n) => h('div.mk-wave', { 'aria-hidden': 'true' }, K.wave(id, n).map(v => h('i', { style: { height: Math.round(v * 100) + '%' } })));

  /* ---------------- mini audio player ---------------- */
  let playing = null;
  K.stopAll = () => { if (playing) { try { playing.pause(); } catch { } } };
  K.isPlaying = () => !!(playing && !playing.paused);
  /** m: media object or id; opts: { compact, duration, onPlay } */
  K.player = function (m, opts = {}) {
    const btn = h('button.mk-play', { type: 'button', title: 'Play', 'aria-label': 'Play', text: '▶' });
    const fill = h('i.mk-fill'), knob = h('i.mk-knob');
    const bar = h('div.mk-bar', { role: 'slider', tabindex: 0, 'aria-label': 'Position', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, [fill, knob]);
    const time = h('span.mk-time', { text: K.time(opts.duration || (m && m.duration) || 0) });
    const el = h('div.mk-player', { class: opts.compact ? 'compact' : '' }, [btn, bar, time]);
    let audio = null, dur = opts.duration || (m && typeof m === 'object' && m.duration) || 0, raf = 0;
    const length = () => (audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : dur);
    const paint = () => {
      const d = length(), t = audio ? audio.currentTime : 0, f = d ? Math.min(1, t / d) : 0;
      fill.style.width = (f * 100) + '%'; knob.style.left = (f * 100) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      time.textContent = audio && (t > 0 || !audio.paused) ? K.time(t) + (d ? ' / ' + K.time(d) : '') : K.time(d);
    };
    const tick = () => { paint(); if (audio && !audio.paused) raf = requestAnimationFrame(tick); };
    async function load() {
      if (audio) return audio;
      const mm = typeof m === 'string' ? await WB.media(m) : m;
      if (!mm || !mm.url) { el.classList.add('missing'); time.textContent = 'File missing'; return null; }
      dur = dur || mm.duration || 0;
      audio = new Audio(mm.url);
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', paint);
      audio.addEventListener('play', () => { if (playing && playing !== audio) playing.pause(); playing = audio; el.classList.add('on'); btn.textContent = '❚❚'; btn.title = 'Pause'; btn.setAttribute('aria-label', 'Pause'); cancelAnimationFrame(raf); tick(); opts.onPlay && opts.onPlay(); });
      audio.addEventListener('pause', () => { el.classList.remove('on'); btn.textContent = '▶'; btn.title = 'Play'; btn.setAttribute('aria-label', 'Play'); paint(); });
      audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); });
      audio.addEventListener('error', () => { el.classList.add('missing'); time.textContent = 'Can\'t play this file'; });
      return audio;
    }
    const toggle = async () => { const a = await load(); if (!a) return; if (a.paused) a.play().catch(() => { }); else a.pause(); };
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    const seekTo = async (e) => {
      const a = await load(); if (!a) return;
      const r = bar.getBoundingClientRect(), f = Math.max(0, Math.min(1, GK.local(bar, e.clientX - r.left) / (bar.clientWidth || 1)));
      const d = length(); if (d) { a.currentTime = f * d; paint(); }
    };
    bar.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault(); bar.setPointerCapture(e.pointerId); seekTo(e);
      const mv = ev => seekTo(ev), up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    });
    bar.addEventListener('keydown', async e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const a = await load(); if (!a) return;
      a.currentTime = Math.max(0, Math.min(length() || 0, a.currentTime + (e.key === 'ArrowLeft' ? -5 : 5))); paint();
    });
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('dblclick', e => e.stopPropagation());
    el.toggle = toggle;
    el.stop = () => { if (audio) audio.pause(); };
    return el;
  };

  /* ---------------- lightbox (body-level overlay in screen px) ---------------- */
  /** list: media objects (images are zoomable, others show their player/info); index: the one to show first */
  K.lightbox = function (list, index = 0, { onOpen } = {}) {
    list = (list || []).filter(Boolean);
    if (!list.length) return;
    let i = Math.max(0, Math.min(list.length - 1, index)), z = 1, fit = 1, tx = 0, ty = 0, nat = { w: 1, h: 1 };
    const sc = (GK.uiScale && GK.uiScale().used) || 1;
    const img = h('img.mk-lb-img', { alt: '', draggable: false });
    const other = h('div.mk-lb-other');
    const stage = h('div.mk-lb-stage', [img, other]);
    const title = h('b.gk-ellipsis'), info = h('span.mk-lb-info');
    const pct = h('span.mk-lb-pct');
    const B = (icon, label, fn, extra) => { const b = ui.button({ icon, small: true, kind: 'ghost', title: label, onClick: fn }); b.setAttribute('aria-label', label); if (extra) b.classList.add(extra); return b; };
    const bar = h('div.mk-lb-bar', { style: { zoom: String(sc) } }, [
      h('div.mk-lb-title', [title, info]),
      h('div.gk-row.nowrap', [B('−', 'Zoom out (−)', () => zoomBy(1 / 1.25)), pct, B('＋', 'Zoom in (+)', () => zoomBy(1.25)), B('⤢', 'Fit (0)', () => reset()), B('1:1', 'Actual size (1)', () => setZoom(1)),
        onOpen ? B('↗', 'Show in the Library', () => { close(); onOpen(list[i]); }) : null, B('✕', 'Close (Esc)', () => close())]),
    ]);
    const prev = h('button.mk-lb-nav.prev', { type: 'button', title: 'Previous (←)', 'aria-label': 'Previous', text: '‹', style: { zoom: String(sc) }, onclick: () => go(-1) });
    const next = h('button.mk-lb-nav.next', { type: 'button', title: 'Next (→)', 'aria-label': 'Next', text: '›', style: { zoom: String(sc) }, onclick: () => go(1) });
    const box = h('div.mk-lb.gk-dialog', { role: 'dialog', 'aria-label': 'Preview' }, [stage, bar, list.length > 1 ? prev : null, list.length > 1 ? next : null]);
    const apply = () => { img.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + z + ')'; pct.textContent = Math.round(z * 100) + '%'; };
    function reset() {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      fit = Math.min(1, (sw - 40) / nat.w, (sh - 40) / nat.h) || 1;
      z = fit; tx = (sw - nat.w * z) / 2; ty = (sh - nat.h * z) / 2; apply();
    }
    function setZoom(nz, cx, cy) {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      if (cx == null) { cx = sw / 2; cy = sh / 2; }
      nz = Math.max(Math.min(fit, .05), Math.min(16, nz));
      tx = cx - (cx - tx) * (nz / z); ty = cy - (cy - ty) * (nz / z); z = nz; apply();
    }
    const zoomBy = (k, cx, cy) => setZoom(z * k, cx, cy);
    function show() {
      const m = list[i];
      title.textContent = m.name || 'Untitled';
      info.textContent = [K.kindLabel(m.kind), K.meta(m), list.length > 1 ? (i + 1) + ' / ' + list.length : ''].filter(Boolean).join(' · ');
      GK.clear(other);
      if (m.kind === 'image') {
        img.hidden = false; other.hidden = true;
        img.onload = () => { nat = { w: img.naturalWidth || m.width || 800, h: img.naturalHeight || m.height || 600 }; reset(); };
        img.src = m.url;
      } else {
        img.hidden = true; other.hidden = false;
        other.append(h('div.mk-lb-file', { text: m.kind === 'audio' ? '♪' : m.kind === 'video' ? '' : K.ext(m) }),
          m.kind === 'audio' ? K.player(m) : m.kind === 'video' ? h('video.mk-lb-video', { src: m.url, controls: true }) : h('p.gk-muted', { text: 'No preview for this kind of file.' }));
        pct.textContent = '';
      }
    }
    const go = d => { i = (i + d + list.length) % list.length; show(); };
    stage.addEventListener('wheel', e => {
      if (img.hidden) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * .0016), e.clientX - r.left, e.clientY - r.top);   // check-ok: screen (body-level overlay) lint-ui: ok
    }, { passive: false });
    stage.addEventListener('pointerdown', e => {
      if (img.hidden || e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = tx, oy = ty;   // check-ok: screen (body-level overlay) lint-ui: ok
      stage.setPointerCapture(e.pointerId); stage.classList.add('drag');
      const mv = ev => { tx = ox + ev.clientX - sx; ty = oy + ev.clientY - sy; apply(); };   // check-ok: screen (body-level overlay) lint-ui: ok
      const up = () => { stage.classList.remove('drag'); stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', up); };
      stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up);
    });
    stage.addEventListener('dblclick', e => { if (img.hidden) return; const r = stage.getBoundingClientRect(); if (Math.abs(z - fit) < .01) setZoom(Math.max(1, fit * 2), e.clientX - r.left, e.clientY - r.top); else reset(); });   // check-ok: screen (body-level overlay) lint-ui: ok
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
      else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.25); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
      else if (e.key === '1') { e.preventDefault(); setZoom(1); }
    };
    const relayout = GK.bus.on('layout', () => { if (!img.hidden) reset(); });
    function close() { K.stopAll(); box.remove(); document.removeEventListener('keydown', key, true); relayout(); }
    document.addEventListener('keydown', key, true);
    document.body.appendChild(box);
    show();
    return { close };
  };

  /** an image/audio/video/file thumbnail element for a media object (cover-fitted) */
  K.thumb = function (m, { wave = true } = {}) {
    if (!m) return h('div.mk-thumb.missing', { text: '?' });
    if (m.kind === 'image') return h('img.mk-thumb', { src: m.url, alt: '', loading: 'lazy', decoding: 'async', draggable: false });
    if (m.kind === 'video') { const v = h('video.mk-thumb', { src: m.url + '#t=0.1', preload: 'metadata', muted: true, draggable: false }); return v; }
    if (m.kind === 'audio') return h('div.mk-thumb.audio', [wave ? K.waveEl(m.id) : null]);
    return h('div.mk-thumb.file', [h('span.mk-ext', { text: K.ext(m) || 'FILE' })]);
  };
})(window);
