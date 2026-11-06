/* Write · binder: the manuscript tree. Stories, chapters and scenes with status dots, live word counts (rolled up)
   and target bars; drag to reorder or move (drop above, below or into); add, rename (F2 / double-click), keyboard
   navigation, Alt+↑/↓ to move; drop a character, place or plot thread from anywhere onto a scene to attach it. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;

  W.storyIcon = s => (s && s.write && s.write.format === 'script' ? '❝' : '✎');

  W.binder = function (r, host) {
    const tree = h('div.wbw-tree', { role: 'tree', 'aria-label': 'Manuscript' });
    const foot = h('div.wbw-binder-foot');
    const addMenu = ev => WB.ui.menu([
      { label: 'New scene', icon: '❡', onClick: () => r.add('scene') },
      { label: 'New chapter', icon: '§', onClick: () => r.add('chapter') },
      '-',
      { label: 'New story or script…', icon: '✎', onClick: () => r.newStory() },
    ], ev.currentTarget || ev);
    const headEl = h('div.wbw-panel-head', [
      h('h3', { text: 'Manuscript' }),
      r.editable() ? ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'Add a scene, chapter or story', onClick: addMenu }) : null,
    ]);
    host.append(headEl, tree, foot);
    let rows = new Map(), renaming = null, dragging = null, dirty = false, today = null;

    const closedSet = () => new Set(r.wpref().closed || []);
    const setClosed = (id, on) => { const s = closedSet(); if (on) s.add(id); else s.delete(id); r.setW({ closed: [...s] }); };
    function toggle(id, on) { const s = closedSet(); setClosed(id, on == null ? !s.has(id) : on); render(); }

    /* ---------------- rendering ---------------- */
    function render() {
      if (renaming || dragging) { dirty = true; return; }
      dirty = false;
      const scroll = tree.scrollTop, hadFocus = tree.contains(document.activeElement);
      rows = new Map();
      GK.clear(tree);
      const m = r.model;
      if (!m.roots.length && !m.loose.length) {
        tree.appendChild(h('div.wbw-tree-empty', [
          h('p.gk-small.gk-muted', { text: 'Your stories appear here: chapters inside stories, scenes inside chapters.' }),
          r.editable() ? ui.button({ label: 'Start a story', icon: '✎', small: true, kind: 'primary', onClick: () => r.newStory() }) : null,
        ]));
      }
      const closed = closedSet();
      const walk = n => { addRow(n, closed); if (!closed.has(n.id)) for (const c of m.children(n.id)) walk(c); };
      m.roots.forEach(walk);
      if (m.loose.length) {
        tree.appendChild(h('div.wbw-tree-sec', { text: 'Not in a story', title: 'Chapters and scenes that sit outside every story. Drag them into one.' }));
        m.loose.forEach(walk);
      }
      tree.scrollTop = scroll;
      if (hadFocus) { const a = rows.get(r.sel); if (a) a.row.focus({ preventScroll: true }); }
      paintFoot();
    }
    function addRow(n, closed) {
      const m = r.model, kids = m.children(n.id), isClosed = closed.has(n.id);
      const childKind = m.childKind(n);
      const words = n.kind === 'scene' ? n.words : n.total;
      const tgt = m.target(n);
      const status = W.status(n);
      const cnt = h('span.wbw-count', { text: W.k(words), title: W.num(words) + ' words' + (n.kind !== 'scene' ? ' in all' : '') + (tgt ? ' · target ' + W.num(tgt) : '') });
      const trailing = h('span.wbw-tr', [
        childKind && r.editable() ? h('button.wbw-add', { type: 'button', tabindex: -1, title: 'Add a ' + childKind + ' to “' + n.title + '”', text: '+', onclick: ev => { ev.stopPropagation(); setClosed(n.id, false); r.add(childKind, { parentId: n.id }); } }) : null,
        h('span.wbw-sdot', { style: { '--c': W.statusColor(n) || 'transparent' }, class: status ? '' : 'none', title: status ? (n.kind === 'story' ? 'Stage: ' : 'Status: ') + status : 'No status yet' }),
        cnt,
      ]);
      const row = WB.ui.row(m.lite(n), {
        sub: '', indent: n.depth, active: n.id === r.sel, trailing, draggable: r.editable(),
        onClick: () => { if (renaming === n.id) return; r.select(n.id); },
        onDblClick: (x, ev) => { if (ev.target.closest('.wbw-caret, .wbw-add')) return; if (r.editable()) rename(n.id); },
        menuExtra: extras(n),
      });
      row.classList.add('wbw-node', 'k-' + n.kind);
      if (n.kind === 'story') row.querySelector('.wb-row-ico').textContent = n.icon || W.storyIcon(n);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(n.depth + 1));
      row.setAttribute('aria-selected', String(n.id === r.sel));
      if (kids.length) row.setAttribute('aria-expanded', String(!isClosed));
      row.insertBefore(h('button.wbw-caret', { type: 'button', tabindex: -1, class: kids.length ? '' : 'leaf', title: kids.length ? (isClosed ? 'Expand' : 'Collapse') : '', text: kids.length ? (isClosed ? '▸' : '▾') : '', onclick: ev => { ev.stopPropagation(); if (kids.length) toggle(n.id); } }), row.firstChild);
      let bar = null;
      if (tgt) { bar = W.bar(words / tgt, 'row'); bar.title = Math.round(words / tgt * 100) + '% of ' + W.num(tgt); row.appendChild(bar); }
      rows.set(n.id, { row, cnt, bar });
      tree.appendChild(row);
    }
    function extras(n) {
      const m = r.model, out = [];
      if (!r.editable()) return out;
      out.push('-');
      out.push({ label: 'Rename', icon: '✎', kbd: 'F2', onClick: () => rename(n.id) });
      const opts = W.statusOptions(n);
      out.push({ label: n.kind === 'story' ? 'Stage' : 'Status', icon: '●', sub: opts.map(o => ({ label: o, checked: W.status(n) === o, onClick: () => setField(n, W.statusKey(n), W.status(n) === o ? '' : o) })) });
      out.push({ label: 'Word target…', icon: '◎', onClick: () => askTarget(r, n) });
      const ck = m.childKind(n);
      if (ck) out.push({ label: 'Add a ' + ck, icon: '＋', onClick: () => r.add(ck, { parentId: n.id }) });
      if (n.kind === 'scene') {
        out.push({ label: 'New scene after this', icon: '❡', onClick: () => r.add('scene', { parentId: n.parentId, afterId: n.id }) });
        const nx = m.children(n.parentId).filter(x => x.kind === 'scene');
        const i = nx.findIndex(x => x.id === n.id);
        if (nx[i + 1]) out.push({ label: 'Join with “' + nx[i + 1].title + '”', icon: '⤓', hint: 'One scene with both texts; the second goes to the trash', onClick: () => join(n, nx[i + 1]) });
        out.push({ label: 'Write in focus mode', icon: '◎', onClick: () => { r.select(n.id, { mode: 'write' }); r.toggleFocus(true); } });
      }
      if (n.kind !== 'scene') out.push({ label: 'Read as one text', icon: '≡', onClick: () => { r.setPref('scriv', true); r.select(n.id, { mode: 'write' }); } });
      if (n.kind === 'story') out.push({ label: 'Compile…', icon: '⇩', onClick: () => W.compileDialog(r, n.id) });
      return out;
    }
    async function setField(n, key, v) { try { await WB.api('entries.update', n.id, { fieldsPatch: { [key]: v } }); } catch (e) { WB.fail(e); } }
    async function join(a, b) {
      try {
        const res = await WB.api('write.join', [a.id, b.id]);
        WB.ui.undoToast('Joined “' + b.title + '” into “' + a.title + '”', async () => { await WB.api('entries.update', a.id, { body: res.before }); for (const id of res.trashed) await WB.api('entries.restore', id); });
        r.select(a.id);
      } catch (e) { WB.fail(e); }
    }

    /** live word counts: only the changed rows */
    function patch(ids) {
      for (const id of ids) {
        const x = rows.get(id), n = r.model.get(id);
        if (!x || !n) continue;
        const w = n.kind === 'scene' ? n.words : n.total;
        x.cnt.textContent = W.k(w);
        const t = r.model.target(n);
        if (x.bar && t) W.setBar(x.bar, w / t);
      }
      paintFoot(true);
    }
    function mark() {
      for (const [id, x] of rows) { x.row.classList.toggle('on', id === r.sel); x.row.setAttribute('aria-selected', String(id === r.sel)); }
    }
    function reveal(id) {
      const closed = closedSet(), anc = r.model.ancestors(id).filter(a => closed.has(a.id));
      if (anc.length) { anc.forEach(a => closed.delete(a.id)); r.setW({ closed: [...closed] }); render(); }
      const x = rows.get(id);
      if (x) x.row.scrollIntoView({ block: 'nearest' });
    }

    /* ---------------- today's goal in the foot ---------------- */
    const loadToday = WB.debounce(async () => { today = await WB.api('writing.stats', r.worldId, 60).catch(() => null); paintFoot(); }, 1500);
    function paintFoot(quick) {
      const goal = (today && today.goal) || (WB.world && WB.world.settings.wordGoal) || 500;
      const t = Math.max(0, (today ? today.today : 0) + (quick ? 0 : 0));
      GK.clear(foot);
      foot.append(
        h('button.wbw-goal', { type: 'button', title: 'Words written today against your daily goal. Click for statistics.', onclick: () => r.setMode('stats') }, [
          h('div.wbw-goal-top', [h('span.gk-small', [h('b', { text: W.num(t) }), h('span.gk-muted', { text: ' / ' + W.num(goal) + ' today' })]), today && today.streak ? h('span.wbw-streak', { title: today.streak + '-day writing streak (best ' + today.best + ')', text: '✦ ' + today.streak }) : null]),
          W.bar(t / goal, 'goal'),
        ]),
      );
    }
    r.on('saved', () => loadToday());
    loadToday();

    /* ---------------- renaming ---------------- */
    function rename(id) {
      const x = rows.get(id), n = r.model.get(id);
      if (!x || !n || !r.editable()) return;
      if (renaming) return;
      const title = x.row.querySelector('.wb-row-title');
      const inp = h('input.wbw-rename', { value: n.title, spellcheck: false, 'aria-label': 'Title' });
      renaming = id;
      x.row.draggable = false;
      title.replaceWith(inp);
      inp.focus(); inp.select();
      const done = async save => {
        if (renaming !== id) return;
        renaming = null;
        const v = inp.value.trim();
        if (save && v && v !== n.title) { n.title = v; try { await WB.api('entries.update', id, { title: v }); } catch (e) { WB.fail(e); } }
        render();
        const a = rows.get(id); if (a) a.row.focus({ preventScroll: true });
      };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      ['click', 'dblclick', 'pointerdown', 'contextmenu'].forEach(t => inp.addEventListener(t, e => e.stopPropagation()));
      inp.addEventListener('blur', () => done(true));
    }

    /* ---------------- keyboard ---------------- */
    const visible = () => [...tree.querySelectorAll('.wbw-node')];
    const selectSoon = WB.debounce(id => r.select(id), 140);
    tree.addEventListener('keydown', async e => {
      if (renaming) return;
      const row = e.target.closest('.wbw-node');
      if (!row) return;
      const id = row.dataset.id, n = r.model.get(id);
      if (!n) return;
      const list = visible(), i = list.indexOf(row);
      const go = el => { if (!el) return; el.focus(); el.scrollIntoView({ block: 'nearest' }); selectSoon(el.dataset.id); };
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && r.editable()) {
        e.preventDefault(); e.stopPropagation();
        const sibs = r.model.children(n.parentId).length ? r.model.children(n.parentId) : (n.kind === 'story' ? r.model.roots : r.model.loose);
        const k = sibs.findIndex(x => x.id === id), other = sibs[k + (e.key === 'ArrowUp' ? -1 : 1)];
        if (!other) return;
        await WB.api('entries.move', id, { parentId: n.parentId, [e.key === 'ArrowUp' ? 'beforeId' : 'afterId']: other.id }).catch(WB.fail);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); go(list[i + 1]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(list[i - 1]); }
      else if (e.key === 'Home') { e.preventDefault(); go(list[0]); }
      else if (e.key === 'End') { e.preventDefault(); go(list[list.length - 1]); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (r.model.children(id).length && closedSet().has(id)) toggle(id, false); else go(list[i + 1]); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (r.model.children(id).length && !closedSet().has(id)) toggle(id, true); else { const p = r.model.parent(id); if (p && rows.get(p.id)) go(rows.get(p.id).row); } }
      else if (e.key === 'F2') { e.preventDefault(); rename(id); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); r.select(id); setTimeout(() => r.views.pages.focusEditor(), 60); }
      else if (e.key === 'Delete' && r.editable()) { e.preventDefault(); const nx = list[i + 1] || list[i - 1]; await WB.ui.confirmTrash(r.model.lite(n)); if (nx) selectSoon(nx.dataset.id); }
      else if (e.key === 'Insert' && r.editable()) { e.preventDefault(); r.add(n.kind === 'story' ? 'chapter' : 'scene', n.kind === 'scene' ? { parentId: n.parentId, afterId: n.id } : { parentId: n.id }); }
    });

    /* ---------------- drag & drop ---------------- */
    let marked = null;
    const clearMarks = () => { if (marked) marked.classList.remove('drop-before', 'drop-after', 'drop-in', 'drop-attach'); marked = null; };
    function zoneFor(row, e) {
      const m = r.model, target = m.get(row.dataset.id);
      if (!target) return null;
      const dragged = dragging ? m.get(dragging) : null;
      if (!dragged) return target.kind === 'scene' ? { where: 'attach', target } : null;   // an entry from elsewhere
      if (dragged.id === target.id || m.ancestors(target.id).some(a => a.id === dragged.id)) return null;
      const rc = row.getBoundingClientRect(), f = (e.clientY - rc.top) / Math.max(1, rc.height);
      const inside = m.canContain(target, dragged.kind);
      const parent = m.parent(target.id);
      const sib = target.kind === 'story' ? dragged.kind === 'story' : m.canContain(parent, dragged.kind) && !!parent;
      let where;
      if (inside && sib) where = f < .28 ? 'before' : f > .72 ? 'after' : 'in';
      else if (inside) where = 'in';
      else if (sib) where = f < .5 ? 'before' : 'after';
      else return null;
      // "after" an open container means "first inside it"
      if (where === 'after' && inside && m.children(target.id).length && !closedSet().has(target.id)) return { where: 'in', first: true, target, row: rows.get(m.children(target.id)[0].id) };
      return { where, target };
    }
    tree.addEventListener('dragstart', e => { const row = e.target.closest && e.target.closest('.wbw-node'); if (row && r.editable()) { dragging = row.dataset.id; row.classList.add('dragging'); } });
    tree.addEventListener('dragend', () => { const was = dragging; dragging = null; clearMarks(); tree.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); if (was && dirty) render(); });
    tree.addEventListener('dragover', e => {
      if (!WB.dnd.has(e) || !r.editable()) return;
      const row = e.target.closest('.wbw-node');
      const z = row && zoneFor(row, e);
      if (!z) { clearMarks(); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = z.where === 'attach' ? 'copy' : 'move';
      const el = z.row ? z.row.row : row, cls = z.row ? 'drop-before' : 'drop-' + z.where;
      if (marked !== el || !el.classList.contains(cls)) { clearMarks(); el.classList.add(cls); marked = el; }
    });
    tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clearMarks(); });
    tree.addEventListener('drop', async e => {
      const row = e.target.closest('.wbw-node'), id = WB.dnd.id(e);
      const z = row && zoneFor(row, e);
      clearMarks();
      if (!z || !id) return;
      e.preventDefault(); e.stopPropagation();
      const m = r.model, moving = m.get(id);
      dragging = null;
      if (!moving) return attach(z.target, id);
      const oldParent = moving.parentId || null;
      const sibs = oldParent ? m.children(oldParent) : (moving.kind === 'story' ? m.roots : m.loose);
      const oldIndex = Math.max(0, sibs.findIndex(x => x.id === id));
      let o;
      if (z.where === 'in') { o = { parentId: z.target.id }; if (z.first) o.index = 0; setClosed(z.target.id, false); }
      else o = { parentId: z.target.parentId || null, [z.where === 'before' ? 'beforeId' : 'afterId']: z.target.id };
      try {
        await WB.api('entries.move', id, o);
        const into = o.parentId && o.parentId !== oldParent ? m.get(o.parentId) : null;
        WB.ui.undoToast(into ? 'Moved “' + moving.title + '” into “' + into.title + '”' : 'Moved “' + moving.title + '”', () => WB.api('entries.move', id, { parentId: oldParent, index: oldIndex }));
      } catch (err) { WB.fail(err); }
    });
    /** a character, place or plot thread dropped on a scene joins it */
    async function attach(scene, id) {
      const lite = WB.liteOf(id), t = lite && WB.typeOf(lite);
      if (!lite || !t) return;
      const f = Object.assign({}, scene.fields), before = {};
      let what = '';
      const add = (key, single) => { before[key] = f[key]; if (single) f[key] = id; else { const list = (f[key] || []).slice(); if (list.includes(id)) return false; list.push(id); f[key] = list; } return true; };
      if (t.key === 'character') { if (!add('cast')) return ui.toast(lite.title + ' is already in this scene', 'ℹ'); what = 'the cast'; }
      else if (t.key === 'place') { add('location', true); what = 'the location'; }
      else if (t.key === 'plot') { if (!add('threads')) return ui.toast('Already a thread of this scene', 'ℹ'); what = 'the plot threads'; }
      else {
        const st = r.model.story(scene.id);
        if (!st) return;
        const pins = (st.write.pinned || []).slice();
        if (pins.includes(id)) return ui.toast('Already pinned to the story', 'ℹ');
        pins.push(id);
        await WB.api('write.saveData', st.id, { pinned: pins }).catch(WB.fail);
        return WB.ui.undoToast('Pinned “' + lite.title + '” to “' + st.title + '”', () => WB.api('write.saveData', st.id, { pinned: pins.filter(x => x !== id) }));
      }
      const patchF = {}; for (const k of Object.keys(before)) patchF[k] = f[k];
      try {
        await WB.api('entries.update', scene.id, { fieldsPatch: patchF });
        WB.ui.undoToast('“' + lite.title + '” added to ' + what + ' of “' + scene.title + '”', () => WB.api('entries.update', scene.id, { fieldsPatch: before }));
      } catch (err) { WB.fail(err); }
    }

    render();
    return { render, patch, mark, reveal, rename, destroy() { } };
  };

  /** asks for a word target and saves it on the node */
  async function askTarget(r, n) {
    const v = await ui.prompt('Word target for “' + n.title + '”', String(r.model.target(n) || ''), n.kind === 'story' ? 'e.g. 80000' : n.kind === 'chapter' ? 'e.g. 4000' : 'e.g. 1500');
    if (v == null) return;
    const num = Math.max(0, Math.round(+String(v).replace(/[^\d.]/g, '') || 0));
    try { await WB.api('entries.update', n.id, { fieldsPatch: { target: num || null } }); } catch (e) { WB.fail(e); }
  }
  W.askTarget = askTarget;
})();
