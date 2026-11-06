/* Rich text editor: toolbar, Markdown shortcuts, @ / [[ mentions with inline creation, secrets, callouts, images,
   safe paste, entries dropped in as mentions, files dropped in as images. Stores the sanitized HTML subset. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  const BLOCKS = 'p,div,h2,h3,h4,li,blockquote,pre,aside';

  function prepare(html, share) {
    const tpl = document.createElement('template');
    tpl.innerHTML = WB.text.sanitize(share ? WB.text.stripSecrets(html || '') : html || '');
    tpl.content.querySelectorAll('a.wb-m').forEach(a => {
      const t = WB.liteOf(a.dataset.id);
      if (t) { a.textContent = a.textContent.trim() && a.textContent !== t.title && !t.aliases.includes(a.textContent) ? a.textContent : t.title; if (share && !WB.visible(t)) a.replaceWith(document.createTextNode(a.textContent)); }
      else a.classList.add('gone');
      a.setAttribute('contenteditable', 'false');
    });
    tpl.content.querySelectorAll('img[data-media]').forEach(img => { const id = img.dataset.media; WB.mediaUrl(id).then(u => { if (u) img.src = u; else img.classList.add('missing'); }); });
    return tpl.content;
  }

  function create(o = {}) {
    const readOnly = !!o.readOnly || WB.share;
    const ed = h('div.wb-editor', { class: o.cls || '', contenteditable: readOnly ? 'false' : 'true', spellcheck: GK.settings.get('wbSpell') !== false, role: 'textbox', 'aria-multiline': 'true', dataset: { placeholder: o.placeholder || 'Write…' } });
    const wrap = h('div.wb-editor-wrap', { class: readOnly ? 'readonly' : '' });
    let last = null, words = 0;
    const set = html => { GK.clear(ed); ed.appendChild(prepare(html, WB.share)); last = get(); empty(); count(); };
    function get() {
      const c = ed.cloneNode(true);
      c.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable'));
      c.querySelectorAll('a.wb-m.gone').forEach(x => x.classList.remove('gone'));
      c.querySelectorAll('img[data-media]').forEach(x => x.removeAttribute('src'));
      return WB.text.sanitize(c.innerHTML);
    }
    const empty = () => ed.classList.toggle('is-empty', !ed.textContent.trim() && !ed.querySelector('img,hr,li'));
    const count = () => { words = WB.text.words(ed.innerText || ''); o.onWords && o.onWords(words); };
    const fire = WB.debounce(() => { const v = get(); if (v !== last) { last = v; o.onChange && o.onChange(v); } }, o.delay || 450);
    const changed = () => { empty(); count(); fire(); };

    /* ---- commands ---- */
    const exec = (cmd, val) => { ed.focus(); document.execCommand(cmd, false, val); changed(); };
    const block = () => { const s = getSelection(); if (!s.rangeCount) return null; let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; const b = n && n.closest && n.closest(BLOCKS); return b && ed.contains(b) ? b : null; };
    function toggleBlock(tag) { const b = block(); exec('formatBlock', b && b.tagName.toLowerCase() === tag ? 'p' : tag); }
    function wrapSelection(make, test) {
      const s = getSelection(); if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      let n = r.commonAncestorContainer; if (n.nodeType === 3) n = n.parentNode;
      const inside = n.closest && n.closest(test);
      if (inside && ed.contains(inside)) { const p = inside.parentNode; while (inside.firstChild) p.insertBefore(inside.firstChild, inside); p.removeChild(inside); changed(); return; }
      if (r.collapsed) {
        const b = block();
        if (b && b.tagName === 'P' && test === '.wb-s') { b.classList.toggle('wb-s'); changed(); }
        return;
      }
      const w = make(); w.appendChild(r.extractContents()); r.insertNode(w);
      s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(w); s.addRange(nr);
      changed();
    }
    const secret = () => wrapSelection(() => h('span.wb-s'), '.wb-s');
    const callout = () => { const b = block(); if (!b) return exec('insertHTML', '<aside class="wb-note"><br></aside>'); if (b.tagName === 'ASIDE') return exec('formatBlock', 'p'); const a = h('aside.wb-note'); while (b.firstChild) a.appendChild(b.firstChild); b.replaceWith(a); changed(); };
    async function link() {
      const s = getSelection(); const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const url = await ui.prompt('Link to a web address', 'https://', 'https://…');
      if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
      if (r) { s.removeAllRanges(); s.addRange(r); }
      if (r && r.collapsed) exec('insertHTML', '<a href="' + WB.esc(url) + '">' + WB.esc(url) + '</a>'); else exec('createLink', url);
    }
    async function image() {
      const s = getSelection(); const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const m = await WB.ui.pickMedia({ kind: 'image' });
      if (!m) return;
      ed.focus(); if (r) { s.removeAllRanges(); s.addRange(r); }
      exec('insertHTML', '<img data-media="' + m.id + '" alt="' + WB.esc(m.name) + '" src="' + WB.esc(m.url) + '">');
    }
    function table() {
      const head = '<tr><th>Name</th><th>Detail</th><th>Notes</th></tr>', row = '<tr><td><br></td><td><br></td><td><br></td></tr>';
      exec('insertHTML', '<table><thead>' + head + '</thead><tbody>' + row + row + '</tbody></table><p><br></p>');
    }
    function tableMenu(e, td) {
      const tr = td.closest('tr'), tbl = td.closest('table'), idx = [...tr.children].indexOf(td);
      const blank = tag => { const c = document.createElement(tag); c.appendChild(document.createElement('br')); return c; };
      const body = tbl.tBodies[0] || tbl;
      WB.ui.menu([
        { label: 'Add a row below', icon: '↓', onClick: () => { const r = document.createElement('tr'); [...(body.rows[0] || tr).children].forEach(() => r.appendChild(blank('td'))); if (tr.parentNode.tagName === 'THEAD') body.insertBefore(r, body.firstChild); else tr.after(r); changed(); } },
        { label: 'Add a row above', icon: '↑', disabled: tr.parentNode.tagName === 'THEAD', onClick: () => { const r = document.createElement('tr'); [...tr.children].forEach(() => r.appendChild(blank('td'))); tr.before(r); changed(); } },
        { label: 'Add a column right', icon: '→', onClick: () => { for (const r of tbl.rows) { const c = r.children[idx]; const n = blank(r.parentNode.tagName === 'THEAD' ? 'th' : 'td'); if (c) c.after(n); else r.appendChild(n); } changed(); } },
        { label: 'Add a column left', icon: '←', onClick: () => { for (const r of tbl.rows) { const c = r.children[idx]; const n = blank(r.parentNode.tagName === 'THEAD' ? 'th' : 'td'); if (c) c.before(n); else r.prepend(n); } changed(); } },
        '-',
        { label: 'Delete this row', icon: '✕', disabled: tbl.rows.length < 2, onClick: () => { tr.remove(); changed(); } },
        { label: 'Delete this column', icon: '✕', disabled: tr.children.length < 2, onClick: () => { for (const r of [...tbl.rows]) if (r.children[idx]) r.children[idx].remove(); changed(); } },
        { label: 'Delete the table', icon: '🗑', danger: true, onClick: () => { tbl.remove(); changed(); } },
      ], e);
    }
    async function mentionPick() {
      const s = getSelection(); const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const e = await WB.ui.pickEntry({ title: 'Link an entry', allowCreate: true });
      if (!e) return;
      ed.focus(); if (r) { s.removeAllRanges(); s.addRange(r); }
      insertMention(e);
    }
    function insertMention(e, range) {
      const a = h('a.wb-m', { dataset: { id: e.id }, contenteditable: 'false', text: e.title });
      const s = getSelection();
      const r = range || (s.rangeCount ? s.getRangeAt(0) : null);
      if (!r || !ed.contains(r.commonAncestorContainer)) { ed.appendChild(h('p', [a, ' '])); changed(); return; }
      r.deleteContents();
      const sp = document.createTextNode(' ');
      r.insertNode(sp); r.insertNode(a);
      const nr = document.createRange(); nr.setStartAfter(sp); nr.collapse(true); s.removeAllRanges(); s.addRange(nr);
      changed();
    }

    /* ---- toolbar ---- */
    const B = (label, title, fn, cls) => { const b = h('button.wb-tb-btn', { type: 'button', title, class: cls || '', text: label, tabindex: -1 }); b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', fn); return b; };
    if (o.toolbar !== false && !readOnly) {
      const sep = () => h('span.wb-tb-sep');
      wrap.appendChild(h('div.wb-tb', { role: 'toolbar', 'aria-label': 'Formatting' }, [
        B('¶', 'Paragraph', () => exec('formatBlock', 'p')), B('H1', 'Heading (# space)', () => toggleBlock('h2')), B('H2', 'Subheading (## space)', () => toggleBlock('h3')), sep(),
        B('B', 'Bold (Ctrl+B)', () => exec('bold'), 'b'), B('I', 'Italic (Ctrl+I)', () => exec('italic'), 'i'), B('U', 'Underline (Ctrl+U)', () => exec('underline'), 'u'), B('S', 'Strikethrough', () => exec('strikeThrough'), 's'), sep(),
        B('•', 'Bulleted list (- space)', () => exec('insertUnorderedList')), B('1.', 'Numbered list (1. space)', () => exec('insertOrderedList')), B('❝', 'Quote (> space)', () => toggleBlock('blockquote')), B('ⓘ', 'Callout', callout), sep(),
        B('@', 'Link an entry (type @ or [[)', mentionPick, 'mention'), B('⌁', 'Web link', link), B('▣', 'Image', image), B('⊞', 'Table (right-click a cell to add rows and columns)', table), B('—', 'Divider', () => exec('insertHorizontalRule')), sep(),
        B('◐', 'Secret: only you see it (Ctrl+Shift+S)', secret, 'secret'), B('⌫', 'Clear formatting', () => exec('removeFormat')),
      ]));
    }
    wrap.appendChild(ed);
    if (readOnly) ed.removeAttribute('contenteditable');

    /* ---- mention autocomplete ---- */
    let pop = null, matches = [], sel = 0, trig = null;
    const closePop = () => { if (pop) { pop.close(); pop = null; } trig = null; };
    function trigger() {
      const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return null;
      const n = s.anchorNode; if (!n || n.nodeType !== 3 || !ed.contains(n)) return null;
      const before = n.data.slice(0, s.anchorOffset);
      const m = /(?:^|[\s( ])@([^\s@]{0,40}(?: [^\s@]{0,20}){0,2})$/u.exec(before) || /\[\[([^\]]{0,50})$/.exec(before);
      if (!m) return null;
      const start = s.anchorOffset - m[0].length + (m[0].startsWith('[[') || m[0].startsWith('@') ? 0 : 1);
      return { node: n, start, end: s.anchorOffset, q: m[1].trim() };
    }
    function search(q) {
      const low = q.toLowerCase(), out = [];
      for (const t of WB.titles) {
        if (WB.share && !WB.visible(t)) continue;
        const names = [t.title].concat(t.aliases || []).map(x => x.toLowerCase());
        const score = !q ? 3 : names.some(x => x === low) ? 0 : names.some(x => x.startsWith(low)) ? 1 : names.some(x => x.includes(low)) ? 2 : -1;
        if (score >= 0) out.push([score, t]);
      }
      return out.sort((a, b) => a[0] - b[0] || a[1].title.localeCompare(b[1].title)).slice(0, 8).map(x => x[1]);
    }
    function showPop() {
      trig = trigger();
      if (!trig) return closePop();
      matches = search(trig.q); sel = 0;
      const r = document.createRange(); r.setStart(trig.node, trig.start); r.setEnd(trig.node, trig.end);
      const rect = r.getBoundingClientRect();
      const list = h('div.wb-menu.wb-mention-list');
      matches.forEach((t, i) => list.appendChild(h('button.wb-menu-item', { type: 'button', class: i === sel ? 'sel' : '', onmousedown: e => e.preventDefault(), onclick: () => choose(i) }, [
        h('span.wb-menu-ico', { text: (WB.types.get(t.typeId) || {}).icon || '◇', style: { color: (WB.types.get(t.typeId) || {}).color } }), h('span.wb-menu-lbl.gk-ellipsis', { text: t.title }), h('span.wb-menu-kbd', { text: (WB.types.get(t.typeId) || {}).name || '' }),
      ])));
      if (trig.q) {
        list.appendChild(h('div.wb-menu-sep'));
        const common = ['character', 'place', 'faction', 'item', 'event', 'lore', 'species', 'culture'].map(k => WB.type(k)).filter(Boolean);
        list.appendChild(h('div.wb-menu-head', { text: 'Create “' + trig.q + '” as' }));
        list.appendChild(h('div.wb-chips.wb-mention-create', common.map(t => h('button.wb-tagchip.btn', { type: 'button', style: { '--c': t.color }, onmousedown: e => e.preventDefault(), onclick: () => createAs(t) }, [t.icon + ' ' + t.name]))));
      }
      if (pop) pop.close();
      pop = WB.ui.popover(rect, list, { group: 'mention', cls: 'wb-mention-pop', keepOpen: true });
    }
    function hl() { if (!pop) return; pop.el.querySelectorAll('.wb-mention-list > .wb-menu-item').forEach((b, i) => b.classList.toggle('sel', i === sel)); }
    function rangeOfTrigger() { const r = document.createRange(); r.setStart(trig.node, trig.start); r.setEnd(trig.node, Math.min(trig.end, trig.node.data.length)); return r; }
    function choose(i) { const t = matches[i]; if (!t || !trig) return; const r = rangeOfTrigger(); closePop(); insertMention(t, r); }
    async function createAs(t) {
      if (!trig) return;
      const q = trig.q, r = rangeOfTrigger(); closePop();
      try {
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: q, inbox: false });
        WB.titles.push({ id: e.id, title: e.title, aliases: [], typeId: e.typeId, audience: e.audience });
        ed.focus(); insertMention(e, r);
        WB.ui.undoToast('Created ' + t.name.toLowerCase() + ' “' + e.title + '”', () => WB.api('entries.purge', e.id));
      } catch (err) { WB.fail(err); }
    }

    /* ---- slash commands: "/" at the start of a line ---- */
    const SLASH = [
      ['Heading', 'h1 title', () => exec('formatBlock', 'h2')], ['Subheading', 'h2', () => exec('formatBlock', 'h3')], ['Small heading', 'h3', () => exec('formatBlock', 'h4')],
      ['Bulleted list', 'ul bullet', () => exec('insertUnorderedList')], ['Numbered list', 'ol number', () => exec('insertOrderedList')],
      ['Quote', 'blockquote', () => exec('formatBlock', 'blockquote')], ['Callout', 'note aside info', () => callout()], ['Secret paragraph', 'hidden gm', () => { const b = block(); if (b && b.tagName === 'P') { b.classList.add('wb-s'); changed(); } }],
      ['Table', 'grid', () => table()], ['Divider', 'hr line rule', () => exec('insertHorizontalRule')], ['Image', 'picture media', () => image()],
      ['Link an entry', 'mention @', () => mentionPick()], ['Web link', 'url', () => link()], ['Roll dice', 'random d20', async () => { const x = await ui.prompt('Roll dice', '1d20', 'e.g. 2d6+3'); if (!x) return; const r = WB.roll(x); if (r) exec('insertText', r.total + ' (' + x + ')'); }],
    ];
    let slash = null;
    function slashCheck() {
      const s = getSelection(), b = block() || (s.anchorNode && s.anchorNode.parentNode === ed ? ed : null);
      if (!b || !s.isCollapsed || b.tagName === 'PRE') return closeSlash();
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      const m = /^\/([\w ]{0,20})$/.exec(r.toString());
      if (!m) return closeSlash();
      const q = m[1].toLowerCase().trim();
      const items = SLASH.filter(([l, w]) => !q || (l + ' ' + w).toLowerCase().includes(q));
      if (!items.length) return closeSlash();
      const rect = r.getBoundingClientRect();
      slash = { items, sel: 0, len: m[0].length, block: b };
      const list = h('div.wb-menu', items.map(([l], i) => h('button.wb-menu-item', { type: 'button', class: i ? '' : 'sel', onmousedown: ev => ev.preventDefault(), onclick: () => runSlash(i) }, [h('span.wb-menu-lbl', { text: l })])));
      if (slash.pop) slash.pop.close();
      slash.pop = WB.ui.popover(rect, [h('div.wb-menu-head', { text: 'Insert' }), list], { group: 'slash', keepOpen: true });
    }
    function closeSlash() { if (slash && slash.pop) slash.pop.close(); slash = null; }
    function runSlash(i) {
      const it = slash && slash.items[i]; if (!it) return;
      const b = slash.block, s = getSelection();
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset); r.deleteContents();
      if (!b.textContent && !b.querySelector('br,img')) b.appendChild(document.createElement('br'));
      const rr = document.createRange(); rr.setStart(b, 0); rr.collapse(true); s.removeAllRanges(); s.addRange(rr);
      closeSlash();
      it[2]();
    }

    /* ---- input handling ---- */
    ed.addEventListener('input', () => { changed(); showPop(); slashCheck(); });
    ed.addEventListener('keydown', e => {
      if (!slash) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); slash.sel = (slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length; slash.pop.el.querySelectorAll('.wb-menu-item').forEach((x, i) => x.classList.toggle('sel', i === slash.sel)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); runSlash(slash.sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeSlash(); }
    }, true);
    ed.addEventListener('blur', () => { setTimeout(() => { closePop(); closeSlash(); }, 150); fire.flush(); o.onBlur && o.onBlur(); });
    ed.addEventListener('focus', () => {
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { }
      // an empty editor starts with a real paragraph, so Enter and the block tools behave from the first keystroke
      if (!readOnly && !ed.firstElementChild && !ed.textContent.trim()) {
        ed.innerHTML = '<p><br></p>';
        const r = document.createRange(); r.setStart(ed.firstChild, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      o.onFocus && o.onFocus();
    });
    ed.addEventListener('keydown', e => {
      if (pop && matches.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % matches.length; hl(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + matches.length) % matches.length; hl(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(sel); return; }
      }
      if (pop && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); secret(); return; }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); link(); return; }
      if (e.key === ' ') {
        // Markdown-style shortcuts at the start of a line
        const b = block(), s = getSelection();
        if (!b || !s.isCollapsed) return;
        const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
        const before = r.toString();
        const map = { '#': ['formatBlock', 'h2'], '##': ['formatBlock', 'h3'], '###': ['formatBlock', 'h4'], '-': ['insertUnorderedList'], '*': ['insertUnorderedList'], '1.': ['insertOrderedList'], '>': ['formatBlock', 'blockquote'], '!': ['callout'] };
        const m = map[before];
        if (m && b.tagName !== 'LI') { e.preventDefault(); r.deleteContents(); if (m[0] === 'callout') callout(); else exec(m[0], m[1]); }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const b = block();
        if (b && b.textContent === '---') { e.preventDefault(); b.textContent = ''; exec('insertHorizontalRule'); }
      }
    });
    ed.addEventListener('paste', e => {
      if (readOnly) return;
      e.preventDefault();
      const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
      if (html) { const frag = prepare(html); const d = h('div'); d.appendChild(frag); exec('insertHTML', d.innerHTML); }
      else if (/\n/.test(text)) exec('insertHTML', WB.text.fromText(text));
      else exec('insertText', text);
    });
    ed.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a || !ed.contains(a)) return;
      e.preventDefault();
      if (a.classList.contains('wb-m')) { if (a.classList.contains('gone')) return ui.toast('That entry was deleted. Restore it from the trash or remove the link.', 'ℹ'); if (o.onMention) o.onMention(a.dataset.id, e); else if (e.ctrlKey || e.metaKey) WB.peek(a.dataset.id); else WB.open(a.dataset.id); }
      else if (a.href && (e.ctrlKey || readOnly)) GK.host('shell:url', a.getAttribute('href'));
    });
    ed.addEventListener('pointerover', e => {
      const a = e.target.closest && e.target.closest('a.wb-m:not(.gone)');
      if (a && !a._hov) { a._hov = true; let t = setTimeout(() => { if (a.matches(':hover') && GK.settings.get('wbHoverCards')) WB.ui.hoverCard(a.dataset.id, a); }, 500); a.addEventListener('pointerleave', () => { clearTimeout(t); a._hov = false; }, { once: true }); }
    });
    ed.addEventListener('contextmenu', e => { const cell = !readOnly && e.target.closest('td, th'); if (cell && ed.contains(cell) && !e.target.closest('a.wb-m')) { e.preventDefault(); tableMenu(e, cell); return; } const a = e.target.closest('a.wb-m:not(.gone)'); if (a) { e.preventDefault(); const t = WB.liteOf(a.dataset.id); if (t) WB.ui.entryMenu(t, e, [{ label: 'Remove link (keep text)', icon: '⌫', onClick: () => { a.replaceWith(document.createTextNode(a.textContent)); changed(); } }]); } });
    // entries dragged in become mentions, files become images
    ed.addEventListener('dragover', e => { if (WB.dnd.has(e) || [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    ed.addEventListener('drop', async e => {
      const id = WB.dnd.id(e);
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (id) { e.preventDefault(); const t = WB.liteOf(id); if (t) { ed.focus(); if (r) { getSelection().removeAllRanges(); getSelection().addRange(r); } insertMention(t); } return; }
      const imgs = [...e.dataTransfer.files].filter(f => /^image\//.test(f.type));
      if (imgs.length && !readOnly) {
        e.preventDefault();
        const saved = await WB.saveFiles(imgs);
        ed.focus(); if (r) { getSelection().removeAllRanges(); getSelection().addRange(r); }
        for (const m of saved) exec('insertHTML', '<img data-media="' + m.id + '" alt="' + WB.esc(m.name) + '" src="' + WB.esc(m.url) + '">');
      }
    });

    set(o.value || '');
    if (o.autofocus) setTimeout(() => api.focus(true), 40);
    const api = {
      el: wrap, ed, get, set, words: () => words, flush: () => fire.flush(),
      focus(end) { ed.focus(); if (end) { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } },
      insertMention: e => { ed.focus(); insertMention(e); },
      insert: html => exec('insertHTML', html),
      /** runs a toolbar action on the current selection: secret, callout, link, image, bold, italic, h2, h3, quote, list, numbered, clear */
      command(name) {
        if (readOnly) return false;
        ed.focus();
        const run = { secret, callout, link, image, bold: () => exec('bold'), italic: () => exec('italic'), h2: () => exec('formatBlock', 'h2'), h3: () => exec('formatBlock', 'h3'),
          quote: () => exec('formatBlock', 'blockquote'), list: () => exec('insertUnorderedList'), numbered: () => exec('insertOrderedList'), clear: () => exec('removeFormat') }[name];
        if (!run) return false;
        run();
        return true;
      },
      destroy() { fire.flush(); closePop(); },
    };
    return api;
  }

  WB.editor = { create, prepare };
})(window);
