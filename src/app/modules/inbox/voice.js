/* Voice memos: record from the microphone (audio only) with a level meter and timer, listen back, name it, add a
   transcript, and keep it as a Note in the Inbox with the recording in the Library. A missing or blocked
   microphone gets a plain explanation and a way to capture the idea as text instead. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  if (root.WBVoice) return;
  const MAX_SECONDS = 20 * 60;
  let openNow = null;

  const pickMime = () => {
    if (!root.MediaRecorder) return '';
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    return '';
  };
  const stamp = () => { const d = new Date(); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  const explain = err => {
    const n = err && err.name;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root.MediaRecorder) return ['Recording isn\'t available here', 'This window can\'t record audio.'];
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return ['No microphone found', 'Plug in a microphone or headset (or switch it on in your sound settings), then try again.'];
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return ['The microphone is blocked', 'Allow apps to use the microphone in your system\'s privacy settings, then try again.'];
    if (n === 'NotReadableError' || n === 'TrackStartError') return ['The microphone is busy', 'Another program may be using it. Close that program and try again.'];
    return ['The microphone couldn\'t start', String((err && err.message) || err || 'Unknown problem')];
  };

  /** opts: { about: entryId, onSaved(entry) } → Promise<entry | null> */
  function open(opts = {}) {
    if (openNow) { openNow.focus(); return openNow.done; }
    if (!WB.worldId) { ui.toast('Open a world first', 'ℹ'); return Promise.resolve(null); }
    let resolveDone;
    const done = new Promise(r => { resolveDone = r; });
    let state = 'ask', stream = null, rec = null, chunks = [], blob = null, blobUrl = '', started = 0, paused = 0, pausedAt = 0, seconds = 0;
    let actx = null, analyser = null, raf = 0, levels = [], timerT = 0, about = opts.about || null, closed = false;

    const stage = h('div.vm-stage');
    const foot = h('div.gk-panel-foot.vm-foot');
    const panel = ui.panel({ title: 'Voice memo', icon: '●', cls: 'gk-dialog vm-dialog', body: [stage] });
    panel.appendChild(foot);
    panel.setAttribute('role', 'dialog');
    const scrim = h('div.gk-scrim.vm-scrim', [panel]);
    const title = ui.input({ value: 'Voice memo — ' + stamp(), placeholder: 'What is it about?' });
    title.classList.add('vm-title');
    const transcript = ui.input({ multiline: true, rows: 3, placeholder: 'Transcript (optional): type what you said, or the gist of it. You can add it later too.' });
    const aboutBox = h('div.gk-row.nowrap.vm-about');
    const paintAbout = () => {
      GK.clear(aboutBox);
      GK.append(aboutBox, [about ? WB.ui.chip(about, { size: 'sm', onRemove: () => { about = null; paintAbout(); } }) : h('span.gk-small.gk-muted', { text: 'Not linked to an entry' }),
        ui.button({ label: about ? 'Change…' : 'About…', small: true, kind: 'ghost', onClick: async () => { const p = await WB.ui.pickEntry({ title: 'What is the memo about?' }); if (p) { about = p.id; paintAbout(); } } })]);
    };
    paintAbout();

    /* ---------- recording ---------- */
    async function start() {
      state = 'ask'; paint();
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root.MediaRecorder) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (closed) { stopStream(); return; }
        const mime = pickMime();
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        chunks = []; levels = [];
        rec.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
        rec.addEventListener('stop', () => {
          blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(blob);
          stopStream();
          if (!closed) { state = blob.size ? 'review' : 'error'; paint(); }
        });
        try {
          actx = new (root.AudioContext || root.webkitAudioContext)();
          analyser = actx.createAnalyser(); analyser.fftSize = 1024;
          actx.createMediaStreamSource(stream).connect(analyser);
        } catch { analyser = null; }
        rec.start(250);
        started = performance.now(); paused = 0; pausedAt = 0;
        state = 'rec'; paint(); meter();
        timerT = setInterval(tickTimer, 200);
      } catch (err) {
        console.warn('Voice memo:', err && err.name, err && err.message);
        stopStream();
        state = 'error'; paint(explain(err && err.message === 'unsupported' ? null : err));
      }
    }
    const elapsed = () => ((pausedAt || performance.now()) - started - paused) / 1000;
    function tickTimer() {
      seconds = elapsed();
      const t = stage.querySelector('.vm-time');
      if (t) t.textContent = WBMediaKitTime(seconds);
      if (seconds >= MAX_SECONDS) stop();
    }
    function pauseResume() {
      if (!rec || state !== 'rec') return;
      if (rec.state === 'recording') { rec.pause(); pausedAt = performance.now(); }
      else if (rec.state === 'paused') { rec.resume(); paused += performance.now() - pausedAt; pausedAt = 0; }
      paint();
    }
    function stop() {
      if (!rec || rec.state === 'inactive') return;
      seconds = elapsed();
      clearInterval(timerT); cancelAnimationFrame(raf);
      rec.stop();
    }
    function stopStream() {
      clearInterval(timerT); cancelAnimationFrame(raf);
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (actx) { actx.close().catch(() => { }); actx = null; }
    }
    function meter() {
      const cv = stage.querySelector('canvas.vm-meter');
      if (!cv || !analyser) return;
      const buf = new Uint8Array(analyser.fftSize);
      const draw = () => {
        if (state !== 'rec' || !cv.isConnected) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const lvl = rec && rec.state === 'paused' ? 0 : Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        levels.push(lvl); if (levels.length > 400) levels.shift();
        const dpr = devicePixelRatio || 1, w = Math.max(1, Math.round(cv.clientWidth * dpr)), hh = Math.max(1, Math.round(cv.clientHeight * dpr));
        if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
        const g = cv.getContext('2d'), bar = 3 * dpr, gap = 2 * dpr, n = Math.floor(w / (bar + gap));
        g.clearRect(0, 0, w, hh);
        g.fillStyle = getComputedStyle(cv).color;
        const seen = levels.slice(-n);
        seen.forEach((v, i) => { const bh = Math.max(2 * dpr, v * hh * .92); g.globalAlpha = .35 + .65 * (i / Math.max(1, seen.length)); g.fillRect(w - (seen.length - i) * (bar + gap), (hh - bh) / 2, bar, bh); });
        const big = stage.querySelector('.vm-dot');
        if (big) big.style.setProperty('--lvl', lvl.toFixed(3));
        raf = requestAnimationFrame(draw);
      };
      draw();
    }
    const WBMediaKitTime = s => (root.WBMediaKit ? root.WBMediaKit.time(s) : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));

    /* ---------- saving ---------- */
    async function save() {
      if (!blob || !blob.size) return;
      const name = title.value.trim() || 'Voice memo — ' + stamp();
      const btns = foot.querySelectorAll('button'); btns.forEach(b => { b.disabled = true; });
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const ext = /ogg/.test(blob.type) ? '.ogg' : /mp4/.test(blob.type) ? '.m4a' : '.webm';
        const m = await WB.api('media.save', WB.worldId, { name: name + ext, mime: blob.type || 'audio/webm', bytes, kind: 'audio', duration: Math.round(seconds * 10) / 10, tags: ['voice memo'] });
        const body = about ? '<p>About <a class="wb-m" data-id="' + about + '">' + WB.esc(WB.titleOf(about) || 'an entry') + '</a></p>' : '';
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeKey: 'note', title: name.slice(0, 200), body, inbox: true, fields: { audio: m.id, transcript: transcript.value.trim() } });
        close(true);
        const t = WB.ui.undoToast('Voice memo saved to the Inbox', async () => { await WB.api('entries.purge', e.id); await WB.api('media.purge', m.id); });
        if (GK.shell.current !== 'inbox') t.appendChild(ui.button({ label: 'Open Inbox', small: true, onClick: () => { t.remove(); WB.go('inbox', { entryId: e.id }); } }));
        opts.onSaved && opts.onSaved(e);
        resolveDone(e);
      } catch (err) { btns.forEach(b => { b.disabled = false; }); WB.fail(err); }
    }

    /* ---------- painting ---------- */
    function paint(msg) {
      GK.clear(stage); GK.clear(foot);
      panel.dataset.state = state;
      const B = (o) => ui.button(o);
      if (state === 'ask') {
        stage.append(h('div.vm-center', [h('div.vm-dot.idle'), h('p.gk-muted', { text: 'Waiting for the microphone…' })]));
        foot.append(B({ label: 'Cancel', onClick: () => close() }));
      } else if (state === 'rec') {
        const isPaused = rec && rec.state === 'paused';
        stage.append(h('div.vm-rec', { class: isPaused ? 'paused' : '' }, [
          h('div.vm-dot', { title: isPaused ? 'Paused' : 'Recording' }),
          h('div.vm-readout', [h('div.vm-time', { text: WBMediaKitTime(seconds || elapsed()) }), h('div.gk-small.gk-muted', { text: isPaused ? 'Paused' : 'Recording — speak freely' })]),
        ]), h('canvas.vm-meter', { 'aria-hidden': 'true' }), h('div.gk-small.gk-faint.vm-keys', [WB.ui.kbd('Space'), ' stop  ', WB.ui.kbd('P'), ' pause  ', WB.ui.kbd('Esc'), ' cancel']));
        foot.append(B({ label: 'Cancel', kind: 'ghost', onClick: () => cancel() }), h('span.gk-grow'),
          B({ label: isPaused ? 'Resume' : 'Pause', icon: isPaused ? '●' : '❚❚', onClick: pauseResume }),
          B({ label: 'Stop', icon: '■', kind: 'primary', onClick: stop }));
        meter();
      } else if (state === 'review') {
        const player = root.WBMediaKit ? root.WBMediaKit.player({ id: 'memo', url: blobUrl, duration: seconds }) : h('audio', { src: blobUrl, controls: true });
        stage.append(h('div.vm-review', [
          player,
          ui.field({ label: 'Title', control: title }),
          ui.field({ label: 'Transcript', control: transcript }),
          ui.field({ label: 'About', control: aboutBox }),
        ]));
        foot.append(B({ label: 'Discard', kind: 'ghost', onClick: () => close() }), h('span.gk-grow'),
          B({ label: 'Record again', icon: '↺', onClick: () => { blob = null; seconds = 0; start(); } }),
          B({ label: 'Save to Inbox', icon: '✓', kind: 'primary', onClick: save }));
        setTimeout(() => { title.focus(); title.select(); }, 30);
      } else {
        const [head, text] = msg || ['Nothing was recorded', 'The recording came out empty. Check the microphone and try again.'];
        stage.append(h('div.vm-center.vm-error', [h('div.vm-err-ico', { text: '🎙' }), h('h3', { text: head }), h('p.gk-muted', { text })]));
        foot.append(B({ label: 'Write it down instead', icon: '✚', kind: 'ghost', onClick: () => { close(); WB.capture(); } }), h('span.gk-grow'),
          B({ label: 'Close', onClick: () => close() }), B({ label: 'Try again', icon: '↺', kind: 'primary', onClick: () => start() }));
      }
    }

    async function cancel() {
      if (state === 'rec' && elapsed() > 4) {
        if (rec && rec.state === 'recording') pauseResume();
        if (!(await ui.confirm('Discard this recording?', 'You have ' + WBMediaKitTime(elapsed()) + ' recorded. It will not be kept.', 'Discard', true))) return;
      }
      close();
    }
    function close(saved) {
      if (closed) return;
      closed = true;
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { }
      stopStream();
      if (root.WBMediaKit) root.WBMediaKit.stopAll();
      setTimeout(() => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, 1000);
      scrim.remove();
      document.removeEventListener('keydown', key, true);
      openNow = null;
      if (!saved) resolveDone(null);
    }
    const key = e => {
      const scrims = document.querySelectorAll('.gk-scrim');
      if (scrims[scrims.length - 1] !== scrim || document.querySelector('.wb-pop')) return;   // a dialog or menu on top handles its own keys
      const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (state === 'rec') cancel(); else close(); }
      else if (state === 'rec' && (e.key === ' ' || e.key === 'Enter') && !typing) { e.preventDefault(); stop(); }
      else if (state === 'rec' && e.key.toLowerCase() === 'p' && !typing) { e.preventDefault(); pauseResume(); }
      else if (state === 'review' && e.key === 'Enter' && (e.ctrlKey || !typing || e.target === title)) { e.preventDefault(); save(); }
    };
    document.addEventListener('keydown', key, true);
    scrim.addEventListener('click', e => { if (e.target === scrim && state !== 'rec') close(); });
    document.body.appendChild(scrim);
    openNow = { focus: () => panel.querySelector('button') && panel.querySelector('button').focus(), done };
    WB.loadScript('src/app/modules/library/media-kit.js').catch(() => { }).then(() => { if (!closed) start(); });
    return done;
  }

  root.WBVoice = { open };
})(window);
