/* Write · pages: the text. One scene (or a chapter's / story's own text) as a page, or a whole chapter or story as one
   continuous text ("as one text": every scene editable in place between separators). One formatting toolbar for
   all of them, screenplay elements for script stories, split at the cursor, and find & replace (this page or the
   whole story, with Undo). Mentions peek instead of leaving the manuscript. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;

  W.pages = function (r, host) {
    const box = h('div.wbw-pages', { hidden: true });
    const head = h('div.wbw-mainhead');
    const tb = h('div.wbw-tb', { role: 'toolbar', 'aria-label': 'Formatting' });
    const findEl = h('div.wbw-find', { hidden: true });
    const sheet = h('div.wbw-sheet');
    const scroll = h('div.wbw-scroll', [sheet]);
    box.append(head, tb, findEl, scroll);
    host.appendChild(box);
    let eds = new Map(), active = null, shown = null, dirty = false, stateEl = null, stateT = null;

    const scriptStory = n => { const s = n && r.model.story(n.id); return !!(s && s.write.format === 'script'); };
    const isScriv = n => !!n && n.kind !== 'scene' && !!r.pref('scriv');
    const idsFor = n => (isScriv(n) ? [n.id].concat(r.model.descendants(n.id).map(x => x.id)) : [n.id]);

    /* ---------------- save state ---------------- */
    function setState(s) {
      if (!stateEl) return;
      clearTimeout(stateT);
      stateEl.className = 'wbw-state ' + s;
      stateEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved' : 'Saved';
      stateEl.title = s === 'error' ? 'The last change could not be saved. Keep this screen open and try again.' : 'Everything you write is saved as you go';
    }
    async function save(id, html) {
      const rec = eds.get(id);
      if (!rec || rec.dead) return;
      setState('saving');
      rec.savedAt = Date.now();
      rec.saving = WB.api('entries.update', id, { body: html }).then(() => { rec.lastSaved = html; rec.savedAt = Date.now(); setState('saved'); r.emit('saved', id); }, e => { setState('error'); WB.fail(e); });
      return rec.saving;
    }
    async function flushAll() { for (const rec of eds.values()) rec.api.flush(); await Promise.all([...eds.values()].map(x => x.saving).filter(Boolean)); }

    /* ---------------- editors ---------------- */
    function placeholder(n) {
      if (scriptStory(n)) return n.kind === 'scene' ? 'INT. A PLACE – NIGHT    then action, a NAME in capitals, and what they say…' : 'Notes for this act (compiled before its scenes)…';
      if (n.kind === 'scene') return 'Write the scene…   Type @ to link a character, place or thing from your world.';
      if (n.kind === 'chapter') return 'Opening text or notes for this chapter (compiled before its scenes)…';
      return 'Notes about the story — premise, structure, research. This page is not compiled.';
    }
    function makeEditor(n, body) {
      const rec = { id: n.id, lastSaved: body, ready: false, savedAt: 0 };
      const api = WB.editor.create({
        value: body, toolbar: false, cls: 'wbw-ed', delay: 600, placeholder: placeholder(n),
        onChange: html => save(n.id, html),
        onWords: w => { if (rec.ready) r.liveWords(n.id, w); },
        onFocus: () => { active = n.id; markActive(); },
      });
      rec.api = api;
      W.sessionTouch(n.id, api.words());
      if (r.model.get(n.id) && r.model.get(n.id).words !== api.words()) r.model.setWords(n.id, api.words());
      rec.ready = true;
      api.ed.addEventListener('keydown', () => W.sessionPing(n.id));
      api.ed.addEventListener('input', () => { W.sessionPing(n.id); if (scriptStory(n)) decorateSoon(rec); r.emit('typing', n.id); });
      // in the manuscript a click on a mention peeks (the drawer has Open); it never leaves the page
      api.el.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a.wb-m'); if (a && !a.classList.contains('gone')) { e.preventDefault(); e.stopPropagation(); WB.peek(a.dataset.id); } }, true);
      if (scriptStory(n)) { api.el.classList.add('is-script'); decorate(rec); }
      eds.set(n.id, rec);
      return api.el;
    }
    /* screenplay styling: every paragraph gets its element from its text (never stored) */
    function decorate(rec) {
      const SP = window.WBScript; if (!SP) return;
      const ps = [...rec.api.ed.children];
      const kinds = SP.classifyAll(ps.map(p => (p.tagName === 'P' ? p.textContent : '')));
      ps.forEach((p, i) => { if (p.tagName === 'P') p.dataset.sp = kinds[i]; });
    }
    let decT = 0;
    const decorateSoon = rec => { cancelAnimationFrame(decT); decT = requestAnimationFrame(() => decorate(rec)); };
    function markActive() { for (const [id, rec] of eds) rec.api.el.classList.toggle('active', id === active && eds.size > 1); paintTb(); }
    function destroyEditors() { for (const rec of eds.values()) { try { rec.api.destroy(); } catch { } } eds = new Map(); active = null; }

    /* ---------------- the page ---------------- */
    function crumbs(n) {
      const list = r.model.ancestors(n.id).concat([n]);
      return h('nav.wbw-crumbs', { 'aria-label': 'Where you are' }, list.map((x, i) => [
        i ? h('span.wbw-crumb-sep', { text: '›' }) : null,
        h('button.wbw-crumb', { type: 'button', class: i === list.length - 1 ? 'cur' : '', title: x.kind === 'scene' ? 'Open this scene' : 'Open ' + x.title, onclick: () => r.select(x.id) }, [h('span.wbw-crumb-ico', { text: x.kind === 'story' ? W.storyIcon(x) : WB.iconOf(r.model.lite(x)), style: { color: WB.colorOf(r.model.lite(x)) } }), h('span.gk-ellipsis', { text: x.title })]),
      ]));
    }
    function paintHead(n) {
      GK.clear(head);
      head.hidden = false;
      stateEl = h('span.wbw-state.saved', { text: 'Saved' });
      const words = n.kind === 'scene' || !isScriv(n) ? n.words : n.total;
      head.append(
        crumbs(n),
        h('div.wbw-mainhead-r', [
          n.kind !== 'scene' ? ui.segmented({ value: isScriv(n) ? 'all' : 'page', options: [['page', 'Own page', 'This ' + n.kind + '’s own text'], ['all', 'As one text', 'Every scene inside, one after another, each editable in place']], onChange: v => { r.setPref('scriv', v === 'all'); show(n, { force: true }); } }) : null,
          h('span.wbw-hwords', { title: W.readTime(words) }, [h('b', { text: W.num(words) }), ' words']),
          stateEl,
        ]),
      );
    }
    function metaFor(n) {
      const box = h('div.wbw-meta');
      const fill = () => {
        GK.clear(box);
        const st = W.status(n), tgt = r.model.target(n), words = n.kind === 'scene' ? n.words : n.total;
        box.append(h('button.wbw-pill.btn', { type: 'button', style: { '--c': W.statusColor(n) || 'var(--faint)' }, title: 'Change the ' + (n.kind === 'story' ? 'stage' : 'status'), text: st || (n.kind === 'story' ? 'No stage' : 'No status'), disabled: !r.editable(), onclick: ev => statusMenu(n, ev.currentTarget) }));
        const wb = h('button.wbw-wordpill', { type: 'button', title: tgt ? Math.round(words / tgt * 100) + '% of the target · click to change it' : 'Set a word target', disabled: !r.editable(), onclick: () => W.askTarget(r, n) }, [h('span.wbw-wp-n', { text: W.num(words) }), h('span.gk-muted', { text: tgt ? ' / ' + W.num(tgt) : ' words' }), tgt ? W.bar(words / tgt, 'meta') : h('span.gk-faint', { text: '  ◎' })]);
        box.appendChild(wb);
        const f = n.fields || {};
        if (f.pov) box.appendChild(h('span.wbw-metaf', [h('span.gk-faint', { text: 'POV' }), WB.ui.chip(f.pov, { size: 'sm', onClick: x => WB.peek(x.id) })]));
        if (f.location) box.appendChild(h('span.wbw-metaf', [h('span.gk-faint', { text: 'at' }), WB.ui.chip(f.location, { size: 'sm', onClick: x => WB.peek(x.id) })]));
        const when = WB.fmt.span(n);
        if (when) box.appendChild(h('span.wbw-metaf.gk-small.gk-muted', { text: '◷ ' + when }));
      };
      box._fill = fill;
      fill();
      return box;
    }
    function statusMenu(n, at) {
      const opts = W.statusOptions(n), cur = W.status(n);
      WB.ui.menu(opts.map(o => ({ label: o, icon: '●', checked: o === cur, onClick: () => WB.api('entries.update', n.id, { fieldsPatch: { [W.statusKey(n)]: o === cur ? '' : o } }) })), at);
    }
    function titleInput(n, cls) {
      const inp = h('input.wbw-title', { class: cls || '', value: n.title, spellcheck: true, placeholder: 'Title', readOnly: !r.editable(), 'aria-label': 'Title' });
      const commit = WB.debounce(v => { if (v.trim() && v.trim() !== n.title) WB.api('entries.update', n.id, { title: v.trim() }).catch(WB.fail); }, 500);
      inp.addEventListener('input', () => commit(inp.value));
      inp.addEventListener('blur', () => commit.flush(inp.value));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) { e.preventDefault(); commit.flush(inp.value); const rec = eds.get(n.id) || [...eds.values()][0]; if (rec) rec.api.focus(); } });
      inp.dataset.id = n.id;
      return inp;
    }
    async function show(n, o = {}) {
      if (!n) return empty();
      box.hidden = false;
      const scriv = isScriv(n), ids = idsFor(n);
      if (shown && shown.id === n.id && shown.scriv === scriv && !o.force && sameIds(shown.ids, ids)) { paintHead(n); return; }
      await flushAll().catch(() => {});
      destroyEditors();
      shown = { id: n.id, scriv, ids };
      const my = shown;
      paintHead(n);
      paintTb();
      sheet.className = 'wbw-sheet' + (scriptStory(n) ? ' script' : r.pref('book') ? ' book' : '');
      GK.clear(sheet);
      sheet.appendChild(h('div.wbw-loading.gk-faint', { text: 'Opening…' }));
      const bodies = new Map((await WB.api('write.bodies', ids).catch(() => [])).map(b => [b.id, b.body]));
      if (shown !== my) return;
      GK.clear(sheet);
      if (!scriv) {
        const doc = h('article.wbw-doc', { class: 'k-' + n.kind, dataset: { id: n.id } }, [
          titleInput(n, 'k-' + n.kind),
          n.kind === 'scene' || n.kind === 'chapter' || n.kind === 'story' ? metaFor(n) : null,
          n.summary ? h('p.wbw-doc-sum', { text: n.summary, title: 'Synopsis (edit it in the story bible)' }) : null,
          makeEditor(n, bodies.get(n.id) || ''),
        ]);
        sheet.appendChild(doc);
        if (n.kind === 'scene') sheet.appendChild(docFoot(n));
        else if (r.model.children(n.id).length) sheet.appendChild(h('div.wbw-doc-foot', [ui.button({ label: 'Read every scene as one text', icon: '≡', small: true, kind: 'ghost', onClick: () => { r.setPref('scriv', true); show(n, { force: true }); } })]));
      } else {
        sheet.appendChild(scrivenings(n, bodies));
      }
      scroll.scrollTop = 0;
      paintTb();
      if (o.focus) focusEditor();
      if (findState.open) runFind();
      r.emit('shown', n.id);
    }
    const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    function docFoot(n) {
      const prev = r.model.neighbour(n.id, -1), next = r.model.neighbour(n.id, 1);
      return h('div.wbw-doc-foot', [
        prev ? ui.button({ label: '‹ ' + prev.title, small: true, kind: 'ghost', title: 'Previous scene (Alt+↑)', onClick: () => r.select(prev.id) }) : h('span'),
        r.editable() ? ui.button({ label: 'New scene after this', icon: '＋', small: true, kind: 'ghost', onClick: () => r.add('scene', { parentId: n.parentId, afterId: n.id, rename: false }).then(e => e && setTimeout(focusEditor, 150)) }) : null,
        next ? ui.button({ label: next.title + ' ›', small: true, kind: 'ghost', title: 'Next scene (Alt+↓)', onClick: () => r.select(next.id) }) : h('span'),
      ]);
    }
    function sceneSep(s) {
      const st = W.status(s);
      return h('div.wbw-sep', { dataset: { id: s.id } }, [
        h('span.wbw-sep-line'),
        h('button.wbw-sep-title', { type: 'button', title: 'Open this scene on its own page', onclick: () => r.select(s.id) }, [
          h('span.wbw-sdot', { class: st ? '' : 'none', style: { '--c': W.statusColor(s) || 'transparent' }, title: st || 'No status' }),
          h('span.wbw-sep-name', { text: s.title }),
          h('span.wbw-sep-words', { text: W.num(s.words) + ' w' }),
        ]),
        h('span.wbw-sep-line'),
      ]);
    }
    function scrivenings(n, bodies) {
      const wrap = h('div.wbw-scriv', { dataset: { id: n.id } });
      wrap.appendChild(titleInput(n, 'k-' + n.kind));
      wrap.appendChild(metaFor(n));
      if (n.summary) wrap.appendChild(h('p.wbw-doc-sum', { text: n.summary }));
      const own = bodies.get(n.id) || '';
      if (WB.text.text(own) && n.kind === 'chapter') wrap.appendChild(h('div.wbw-chap-own', [makeEditor(n, own)]));
      let chapters = 0;
      const sceneBlock = s => [sceneSep(s), h('div.wbw-scene', { dataset: { id: s.id } }, [makeEditor(s, bodies.get(s.id) || '')])];
      for (const c of r.model.children(n.id)) {
        if (c.kind === 'scene') { wrap.append(...sceneBlock(c)); continue; }
        chapters++;
        const label = (scriptStory(n) ? 'Act ' : 'Chapter ') + chapters;
        const ch = h('section.wbw-chap', { dataset: { id: c.id } }, [
          h('div.wbw-chap-head', [h('span.wbw-chap-label', { text: label }), titleInput(c, 'k-chapter in-scriv'), h('button.wbw-chap-open', { type: 'button', title: 'Open this chapter', text: '↗', onclick: () => r.select(c.id) })]),
        ]);
        const cb = bodies.get(c.id) || '';
        if (WB.text.text(cb)) ch.appendChild(h('div.wbw-chap-own', [makeEditor(c, cb)]));
        for (const s of r.model.descendants(c.id).filter(x => x.kind === 'scene')) ch.append(...sceneBlock(s));
        if (!r.model.descendants(c.id).length) ch.appendChild(h('p.gk-faint.gk-small.wbw-chap-empty', { text: 'No scenes yet.' }));
        wrap.appendChild(ch);
      }
      if (!eds.size || [...eds.keys()].every(id => id === n.id)) wrap.appendChild(h('p.gk-muted.wbw-chap-empty', { text: 'Nothing inside yet — add a scene to start writing.' }));
      if (r.editable()) {
        const target = n.kind === 'story' ? (r.model.children(n.id).filter(x => x.kind === 'chapter').pop() || n) : n;
        wrap.appendChild(h('div.wbw-doc-foot', [ui.button({ label: 'Add a scene' + (target !== n ? ' to “' + target.title + '”' : ''), icon: '＋', small: true, kind: 'ghost', onClick: () => r.add('scene', { parentId: target.id, rename: false }) })]));
      }
      return wrap;
    }
    function empty() {
      box.hidden = false;
      destroyEditors();
      shown = null;
      GK.clear(head); GK.clear(tb);
      head.hidden = true; tb.hidden = true; closeFind();
      GK.clear(sheet);
      sheet.className = 'wbw-sheet';
      sheet.appendChild(WB.ui.empty({ icon: '✎', title: r.editable() ? 'Start your first story' : 'No stories to show', text: 'Write novels, short stories, screenplays or game scripts right next to your world: characters and places are one @ away, and every scene keeps its point of view, setting, beats and status.',
        actions: r.editable() ? [ui.button({ label: 'Start a story', icon: '✎', kind: 'primary', onClick: () => r.newStory() })] : [] }));
    }
    function hide() { if (box.hidden) return; flushAll().catch(() => {}); destroyEditors(); shown = null; box.hidden = true; closeFind(); }

    /* ---------------- after data changes ---------------- */
    async function sync(p, structural) {
      if (box.hidden || !shown) return;
      const n = r.model.get(shown.id);
      if (!n) { const nx = r.node(); return nx ? show(nx, { force: true }) : empty(); }
      const want = idsFor(n);
      const typing = sheet.contains(document.activeElement);
      if (!sameIds(want, shown.ids)) { if (!typing) return show(n, { force: true }); dirty = true; }
      // titles, meta and separators in place
      paintHeadSoft(n);
      sheet.querySelectorAll('input.wbw-title').forEach(inp => { const x = r.model.get(inp.dataset.id); if (x && document.activeElement !== inp && inp.value !== x.title) inp.value = x.title; });
      sheet.querySelectorAll('.wbw-meta').forEach(m => { const at = m.closest('[data-id]'), x = at && r.model.get(at.dataset.id); if (x) m.replaceWith(metaFor(x)); });
      sheet.querySelectorAll('.wbw-sep').forEach(s => { const x = r.model.get(s.dataset.id); if (x) s.replaceWith(sceneSep(x)); });
      // bodies changed elsewhere (a restored version, a replace-all)
      const ids = ((p && p.ids) || []).filter(id => eds.has(id) && Date.now() - (eds.get(id).savedAt || 0) > 2500);
      if (ids.length) {
        const got = await WB.api('write.bodies', ids).catch(() => []);
        for (const b of got) { const rec = eds.get(b.id); if (!rec || rec.api.ed.contains(document.activeElement)) continue; if (b.body !== rec.lastSaved && b.body !== rec.api.get()) { rec.api.set(b.body); rec.lastSaved = b.body; if (scriptStory(n)) decorate(rec); } }
      }
    }
    function paintHeadSoft(n) {
      const c = head.querySelector('.wbw-crumbs');
      if (c) c.replaceWith(crumbs(n));
      const w = head.querySelector('.wbw-hwords b'); if (w) w.textContent = W.num(isScriv(n) ? n.total : n.words);
    }
    sheet.addEventListener('focusout', () => setTimeout(() => { if (dirty && !sheet.contains(document.activeElement)) { dirty = false; const n = r.node(); if (n) show(n, { force: true }); } }, 200));
    function patch(ids) {
      if (box.hidden || !shown) return;
      const n = r.model.get(shown.id);
      if (!n) return;
      if (ids.includes(n.id)) { const w = head.querySelector('.wbw-hwords b'); if (w) w.textContent = W.num(isScriv(n) ? n.total : n.words); }
      for (const id of ids) {
        const x = r.model.get(id); if (!x) continue;
        const sep = sheet.querySelector('.wbw-sep[data-id="' + id + '"] .wbw-sep-words'); if (sep) sep.textContent = W.num(x.words) + ' w';
        const meta = sheet.querySelector('[data-id="' + id + '"] > .wbw-meta .wbw-wordpill');
        if (meta) { meta.querySelector('.wbw-wp-n').textContent = W.num(x.kind === 'scene' ? x.words : x.total); const t = r.model.target(x); if (t) W.setBar(meta.querySelector('.wbw-bar'), (x.kind === 'scene' ? x.words : x.total) / t); }
      }
    }

    /* ---------------- toolbar ---------------- */
    const cur = () => eds.get(active) || [...eds.values()][0] || null;
    const keepSel = () => { const s = getSelection(); return s.rangeCount ? s.getRangeAt(0).cloneRange() : null; };
    const restore = (rec, range) => { rec.api.ed.focus(); if (range && rec.api.ed.contains(range.commonAncestorContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } };
    function exec(cmd, val) {
      const rec = cur(); if (!rec || !r.editable()) return;
      const s = getSelection();
      if (!s.rangeCount || !rec.api.ed.contains(s.anchorNode)) rec.api.focus(true);
      document.execCommand(cmd, false, val);
    }
    const blockOf = () => { const s = getSelection(); let n = s.rangeCount && s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; const b = n && n.closest && n.closest('p,h2,h3,h4,li,blockquote,pre,aside'); const rec = cur(); return b && rec && rec.api.ed.contains(b) ? b : null; };
    const toggleBlock = tag => { const b = blockOf(); exec('formatBlock', b && b.tagName.toLowerCase() === tag ? 'p' : tag); };
    async function mention() {
      const rec = cur(); if (!rec) return;
      const range = keepSel();
      const e = await WB.ui.pickEntry({ title: 'Link an entry', allowCreate: true });
      if (!e) return;
      restore(rec, range);
      rec.api.insertMention(e);
    }
    async function webLink() {
      const rec = cur(); if (!rec) return;
      const range = keepSel();
      const url = await ui.prompt('Link to a web address', 'https://', 'https://…');
      if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
      restore(rec, range);
      if (!range || range.collapsed) document.execCommand('insertHTML', false, '<a href="' + WB.esc(url) + '">' + WB.esc(url) + '</a>');
      else document.execCommand('createLink', false, url);
    }
    async function image() {
      const rec = cur(); if (!rec) return;
      const range = keepSel();
      const m = await WB.ui.pickMedia({ kind: 'image' });
      if (!m) return;
      restore(rec, range);
      rec.api.insert('<img data-media="' + m.id + '" alt="' + WB.esc(m.name) + '" src="' + WB.esc(m.url) + '">');
    }
    function secret() { const rec = cur(); if (!rec) return; if (!rec.api.ed.contains(getSelection().anchorNode)) rec.api.focus(true); if (rec.api.command) rec.api.command('secret'); else rec.api.ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); }
    function element(kind) {
      const rec = cur(); if (!rec || !window.WBScript) return;
      let b = blockOf();
      if (!b) { rec.api.focus(true); b = blockOf(); }
      if (!b) return;
      const text = b.textContent;
      const next = text.trim() ? WBScript.convert(text, kind) : ({ heading: 'INT. ', character: '@', paren: '()', transition: 'CUT TO:' })[kind] || '';
      const range = document.createRange(); range.selectNodeContents(b);
      const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      if (next) document.execCommand('insertText', false, next);
      else document.execCommand('delete');
      if (kind === 'paren' && !text.trim()) { const s2 = getSelection(); if (s2.rangeCount) { const rr = s2.getRangeAt(0); if (rr.startContainer.nodeType === 3 && rr.startOffset > 0) { rr.setStart(rr.startContainer, rr.startOffset - 1); rr.collapse(true); s2.removeAllRanges(); s2.addRange(rr); } } }
      decorate(rec);
    }
    async function split() {
      const rec = cur(), n = rec && r.model.get(rec.id);
      if (!rec || !n || n.kind !== 'scene' || !r.editable()) return ui.toast('Put the cursor inside a scene where it should be split', 'ℹ');
      const s = getSelection();
      if (!s.rangeCount || !rec.api.ed.contains(s.anchorNode)) return ui.toast('Put the cursor inside the scene where it should be split', 'ℹ');
      const caret = s.getRangeAt(0);
      const a = document.createRange(); a.selectNodeContents(rec.api.ed); a.setEnd(caret.startContainer, caret.startOffset);
      const b = document.createRange(); b.selectNodeContents(rec.api.ed); b.setStart(caret.endContainer, caret.endOffset);
      const ser = range => { const d = document.createElement('div'); d.appendChild(range.cloneContents()); d.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable')); return WB.text.sanitize(d.innerHTML); };
      const before = ser(a), after = ser(b);
      if (!WB.text.text(after).trim()) return ui.toast('Nothing after the cursor to move into a new scene', 'ℹ');
      await flushAll();
      rec.dead = true;
      try {
        const created = await WB.api('write.split', n.id, { before, after, title: n.title + ' (2)' });
        WB.ui.undoToast('Split “' + n.title + '” in two', async () => { await WB.api('entries.update', n.id, { body: before + after }); await WB.api('entries.trash', created.id); });
        await r.reload();
        r.select(created.id);
        setTimeout(() => r.views.binder.rename(created.id), 120);
      } catch (e) { rec.dead = false; WB.fail(e); }
    }
    function paintTb() {
      GK.clear(tb);
      if (!r.editable() || !eds.size) { tb.hidden = true; return; }
      tb.hidden = false;
      const B = (label, title, fn, cls) => { const b = h('button.wb-tb-btn', { type: 'button', title, class: cls || '', text: label, tabindex: -1 }); b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', fn); return b; };
      const sep = () => h('span.wb-tb-sep');
      const rec = cur(), n = rec && r.model.get(rec.id);
      const script = n && scriptStory(n);
      tb.append(
        B('¶', 'Paragraph', () => exec('formatBlock', 'p')), B('H1', 'Heading (# space)', () => toggleBlock('h2')), B('H2', 'Subheading (## space)', () => toggleBlock('h3')), sep(),
        B('B', 'Bold (Ctrl+B)', () => exec('bold'), 'b'), B('I', 'Italic (Ctrl+I)', () => exec('italic'), 'i'), B('U', 'Underline (Ctrl+U)', () => exec('underline'), 'u'), B('S', 'Strikethrough', () => exec('strikeThrough'), 's'), sep(),
        B('•', 'Bulleted list (- space)', () => exec('insertUnorderedList')), B('1.', 'Numbered list (1. space)', () => exec('insertOrderedList')), B('❝', 'Quote (> space)', () => toggleBlock('blockquote')), sep(),
        B('@', 'Link an entry from your world (or type @)', mention, 'mention'), B('⌁', 'Web link', webLink), B('▣', 'Image', image), B('⁂', 'Scene break (--- Enter)', () => exec('insertHorizontalRule')), sep(),
        B('◐', 'Secret: a note only you see; never compiled (Ctrl+Shift+S)', secret, 'secret'),
      );
      if (script) {
        tb.appendChild(sep());
        const els = h('div.wbw-elements', { title: 'Screenplay element of the current line' }, WBScript.ELEMENTS.map(([k, l, ex]) => B(l, l + ' — ' + ex, () => element(k), 'el el-' + k)));
        tb.appendChild(els);
      }
      GK.append(tb, [h('span.gk-grow'),
        n && n.kind === 'scene' ? B('✂', 'Split the scene at the cursor', split) : null,
        B('⌕', 'Find & replace (Ctrl+F)', () => openFind()),
        script ? null : (() => { const b = B('⇥', 'Book paragraphs: indented, no gaps', () => { r.setPref('book', !r.pref('book')); if (!sheet.classList.contains('script')) sheet.classList.toggle('book', !!r.pref('book')); b.classList.toggle('on', !!r.pref('book')); }); b.classList.toggle('on', !!r.pref('book')); return b; })(),
      ]);
    }

    /* ---------------- find & replace ---------------- */
    const findState = { open: false, ranges: [], idx: -1, story: null };
    const fIn = h('input.wbw-find-in', { placeholder: 'Find', spellcheck: false, 'aria-label': 'Find' });
    const rIn = h('input.wbw-find-in', { placeholder: 'Replace with', spellcheck: false, 'aria-label': 'Replace with' });
    const fCount = h('span.wbw-find-count.gk-small.gk-muted');
    const fStory = h('div.wbw-find-story');
    const optBtn = (label, title, key) => { const b = h('button.wbw-find-opt', { type: 'button', title, text: label, class: r.pref(key) ? 'on' : '', 'aria-pressed': String(!!r.pref(key)), onclick: () => { r.setPref(key, !r.pref(key)); b.classList.toggle('on', !!r.pref(key)); b.setAttribute('aria-pressed', String(!!r.pref(key))); runFind(); } }); return b; };
    let replaceRow = null;
    findEl.append(
      h('div.wbw-find-row', [
        h('span.wbw-find-ico', { text: '⌕' }), fIn, fCount,
        ui.button({ icon: '↑', small: true, kind: 'ghost', title: 'Previous (Shift+Enter)', onClick: () => step(-1) }),
        ui.button({ icon: '↓', small: true, kind: 'ghost', title: 'Next (Enter)', onClick: () => step(1) }),
        optBtn('Aa', 'Match case', 'findCase'), optBtn('“ab”', 'Whole words only', 'findWord'),
        ui.button({ label: 'Replace', icon: '⇄', small: true, kind: 'ghost', title: 'Show replace', onClick: () => { replaceRow.hidden = !replaceRow.hidden; if (!replaceRow.hidden) rIn.focus(); } }),
        ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: () => closeFind() }),
      ]),
      replaceRow = h('div.wbw-find-row', { hidden: true }, [
        h('span.wbw-find-ico', { text: '⇄' }), rIn,
        ui.button({ label: 'Replace', small: true, onClick: () => replaceOne() }),
        ui.button({ label: 'All on this page', small: true, onClick: () => replaceAll(false) }),
        ui.button({ label: 'All in the story', small: true, onClick: () => replaceAll(true) }),
      ]),
      fStory,
    );
    const reFor = q => {
      if (!q) return null;
      const body = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const src = r.pref('findWord') ? '(?<![\\p{L}\\p{N}_])' + body + '(?![\\p{L}\\p{N}_])' : body;
      return new RegExp(src, 'gu' + (r.pref('findCase') ? '' : 'i'));
    };
    function runFind() {
      const q = fIn.value, re = reFor(q);
      findState.ranges = [];
      if (re) for (const rec of eds.values()) {
        const tw = document.createTreeWalker(rec.api.ed, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = tw.nextNode())) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(t.data))) { if (!m[0].length) { re.lastIndex++; continue; } const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length); rg._rec = rec; findState.ranges.push(rg); }
        }
      }
      if (findState.idx >= findState.ranges.length) findState.idx = findState.ranges.length - 1;
      if (findState.idx < 0 && findState.ranges.length) findState.idx = 0;
      paintHits();
      storyHits();
    }
    function paintHits() {
      const has = typeof Highlight !== 'undefined' && CSS.highlights;
      if (has) {
        CSS.highlights.set('wbw-find', new Highlight(...findState.ranges));
        const c = findState.ranges[findState.idx];
        if (c) CSS.highlights.set('wbw-find-cur', new Highlight(c)); else CSS.highlights.delete('wbw-find-cur');
      }
      fCount.textContent = fIn.value ? (findState.ranges.length ? (findState.idx + 1) + ' of ' + findState.ranges.length : 'No matches here') : '';
    }
    const storyHits = WB.debounce(async () => {
      GK.clear(fStory);
      const st = r.story(), q = fIn.value;
      if (!st || !q) return;
      const hits = await WB.api('write.find', st.id, q, { caseSensitive: !!r.pref('findCase'), wholeWord: !!r.pref('findWord') }).catch(() => []);
      if (fIn.value !== q) return;
      GK.clear(fStory);
      const total = hits.reduce((a, x) => a + x.count, 0);
      if (!total) { fStory.appendChild(h('span.gk-small.gk-faint', { text: 'Nowhere else in “' + st.title + '”.' })); return; }
      const list = h('div.wbw-find-list', { hidden: true }, hits.map(x => h('button.wbw-find-hit', { type: 'button', onclick: () => { r.select(x.id, { mode: 'write' }); } }, [
        h('div.gk-row.nowrap', [h('b.gk-ellipsis.gk-grow', { text: x.title }), h('span.wb-badge', { text: String(x.count) })]),
        ...x.snippets.slice(0, 2).map(s => h('div.gk-small.gk-muted.wbw-find-snip', [s.before, h('mark', { text: s.match }), s.after])),
      ])));
      fStory.append(h('button.wbw-find-sum', { type: 'button', onclick: () => { list.hidden = !list.hidden; } }, [h('span', { text: 'Whole story: ' + total + ' in ' + hits.length + (hits.length === 1 ? ' place' : ' places') }), h('span.gk-faint', { text: ' ▾' })]), list);
    }, 250);
    function step(d) {
      if (!findState.ranges.length) return;
      findState.idx = (findState.idx + d + findState.ranges.length) % findState.ranges.length;
      paintHits();
      const rg = findState.ranges[findState.idx];
      const rc = rg.getBoundingClientRect(), sc = scroll.getBoundingClientRect();
      if (rc.top < sc.top + 40 || rc.bottom > sc.bottom - 40) scroll.scrollTop += GK.local(scroll, rc.top - sc.top - sc.height * .4);
    }
    async function replaceOne() {
      const rg = findState.ranges[findState.idx];
      if (!rg || !r.editable()) return;
      const rec = rg._rec;
      rec.api.ed.focus();
      const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
      document.execCommand('insertText', false, rIn.value);
      fIn.focus();
      runFind();
      step(0);
    }
    async function replaceAll(story) {
      const q = fIn.value;
      if (!q || !r.editable() || !shown) return;
      await flushAll();
      const root = story ? (r.story() || r.node()) : r.model.get(shown.id);
      if (!root) return;
      try {
        const res = await WB.api('write.replace', root.id, q, rIn.value, { caseSensitive: !!r.pref('findCase'), wholeWord: !!r.pref('findWord'), ids: story ? undefined : shown.ids });
        if (!res.n) return ui.toast('Nothing to replace', 'ℹ');
        await reloadBodies(res.changed.map(c => c.id));
        WB.ui.undoToast('Replaced ' + res.n + ' × “' + q + '”' + (res.changed.length > 1 ? ' in ' + res.changed.length + ' places' : ''), async () => { await WB.api('write.restoreBodies', res.changed); await reloadBodies(res.changed.map(c => c.id)); });
        runFind();
      } catch (e) { WB.fail(e); }
    }
    async function reloadBodies(ids) {
      const got = await WB.api('write.bodies', ids.filter(id => eds.has(id))).catch(() => []);
      for (const b of got) { const rec = eds.get(b.id); if (rec) { rec.api.set(b.body); rec.lastSaved = b.body; rec.savedAt = Date.now(); r.liveWords(b.id, rec.api.words()); } }
    }
    function openFind() {
      if (box.hidden) return;
      findEl.hidden = false; findState.open = true;
      const s = getSelection(), t = s && s.rangeCount && !s.isCollapsed ? s.toString().trim() : '';
      if (t && t.length < 80 && !/\n/.test(t)) fIn.value = t;
      fIn.focus(); fIn.select();
      runFind();
    }
    function closeFind() {
      findEl.hidden = true; findState.open = false; findState.ranges = [];
      if (typeof Highlight !== 'undefined' && CSS.highlights) { CSS.highlights.delete('wbw-find'); CSS.highlights.delete('wbw-find-cur'); }
    }
    const findSoon = WB.debounce(runFind, 140);
    fIn.addEventListener('input', () => { findState.idx = 0; findSoon(); });
    fIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); const rec = cur(); if (rec) rec.api.focus(); } });
    rIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); } });

    function focusEditor() {
      const rec = eds.get(r.sel) || cur();
      if (!rec) return;
      rec.api.focus(eds.size === 1);
    }

    return {
      show, hide, empty, sync, patch, focusEditor, find: openFind, el: box, scroller: () => scroll, sheet: () => sheet, editors: () => eds, flush: flushAll, active: () => active,
      destroy() { closeFind(); destroyEditors(); },
    };
  };
})();
