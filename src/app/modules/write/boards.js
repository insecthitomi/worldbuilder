/* Write · outline and corkboard: the story's scenes as index cards. Outline = one wide card per scene, grouped by
   chapter, with the synopsis editable in place and the columns you choose (point of view, place, date, status,
   words, cast, plot threads, beats). Corkboard = cards in a grid per chapter, coloured by status, point of view or
   plot thread. Both: drag to reorder or move between chapters, click to see the scene in the bible, double-click
   to write it. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;
  const PALETTE = ['#e0796b', '#6fa7d8', '#5fb38a', '#e2b33d', '#b07ad6', '#4fb6b2', '#e06aa8', '#c7835b', '#8c9fe0', '#9bc46b'];
  const hashColor = id => { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; };
  const COLS = [['pov', 'Point of view'], ['location', 'Location'], ['when', 'When'], ['status', 'Status'], ['words', 'Words'], ['cast', 'Characters'], ['threads', 'Plot threads'], ['beats', 'Goal · conflict · outcome']];
  W.hashColor = hashColor;

  W.boards = function (r, host) {
    const box = h('div.wbw-boards', { hidden: true });
    const bar = h('div.wbw-bhead');
    const scroll = h('div.wbw-bscroll');
    box.append(bar, scroll);
    host.appendChild(box);
    let kind = null, storyId = null, dirty = false, dragging = null, seq = 0;
    const excerpts = new Map();

    const peekChip = id => WB.ui.chip(id, { size: 'sm', onClick: x => WB.peek(x.id) });
    const sceneNo = new Map();
    const words = n => (n.kind === 'scene' ? n.words : n.total);

    function show(k, story) {
      kind = k; storyId = story ? story.id : null;
      box.hidden = false;
      render();
    }
    function hide() { box.hidden = true; kind = null; }
    async function render() {
      if (box.hidden) return;
      dirty = false;
      const my = ++seq;
      const st = r.model.get(storyId) || r.story();
      storyId = st ? st.id : null;
      paintBar(st);
      const top = scroll.scrollTop;
      if (!st) { GK.clear(scroll); scroll.appendChild(WB.ui.empty({ icon: '▦', title: 'No story yet', text: 'Start a story to see its scenes as cards.', actions: r.editable() ? [ui.button({ label: 'Start a story', kind: 'primary', onClick: () => r.newStory() })] : [] })); return; }
      sceneNo.clear();
      r.model.scenes(st.id).forEach((s, i) => sceneNo.set(s.id, i + 1));
      // a few lines of text for cards without a synopsis
      const need = r.model.scenes(st.id).filter(s => !s.summary && !excerpts.has(s.id)).map(s => s.id);
      if (need.length) {
        const got = await WB.api('write.bodies', need).catch(() => []);
        if (my !== seq) return;
        for (const b of got) excerpts.set(b.id, WB.text.text(WB.text.stripSecrets(b.body)).replace(/\s+/g, ' ').slice(0, 260));
      }
      let view;
      if (kind === 'grid') { view = await gridView(st, my); if (!view) return; }
      GK.clear(scroll);
      scroll.appendChild(view || (kind === 'cork' ? cork(st) : outline(st)));
      scroll.scrollTop = top;
      mark(r.sel, true);
    }
    function paintBar(st) {
      GK.clear(bar);
      const scenes = st ? r.model.scenes(st.id) : [];
      const done = scenes.filter(s => /^(Final|Revised)$/.test(W.status(s))).length;
      bar.append(
        h('div.wbw-bhead-l', [
          h('h3', { text: kind === 'cork' ? 'Corkboard' : kind === 'grid' ? 'Story grid' : 'Outline' }),
          st ? h('span.gk-small.gk-muted', { text: [r.model.children(st.id).filter(x => x.kind === 'chapter').length + ' chapters', scenes.length + ' scenes', W.num(st.total) + ' words', scenes.length ? done + ' revised or final' : ''].filter(Boolean).join(' · ') }) : null,
        ]),
        h('div.wbw-bhead-r', [
          kind === 'cork' ? h('span.gk-small.gk-muted', { text: 'Colour by' }) : null,
          kind === 'cork' ? ui.segmented({ value: r.pref('corkColor'), options: [['status', 'Status'], ['pov', 'POV'], ['thread', 'Thread']], onChange: v => { r.setPref('corkColor', v); render(); } }) : null,
          kind === 'cork' ? ui.segmented({ value: r.pref('corkSize'), options: [['s', 'S', 'Small cards'], ['m', 'M', 'Medium cards'], ['l', 'L', 'Large cards']], onChange: v => { r.setPref('corkSize', v); scroll.querySelectorAll('.wbw-cards').forEach(c => { c.dataset.size = v; }); } }) : null,
          kind === 'outline' ? ui.button({ label: 'Columns', icon: '▥', small: true, kind: 'ghost', title: 'Choose what each row shows', onClick: ev => colsMenu(ev.currentTarget) }) : null,
          st && r.editable() ? ui.group([
            ui.button({ label: 'Chapter', icon: '＋', small: true, title: 'Add a chapter at the end', onClick: () => r.add('chapter', { parentId: st.id }) }),
            ui.button({ label: 'Scene', icon: '＋', small: true, title: 'Add a scene to the last chapter', onClick: () => { const chs = r.model.children(st.id).filter(x => x.kind === 'chapter'); r.add('scene', { parentId: (chs[chs.length - 1] || st).id }); } }),
          ]) : null,
        ]),
      );
    }
    function colsMenu(at) {
      const on = new Set(r.pref('outlineCols') || []);
      WB.ui.menu([{ header: 'Show on each row' }].concat(COLS.map(([k, l]) => ({ label: l, checked: on.has(k), onClick: () => { if (on.has(k)) on.delete(k); else on.add(k); r.setPref('outlineCols', COLS.map(c => c[0]).filter(x => on.has(x))); render(); } }))), at);
    }

    /* ---------------- shared bits ---------------- */
    function statusBtn(n) {
      const st = W.status(n);
      return h('button.wbw-pill.btn', { type: 'button', style: { '--c': W.statusColor(n) || 'var(--faint)' }, text: st || 'No status', disabled: !r.editable(), title: 'Change the status', onclick: ev => { ev.stopPropagation(); WB.ui.menu(W.statusOptions(n).map(o => ({ label: o, icon: '●', checked: o === st, onClick: () => WB.api('entries.update', n.id, { fieldsPatch: { [W.statusKey(n)]: o === st ? '' : o } }) })), ev.currentTarget); } });
    }
    function wordsBox(n) {
      const w = words(n), t = r.model.target(n);
      return h('span.wbw-owords', { title: W.num(w) + ' words' + (t ? ' of ' + W.num(t) : '') }, [h('span', [h('b', { text: W.num(w) }), t ? h('span.gk-faint', { text: ' / ' + W.k(t) }) : null]), t ? W.bar(w / t) : null]);
    }
    function summaryEdit(n, placeholder) {
      const t = h('textarea.wbw-osum', { rows: 1, placeholder: r.editable() ? placeholder : '', spellcheck: true });
      t.readOnly = !r.editable();
      t.value = n.summary || '';
      const fit = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
      const save = WB.debounce(v => WB.api('entries.update', n.id, { summary: v }).catch(WB.fail), 600);
      t.addEventListener('input', () => { fit(); save(t.value); });
      t.addEventListener('blur', () => save.flush(t.value));
      t.addEventListener('click', e => e.stopPropagation());
      t.addEventListener('dblclick', e => e.stopPropagation());
      t.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') t.blur(); });
      requestAnimationFrame(fit);
      return t;
    }
    const select = (n, ev) => { if (ev && ev.target.closest('button, textarea, input, .wb-chip')) return; r.select(n.id); };
    const openWrite = n => { r.select(n.id, { mode: 'write' }); setTimeout(() => r.views.pages.focusEditor(), 120); };
    const actLabel = st => (W.storyIcon(st) === '❝' ? 'Act ' : 'Chapter ');

    /* ---------------- outline ---------------- */
    function outline(st) {
      const cols = new Set(r.pref('outlineCols') || []);
      const wrap = h('div.wbw-outline');
      let chapterNo = 0;
      const sceneRow = s => {
        const f = s.fields || {}, c = W.statusColor(s) || 'var(--line2)';
        const meta = h('div.wbw-ometa', [
          cols.has('status') ? statusBtn(s) : null,
          cols.has('pov') && f.pov ? h('div.wbw-ofield', [h('span.gk-faint', { text: 'POV' }), peekChip(f.pov)]) : null,
          cols.has('location') && f.location ? h('div.wbw-ofield', [h('span.gk-faint', { text: 'at' }), peekChip(f.location)]) : null,
          cols.has('when') && (s.start || s.end) ? h('div.wbw-ofield.gk-small.gk-muted', { text: '◷ ' + WB.fmt.span(s, 'short') }) : null,
          cols.has('words') ? wordsBox(s) : null,
        ]);
        const extra = [];
        if (cols.has('beats') && (f.goal || f.conflict || f.outcome)) extra.push(h('div.wbw-obeats', [['Goal', f.goal], ['Conflict', f.conflict], ['Outcome', f.outcome]].filter(x => x[1]).map(([k, v]) => h('span', [h('b', { text: k + ' ' }), v]))));
        if (cols.has('cast') && (f.cast || []).length) extra.push(h('div.wb-chips', (f.cast || []).map(peekChip)));
        if (cols.has('threads') && (f.threads || []).length) extra.push(h('div.wb-chips', (f.threads || []).map(peekChip)));
        const row = h('div.wbw-orow', { tabindex: 0, dataset: { id: s.id }, style: { '--c': c }, title: 'Click: details in the bible · double-click: write it · drag: move it', onclick: ev => select(s, ev), ondblclick: ev => { if (!ev.target.closest('textarea, button, .wb-chip')) openWrite(s); } }, [
          h('span.wbw-ograb', { text: '⋮⋮', 'aria-hidden': 'true' }),
          h('span.wbw-ono', { text: String(sceneNo.get(s.id) || '') }),
          h('div.wbw-omain', [
            h('div.wbw-otitle', [h('span.gk-ellipsis', { text: s.title })]),
            summaryEdit(s, 'What happens? A line or two…'),
            !s.summary && excerpts.get(s.id) ? h('div.wbw-oexcerpt', { text: excerpts.get(s.id) }) : null,
            ...extra,
          ]),
          meta,
        ]);
        dragSource(row, s);
        row.addEventListener('contextmenu', ev => { if (ev.target.closest('textarea')) return; ev.preventDefault(); WB.ui.entryMenu(r.model.lite(s), ev, [{ label: 'Write it', icon: '✎', onClick: () => openWrite(s) }]); });
        row.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === row) openWrite(s); });
        return row;
      };
      const loose = [];
      for (const c of r.model.children(st.id)) {
        if (c.kind === 'scene') { loose.push(c); continue; }
        if (loose.length) wrap.appendChild(group(null, loose.splice(0), sceneRow, st));
        chapterNo++;
        wrap.appendChild(group(c, r.model.descendants(c.id).filter(x => x.kind === 'scene'), sceneRow, st, chapterNo));
      }
      if (loose.length) wrap.appendChild(group(null, loose, sceneRow, st));
      if (!r.model.children(st.id).length) wrap.appendChild(WB.ui.empty({ icon: '☰', title: 'An empty story', text: 'Add a chapter, then scenes; each scene becomes a card here.', actions: r.editable() ? [ui.button({ label: 'Add a chapter', kind: 'primary', onClick: () => r.add('chapter', { parentId: st.id }) })] : [] }));
      return wrap;
    }
    function group(ch, scenes, sceneRow, st, no) {
      const g = h('section.wbw-ogroup', { dataset: { id: ch ? ch.id : st.id } });
      if (ch) {
        const head = h('div.wbw-ochap', { tabindex: 0, dataset: { id: ch.id }, style: { '--c': W.statusColor(ch) || 'var(--line2)' }, onclick: ev => select(ch, ev), ondblclick: ev => { if (!ev.target.closest('textarea, button')) { r.setPref('scriv', true); r.select(ch.id, { mode: 'write' }); } } }, [
          h('div.wbw-ochap-l', [h('span.wbw-ochap-no', { text: actLabel(st) + no }), h('div.wbw-ochap-title', { text: ch.title }), summaryEdit(ch, 'What this chapter does…')]),
          h('div.wbw-ochap-r', [statusBtn(ch), wordsBox(ch)]),
        ]);
        dragSource(head, ch);
        head.addEventListener('contextmenu', ev => { if (ev.target.closest('textarea')) return; ev.preventDefault(); WB.ui.entryMenu(r.model.lite(ch), ev); });
        g.appendChild(head);
      } else g.appendChild(h('div.wbw-ochap.loose', [h('div.wbw-ochap-l', [h('span.wbw-ochap-no', { text: 'Outside chapters' })])]));
      const list = h('div.wbw-orows', { dataset: { parent: ch ? ch.id : st.id } }, scenes.map(sceneRow));
      if (!scenes.length) list.appendChild(h('div.wbw-oempty.gk-small.gk-faint', { text: 'No scenes yet — drop one here or add one.' }));
      dropZone(list, ch ? ch.id : st.id, '.wbw-orow', 'y');
      g.appendChild(list);
      if (ch && r.editable()) g.appendChild(h('button.wbw-oadd', { type: 'button', onclick: () => r.add('scene', { parentId: ch.id }) }, ['＋ Scene in “' + ch.title + '”']));
      return g;
    }

    /* ---------------- corkboard ---------------- */
    function cardColor(s) {
      const mode = r.pref('corkColor'), f = s.fields || {};
      if (mode === 'pov') return f.pov ? hashColor(f.pov) : 'var(--line2)';
      if (mode === 'thread') return (f.threads || [])[0] ? hashColor(f.threads[0]) : 'var(--line2)';
      return W.statusColor(s) || 'var(--line2)';
    }
    const statusDot = s => { const st = W.status(s); return h('span.wbw-sdot', { class: st ? '' : 'none', style: { '--c': W.statusColor(s) || 'transparent' }, title: st || 'No status' }); };
    const initials = t => String(t || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    function card(s) {
      const f = s.fields || {}, pov = f.pov && WB.liteOf(f.pov);
      const ex = !s.summary && excerpts.get(s.id);
      const t = r.model.target(s);
      const el = h('article.wbw-card', { tabindex: 0, dataset: { id: s.id }, style: { '--c': cardColor(s) }, title: 'Click: details in the bible · double-click: write it · drag: move it', onclick: ev => select(s, ev), ondblclick: ev => { if (!ev.target.closest('button, .wb-chip')) openWrite(s); } }, [
        h('div.wbw-card-top', [h('span.wbw-card-no', { text: String(sceneNo.get(s.id) || '') }), h('span.wbw-card-title', { text: s.title }), statusDot(s)]),
        h('div.wbw-card-sum', { class: s.summary ? '' : 'excerpt', text: s.summary || ex || (r.editable() ? 'Empty — double-click to write it.' : '') }),
        h('div.wbw-card-foot', [
          pov ? h('span.wbw-card-pov', { title: 'Point of view: ' + pov.title, style: { '--p': hashColor(pov.id) } }, [h('i', { text: initials(pov.title) }), h('span.gk-ellipsis', { text: pov.title })]) : h('span.gk-faint.gk-tiny', { text: 'No point of view' }),
          h('span.wbw-card-w', { title: W.num(s.words) + ' words' + (t ? ' of ' + W.num(t) : '') }, [W.k(s.words), t ? h('span.gk-faint', { text: ' / ' + W.k(t) }) : ' w']),
        ]),
        t ? W.bar(s.words / t, 'card') : null,
      ]);
      dragSource(el, s);
      el.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.entryMenu(r.model.lite(s), ev, [{ label: 'Write it', icon: '✎', onClick: () => openWrite(s) }]); });
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === el) openWrite(s); });
      return el;
    }
    function cork(st) {
      const wrap = h('div.wbw-cork');
      let chapterNo = 0;
      const lane = (ch, scenes) => {
        const id = ch ? ch.id : st.id;
        const cards = h('div.wbw-cards', { dataset: { parent: id, size: r.pref('corkSize') || 'm' } }, scenes.map(card));
        if (r.editable()) cards.appendChild(h('button.wbw-card-add', { type: 'button', title: 'Add a scene here', onclick: () => r.add('scene', { parentId: id }) }, [h('span.wbw-card-add-ico', { text: '＋' }), h('span.gk-small', { text: 'Scene' })]));
        dropZone(cards, id, '.wbw-card', 'x');
        const head = ch ? h('div.wbw-lane-head', { tabindex: 0, dataset: { id: ch.id }, onclick: ev => select(ch, ev), ondblclick: ev => { if (!ev.target.closest('button')) { r.setPref('scriv', true); r.select(ch.id, { mode: 'write' }); } } }, [
          h('span.wbw-ochap-no', { text: actLabel(st) + (++chapterNo) }),
          h('b.wbw-lane-title.gk-ellipsis', { text: ch.title }),
          ch.summary ? h('span.gk-small.gk-muted.wbw-lane-sum.gk-ellipsis', { text: ch.summary }) : h('span.gk-grow'),
          statusBtn(ch), wordsBox(ch),
        ]) : h('div.wbw-lane-head', [h('span.wbw-ochap-no', { text: 'Outside chapters' })]);
        if (ch) { dragSource(head, ch); head.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.entryMenu(r.model.lite(ch), ev); }); }
        return h('section.wbw-lane', { dataset: { id } }, [head, cards]);
      };
      const loose = [];
      for (const c of r.model.children(st.id)) {
        if (c.kind === 'scene') { loose.push(c); continue; }
        if (loose.length) wrap.appendChild(lane(null, loose.splice(0)));
        wrap.appendChild(lane(c, r.model.descendants(c.id).filter(x => x.kind === 'scene')));
      }
      if (loose.length) wrap.appendChild(lane(null, loose));
      if (!r.model.children(st.id).length) wrap.appendChild(WB.ui.empty({ icon: '▦', title: 'An empty story', text: 'Add a chapter and scenes; they become cards you can shuffle.', actions: r.editable() ? [ui.button({ label: 'Add a chapter', kind: 'primary', onClick: () => r.add('chapter', { parentId: st.id }) })] : [] }));
      return wrap;
    }

    /* ---------------- story grid: scenes × characters, places, plot threads ---------------- */
    const GROUPS = [['character', 'Characters'], ['place', 'Places'], ['plot', 'Plot threads'], ['other', 'Also mentioned']];
    async function gridView(st, my) {
      const g = await WB.api('write.grid', st.id).catch(e => { WB.fail(e); return null; });
      if (my !== seq || !g) return null;
      const by = { character: [], place: [], plot: [], other: [] };
      for (const e of g.entries.filter(x => WB.visible(x))) { const t = WB.typeOf(e); by[t && by[t.key] && t.key !== 'other' ? t.key : 'other'].push(e); }
      for (const k of Object.keys(by)) by[k].sort((a, b) => b.scenes - a.scenes || a.title.localeCompare(b.title));
      by.other = by.other.slice(0, 10);
      const cols = GROUPS.flatMap(([k]) => by[k].map(e => ({ e, k })));
      if (!g.scenes.length) return WB.ui.empty({ icon: '▤', title: 'No scenes yet', text: 'The grid shows which characters, places and plot threads appear in each scene. Add scenes to fill it.' });
      if (!cols.length) return WB.ui.empty({ icon: '▤', title: 'Nobody in the scenes yet', text: 'Give scenes a point of view, characters, a location or plot threads (in the bible), or name your world’s entries in the text with @ — they appear here as columns.' });
      const edit = r.editable();
      const symbol = (c, k) => !c ? '' : c.pov ? '◉' : k === 'place' && c.location ? '⌂' : k === 'plot' && c.thread ? '◆' : c.cast ? '●' : c.mention ? '○' : '';
      const tip = (c, k, e, s) => {
        const what = !c ? 'not in this scene' : c.pov ? 'point of view' : c.cast ? 'in the scene' : c.location ? 'the location' : c.thread ? 'a thread of this scene' : 'named in the text';
        const act = !edit ? '' : k === 'character' ? ' · click: in / out of the cast · Shift+click: point of view' : k === 'place' ? ' · click: make it the location' : k === 'plot' ? ' · click: add or remove the thread' : '';
        return e.title + ' — ' + what + ' (“' + s.title + '”)' + act;
      };
      async function toggle(s, e, k, ev) {
        if (!edit) return;
        const f = s.fields || {}, p = {};
        if (k === 'character' && ev.shiftKey) p.pov = f.pov === e.id ? '' : e.id;
        else if (k === 'character') { const list = [].concat(f.cast || []); p.cast = list.includes(e.id) ? list.filter(x => x !== e.id) : list.concat(e.id); }
        else if (k === 'place') p.location = f.location === e.id ? '' : e.id;
        else if (k === 'plot') { const list = [].concat(f.threads || []); p.threads = list.includes(e.id) ? list.filter(x => x !== e.id) : list.concat(e.id); }
        else return WB.peek(e.id);
        try { await WB.api('entries.update', s.id, { fieldsPatch: p }); } catch (err) { WB.fail(err); }
      }
      const head1 = h('tr', [h('th.wbw-g-corner', { rowSpan: 2 }, [h('span.gk-small.gk-muted', { text: 'Scene' })])].concat(GROUPS.filter(([k]) => by[k].length).map(([k, l]) => h('th.wbw-g-group', { colSpan: by[k].length, class: 'g-' + k, text: l }))));
      const head2 = h('tr', cols.map(({ e, k }) => h('th.wbw-g-col', { class: 'g-' + k, style: { '--c': WB.colorOf(e) } }, [
        h('button.wbw-g-name', { type: 'button', title: e.title + ' — in ' + e.scenes + (e.scenes === 1 ? ' scene' : ' scenes') + ' · click to peek', onclick: () => WB.peek(e.id) }, [h('span.wbw-g-label', { text: e.title }), h('span.wbw-g-ico', { text: WB.iconOf(e) })]),
      ])));
      const body = h('tbody');
      const scenes = g.scenes.map(x => r.model.get(x.id)).filter(Boolean);
      let lastParent = null, no = 0, chNo = 0;
      for (const s of scenes) {
        if (s.parentId !== lastParent) {
          lastParent = s.parentId;
          const p = r.model.get(s.parentId);
          if (p && p.kind === 'chapter') body.appendChild(h('tr.wbw-g-chap', [h('th', { colSpan: cols.length + 1 }, [h('span.wbw-ochap-no', { text: actLabel(st) + (++chNo) }), ' ', h('b', { text: p.title })])]));
        }
        no++;
        const cs = g.cells[s.id] || {};
        body.appendChild(h('tr.wbw-g-row', { dataset: { id: s.id } }, [
          h('th.wbw-g-scene', [h('button', { type: 'button', title: 'Show “' + s.title + '” in the bible · double-click to write it', onclick: () => r.select(s.id), ondblclick: () => openWrite(s) }, [h('span.wbw-card-no', { text: String(no) }), statusDot(s), h('span.gk-ellipsis', { text: s.title })])]),
          ...cols.map(({ e, k }) => { const c = cs[e.id]; const sym = symbol(c, k); return h('td.wbw-g-cell', { class: 'g-' + k + (sym ? ' has' : '') + (c && c.pov ? ' pov' : '') + (c && !c.pov && !c.cast && !c.location && !c.thread ? ' only' : ''), style: { '--c': WB.colorOf(e) } }, [h('button', { type: 'button', title: tip(c, k, e, s), disabled: !edit && k !== 'other', onclick: ev => toggle(s, e, k, ev), text: sym })]); }),
        ]));
      }
      const foot = h('tr.wbw-g-foot', [h('th', { text: 'Scenes' })].concat(cols.map(({ e }) => h('td', { text: String(e.scenes) }))));
      return h('div.wbw-grid-wrap', [
        h('div.wbw-g-legend.gk-small.gk-muted', [h('span', [h('b', { text: '◉' }), ' point of view']), h('span', [h('b', { text: '●' }), ' in the scene']), h('span', [h('b', { text: '⌂' }), ' location']), h('span', [h('b', { text: '◆' }), ' plot thread']), h('span', [h('b', { text: '○' }), ' only named in the text']), edit ? h('span.gk-faint', { text: 'Click a cell to change it' }) : null]),
        h('div.wbw-g-scroll', [h('table.wbw-grid', [h('thead', [head1, head2]), body, h('tfoot', [foot])])]),
      ]);
    }

    /* ---------------- drag & drop (rows, cards, chapters) ---------------- */
    function dragSource(el, n) {
      if (!r.editable()) return;
      WB.dnd.entry(el, n.id);
      el.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('textarea')) return; dragging = n.id; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { dragging = null; el.classList.remove('dragging'); clear(); if (dirty) render(); });
    }
    let marked = null;
    const clear = () => { if (marked) marked.classList.remove('drop-before', 'drop-after', 'drop-end'); marked = null; };
    const undoMove = (n, oldParent, oldIndex, into) => WB.ui.undoToast(into && n.kind === 'scene' ? 'Moved “' + n.title + '” to “' + into.title + '”' : 'Moved “' + n.title + '”', () => WB.api('entries.move', n.id, { parentId: oldParent, index: oldIndex }));
    function dropZone(list, parentId, itemSel, axis) {
      const zone = e => {
        const n = dragging && r.model.get(dragging);
        if (!n || n.kind !== 'scene') return null;
        const item = e.target.closest(itemSel);
        if (!item || !list.contains(item)) return { el: list, cls: 'drop-end', move: { parentId } };
        if (item.dataset.id === n.id) return null;
        const rc = item.getBoundingClientRect();
        const before = axis === 'x' ? e.clientX < rc.left + rc.width / 2 : e.clientY < rc.top + rc.height / 2;
        return { el: item, cls: before ? 'drop-before' : 'drop-after', move: { parentId, [before ? 'beforeId' : 'afterId']: item.dataset.id } };
      };
      list.addEventListener('dragover', e => {
        const z = zone(e);
        if (!z) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (marked !== z.el || !z.el.classList.contains(z.cls)) { clear(); z.el.classList.add(z.cls); marked = z.el; }
      });
      list.addEventListener('dragleave', e => { if (!list.contains(e.relatedTarget)) clear(); });
      list.addEventListener('drop', async e => {
        const z = zone(e), id = dragging;
        clear();
        if (!z || !id) return;
        e.preventDefault(); e.stopPropagation();
        const n = r.model.get(id), oldParent = n.parentId, oldIndex = Math.max(0, r.model.children(oldParent).findIndex(x => x.id === id));
        dragging = null;
        try { await WB.api('entries.move', id, z.move); undoMove(n, oldParent, oldIndex, z.move.parentId !== oldParent ? r.model.get(z.move.parentId) : null); }
        catch (err) { WB.fail(err); }
      });
    }
    // chapters reorder by dropping them on another chapter's head (upper half: before, lower half: after)
    const headOf = e => e.target.closest && e.target.closest('.wbw-ochap[data-id], .wbw-lane-head[data-id]');
    box.addEventListener('dragover', e => {
      const head = headOf(e), n = dragging && r.model.get(dragging);
      if (!head || !n || n.kind !== 'chapter' || head.dataset.id === n.id) return;
      e.preventDefault();
      const rc = head.getBoundingClientRect(), cls = e.clientY < rc.top + rc.height / 2 ? 'drop-before' : 'drop-after';
      if (marked !== head || !head.classList.contains(cls)) { clear(); head.classList.add(cls); marked = head; }
    });
    box.addEventListener('drop', async e => {
      const head = headOf(e), n = dragging && r.model.get(dragging);
      if (!head || !n || n.kind !== 'chapter' || head.dataset.id === n.id) return;
      e.preventDefault();
      const before = head.classList.contains('drop-before');
      clear();
      const target = r.model.get(head.dataset.id), oldParent = n.parentId, oldIndex = Math.max(0, r.model.children(oldParent).findIndex(x => x.id === n.id));
      dragging = null;
      try { await WB.api('entries.move', n.id, { parentId: target.parentId, [before ? 'beforeId' : 'afterId']: target.id }); undoMove(n, oldParent, oldIndex, null); }
      catch (err) { WB.fail(err); }
    });

    function mark(id, quiet) {
      if (box.hidden) return;
      scroll.querySelectorAll('.wbw-orow, .wbw-card, .wbw-ochap, .wbw-lane-head, .wbw-g-row').forEach(el => el.classList.toggle('on', el.dataset.id === id));
      const el = !quiet && scroll.querySelector('.wbw-orow[data-id="' + id + '"], .wbw-card[data-id="' + id + '"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    function sync() {
      if (box.hidden) return;
      if ((box.contains(document.activeElement) && document.activeElement.matches('textarea, input')) || dragging) { dirty = true; return; }
      for (const id of [...excerpts.keys()]) { const n = r.model.get(id); if (!n || n.summary) excerpts.delete(id); }
      render();
    }
    box.addEventListener('focusout', () => setTimeout(() => { if (dirty && !dragging && !(box.contains(document.activeElement) && document.activeElement.matches('textarea, input'))) render(); }, 250));
    r.on('saved', id => excerpts.delete(id));
    return { show, hide, mark, sync, destroy() { } };
  };
})();
