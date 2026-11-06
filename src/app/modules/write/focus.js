/* Write · focus mode (Ctrl+Shift+F): only the text. The navigation, binder, bible and toolbars step away, the wallpaper
   dims, the line you type stays at eye height (typewriter scrolling, setting wbTypewriter), the paragraph you are in
   stays bright. A quiet bar (it fades while you type) shows the session's words, a timer or a sprint countdown,
   today's words against the daily goal (world setting wordGoal), the streak and the scene's target. Esc leaves. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;
  const SPRINTS = [[0, 'Stopwatch'], [10, '10 min sprint'], [15, '15 min sprint'], [25, '25 min sprint'], [45, '45 min sprint'], [60, '60 min sprint']];
  let F = null;   // the running focus session

  function set(r, on) {
    const html = document.documentElement;
    if (on) start(r); else stop(r);
    html.classList.toggle('wb-focus', on);
    r.el.root.classList.toggle('is-focus', on);
    r.el.mainPanel.dataset.mat = on ? 'clear' : '';
    if (!on) delete r.el.mainPanel.dataset.mat;
    r.paintPanels();
    GK.layout('write-focus');
    requestAnimationFrame(() => { try { if (window.Prism && Prism.active) Prism.sync(); } catch { } });
  }

  function start(r) {
    if (F) stop(r);
    const bar = h('div.wbw-focusbar.gk-nolens', { role: 'toolbar', 'aria-label': 'Focus mode' });
    F = { r, bar, startedAt: Date.now(), s0: W.sessionTotal(), active0: W.session.active, today0: 0, goal: (WB.world && WB.world.settings.wordGoal) || 500, streak: 0, best: 0, wrote0: false, sprint: 0, sprintEnd: 0, celebrated: false, offs: [] };
    r.el.root.appendChild(bar);
    r.el.root.classList.toggle('typewriter', GK.settings.get('wbTypewriter') !== false);
    r.el.root.classList.toggle('parafocus', !!r.pref('paraFocus'));
    r.el.root.dataset.dim = r.pref('focusDim') || 'dim';
    WB.api('writing.stats', r.worldId, 400).then(s => { if (!F || !s) return; F.today0 = s.today || 0; F.goal = s.goal || F.goal; F.streak = s.streak || 0; F.best = s.best || 0; F.wrote0 = (s.today || 0) > 0; F.celebrated = F.today0 >= F.goal; paint(); }).catch(() => {});
    // the bar fades while typing and comes back when the mouse moves
    let idleT = 0;
    const wake = () => { bar.classList.remove('idle'); clearTimeout(idleT); };
    const sleep = () => { clearTimeout(idleT); idleT = setTimeout(() => bar.classList.add('idle'), 900); };
    const onMove = e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) wake(); };
    const onKey = e => {
      if (e.key === 'Escape' && !document.querySelector('.gk-scrim, .wb-pop, .wb-peek') && F) { e.preventDefault(); r.toggleFocus(false); return; }
      if (r.el.main.contains(e.target)) sleep();
    };
    const onSel = () => { if (!F) return; caretWork(r); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', onSel);
    F.offs.push(() => { document.removeEventListener('mousemove', onMove); document.removeEventListener('keydown', onKey, true); document.removeEventListener('selectionchange', onSel); clearTimeout(idleT); });
    F.offs.push(r.on('tick', () => paint()));
    F.offs.push(r.on('words', () => paint()));
    F.offs.push(r.on('shown', () => { paint(); setTimeout(() => caretWork(r), 50); }));
    paint();
    setTimeout(() => { r.views.pages.focusEditor(); caretWork(r); }, 80);
  }

  function stop(r) {
    if (!F) return;
    const words = W.sessionTotal() - F.s0, secs = Math.round((Date.now() - F.startedAt) / 1000);
    const n = r.node(), st = r.story();
    if (secs > 20 && (words || W.session.active - F.active0 > 10)) WB.api('write.session', r.worldId, { storyId: st && st.id, entryId: n && n.id, startedAt: new Date(F.startedAt).toISOString(), seconds: secs, words, goal: F.goal, kind: F.sprint ? 'sprint' : 'focus' }).catch(() => {});
    W.sessionFlush();
    F.offs.forEach(u => { try { u(); } catch { } });
    F.bar.remove();
    r.el.root.querySelectorAll('.wbw-cur').forEach(x => x.classList.remove('wbw-cur'));
    if (words > 0 && secs > 60) ui.toast('Focus session: +' + W.num(words) + ' words in ' + W.minutes(secs), '◎', 4200);
    F = null;
  }

  /** typewriter scrolling and the bright paragraph, from wherever the caret is */
  function caretWork(r) {
    const s = getSelection();
    if (!s.rangeCount) return;
    const node = s.anchorNode, sheet = r.views.pages.sheet(), scroll = r.views.pages.scroller();
    if (!node || !sheet.contains(node)) return;
    const el = node.nodeType === 3 ? node.parentNode : node;
    const ed = el.closest && el.closest('.wb-editor');
    if (r.el.root.classList.contains('parafocus')) {
      let blk = el.closest && el.closest('.wb-editor > *');
      if (!blk && ed && node === ed) blk = ed.children[Math.max(0, Math.min(ed.children.length - 1, s.anchorOffset - 1))];
      sheet.querySelectorAll('.wbw-cur').forEach(x => { if (x !== blk) x.classList.remove('wbw-cur'); });
      if (blk) blk.classList.add('wbw-cur');
    }
    if (!r.el.root.classList.contains('typewriter') || !ed) return;
    const range = s.getRangeAt(0).cloneRange();
    range.collapse(true);
    let rc = range.getClientRects()[0];
    if (!rc) { const b = (el.closest && el.closest('.wb-editor > *')) || el; rc = b.getBoundingClientRect(); }
    const sc = scroll.getBoundingClientRect();
    const want = sc.top + sc.height * .42;
    const delta = rc.top + rc.height / 2 - want;
    if (Math.abs(delta) > 3) scroll.scrollTop += GK.local(scroll, delta);
  }

  function paint() {
    if (!F) return;
    const r = F.r, bar = F.bar;
    const n = r.node();
    const words = W.sessionTotal() - F.s0;
    const today = Math.max(0, F.today0 + words);
    const secs = Math.round((Date.now() - F.startedAt) / 1000);
    const left = F.sprint ? Math.max(0, Math.round((F.sprintEnd - Date.now()) / 1000)) : 0;
    if (F.sprint && left === 0 && !F.sprintDone) {
      F.sprintDone = true;
      ui.toast('Sprint done: +' + W.num(words - (F.sprintW0 || 0)) + ' words in ' + F.sprint + ' minutes', '⏱', 6000);
      WB.api('write.session', r.worldId, { storyId: r.story() && r.story().id, entryId: n && n.id, startedAt: new Date(F.sprintEnd - F.sprint * 60000).toISOString(), seconds: F.sprint * 60, words: words - (F.sprintW0 || 0), goal: F.goal, kind: 'sprint' }).catch(() => {});
    }
    if (!F.celebrated && F.goal && today >= F.goal) { F.celebrated = true; ui.toast('Daily goal reached — ' + W.num(today) + ' words today', '✦', 5000); }
    const streak = F.streak + (!F.wrote0 && today > 0 ? 1 : 0);
    const scene = n && n.kind === 'scene' ? n : null, tgt = scene ? r.model.target(scene) : 0;
    const prev = n && r.model.neighbour(n.kind === 'scene' ? n.id : (r.model.scenes(n.id)[0] || n).id, -1), next = n && r.model.neighbour(n.kind === 'scene' ? n.id : (r.model.scenes(n.id).slice(-1)[0] || n).id, 1);
    const sig = [n && n.id, n && n.title, words, today, Math.floor(F.sprint ? left : secs), streak, scene && scene.words, r.pref('paraFocus'), r.pref('focusDim'), GK.settings.get('wbTypewriter'), F.sprint].join('|');
    if (sig === F.sig) return;
    F.sig = sig;
    const B = (label, title, fn, cls) => h('button.wbw-fb-btn', { type: 'button', title, class: cls || '', onclick: fn, onmousedown: e => e.preventDefault() }, label);
    GK.clear(bar);
    GK.append(bar, [
      h('div.wbw-fb-group', [
        B('‹', prev ? 'Previous scene: ' + prev.title : 'No earlier scene', () => prev && r.select(prev.id), prev ? '' : 'off'),
        h('span.wbw-fb-title.gk-ellipsis', { title: n ? n.title : '', text: n ? n.title : '' }),
        B('›', next ? 'Next scene: ' + next.title : 'No later scene', () => next && r.select(next.id), next ? '' : 'off'),
      ]),
      h('div.wbw-fb-stat', { title: 'Words this focus session' }, [h('b', { text: (words >= 0 ? '+' : '') + W.num(words) }), h('span', { text: 'session' })]),
      B([h('b', { text: W.clock(F.sprint ? left : secs) }), h('span', { text: F.sprint ? 'sprint left' : 'focused' })], 'Start a timed sprint or keep the stopwatch', ev => sprintMenu(ev.currentTarget), 'wbw-fb-stat' + (F.sprint ? ' sprint' : '')),
      h('div.wbw-fb-stat.goal', { title: W.num(today) + ' of your daily goal of ' + W.num(F.goal) + ' words (change it in Stats)' }, [h('div', [h('b', { text: W.num(today) }), h('span', { text: ' / ' + W.num(F.goal) + ' today' })]), W.bar(F.goal ? today / F.goal : 0, 'fb')]),
      h('div.wbw-fb-stat', { title: 'Days in a row with words written (best ' + F.best + ')' }, [h('b.wbw-fb-streak', { text: '✦ ' + streak }), h('span', { text: streak === 1 ? 'day' : 'days' })]),
      scene ? h('div.wbw-fb-stat', { title: tgt ? Math.round(scene.words / tgt * 100) + '% of this scene’s target' : 'Words in this scene' }, [h('b', { text: W.num(scene.words) }), h('span', { text: tgt ? '/ ' + W.num(tgt) + ' in scene' : 'in scene' })]) : null,
      h('div.wbw-fb-group', [
        B('⇣', 'Typewriter scrolling: the line you type stays at eye height', () => { GK.settings.set('wbTypewriter', !(GK.settings.get('wbTypewriter') !== false)); r.el.root.classList.toggle('typewriter', GK.settings.get('wbTypewriter') !== false); paint(); }, GK.settings.get('wbTypewriter') !== false ? 'on' : ''),
        B('¶', 'Light only the paragraph you are in', () => { r.setPref('paraFocus', !r.pref('paraFocus')); r.el.root.classList.toggle('parafocus', !!r.pref('paraFocus')); if (!r.pref('paraFocus')) r.el.root.querySelectorAll('.wbw-cur').forEach(x => x.classList.remove('wbw-cur')); paint(); }, r.pref('paraFocus') ? 'on' : ''),
        B('◑', 'How dark the surroundings are', () => { const order = ['dim', 'dark', 'soft']; const v = order[(order.indexOf(r.pref('focusDim') || 'dim') + 1) % order.length]; r.setPref('focusDim', v); r.el.root.dataset.dim = v; paint(); }),
        B('✕', 'Leave focus mode (Esc)', () => r.toggleFocus(false), 'exit'),
      ]),
    ]);
  }
  function sprintMenu(at) {
    if (!F) return;
    WB.ui.menu(SPRINTS.map(([m, l]) => ({ label: l, checked: F.sprint === m, onClick: () => {
      F.sprint = m; F.sprintDone = false; F.sprintEnd = Date.now() + m * 60000; F.sprintW0 = W.sessionTotal() - F.s0;
      if (!m) { F.startedAt = F.startedAt || Date.now(); }
      F.sig = ''; paint();
      if (m) ui.toast(m + '-minute sprint: go!', '⏱');
    } })), at, { side: 'below' });
  }

  W.focus = { set };
})();
