/* Write · story bible: everything about the selected scene, chapter or story beside the text — synopsis, status,
   target, point of view, place, cast, dates, beats (goal / conflict / outcome / plot threads), the world entries the
   text mentions (with "add to cast" suggestions), pinned references for the whole story, private notes that are
   never compiled, and versions (snapshots) with restore. Chips peek on click so the manuscript stays open. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;
  const peekChip = (id, extra) => WB.ui.chip(id, Object.assign({ size: 'sm', onClick: x => WB.peek(x.id) }, extra || {}));

  W.bible = function (r, host) {
    let cur = null, dirty = false, sig = '', seq = 0;
    const closed = () => new Set(r.pref('closed') || []);
    const section = (key, title, body, o = {}) => {
      const isClosed = closed().has(key);
      const sec = h('section.wbw-sec', { class: isClosed ? 'closed' : '', dataset: { key } });
      const btn = h('button.wbw-sec-head', { type: 'button', 'aria-expanded': String(!isClosed), onclick: () => {
        const s = closed(); const on = !s.has(key); if (on) s.add(key); else s.delete(key); r.setPref('closed', [...s]);
        sec.classList.toggle('closed', on); btn.setAttribute('aria-expanded', String(!on));
      } }, [h('span.wbw-sec-caret', { text: '▾' }), h('span.wbw-sec-title', { text: title }), o.count != null ? h('span.wbw-sec-count', { text: String(o.count) }) : null, h('span.gk-grow'), o.action || null]);
      sec.append(btn, h('div.wbw-sec-body', [].concat(body).filter(Boolean)));
      return sec;
    };
    const signature = n => n ? JSON.stringify([n.id, n.title, n.summary, n.fields, n.start, n.end, n.write, n.typeId, WB.share]) : '';

    function show(n) {
      cur = n ? n.id : null;
      sig = signature(n);
      dirty = false;
      const my = ++seq;
      GK.clear(host);
      if (!n) { host.appendChild(h('div.wbw-bible-empty', [WB.ui.empty({ icon: '❖', title: 'Story bible', text: 'Pick a scene to see its point of view, setting, cast, beats and everything it mentions.' })])); return; }
      const t = WB.typeOf(n), lite = r.model.lite(n);
      const edit = r.editable();
      host.appendChild(h('div.wbw-bible-head', [
        h('span.wbw-bible-ico', { text: n.kind === 'story' ? W.storyIcon(n) : WB.iconOf(lite), style: { '--c': WB.colorOf(lite) } }),
        h('div.gk-grow', [h('div.wbw-bible-title.gk-ellipsis', { text: n.title }), h('div.gk-small.gk-muted', { text: [t && t.name, n.kind === 'scene' ? W.num(n.words) + ' words' : W.num(n.total) + ' words in all', W.readTime(n.kind === 'scene' ? n.words : n.total)].filter(Boolean).join(' · ') })]),
        ui.button({ icon: '◫', small: true, kind: 'ghost', title: 'Peek at the entry', onClick: () => WB.peek(n.id) }),
        ui.button({ icon: '↗', small: true, kind: 'ghost', title: 'Open in the Codex (tags, relations, backlinks…)', onClick: () => WB.open(n.id) }),
      ]));
      const scrollBox = h('div.wbw-bible-scroll');
      host.appendChild(scrollBox);

      /* synopsis */
      const sum = ui.input({ multiline: true, rows: 2, value: n.summary || '', placeholder: n.kind === 'scene' ? 'What happens, in a line or two (shown on the index card)' : n.kind === 'chapter' ? 'What this chapter does' : 'The story in a few lines' });
      sum.classList.add('wbw-autosize');
      sum.readOnly = !edit;
      const saveSum = WB.debounce(v => WB.api('entries.update', n.id, { summary: v }).catch(WB.fail), 600);
      sum.addEventListener('input', () => { fit(sum); saveSum(sum.value); });
      sum.addEventListener('blur', () => saveSum.flush(sum.value));
      requestAnimationFrame(() => fit(sum));
      scrollBox.appendChild(section('synopsis', 'Synopsis', [sum]));

      /* fields: details and beats */
      const defs = ((t && t.fields) || []).filter(d => WB.fieldVisible(d));
      const statusKey = W.statusKey(n);
      const statusDef = defs.find(d => d.key === statusKey && d.kind === 'choice');
      const save = WB.debounce((key, v) => WB.api('entries.update', n.id, { fieldsPatch: { [key]: v } }).catch(WB.fail), 450);
      const fieldRow = d => {
        if (d === statusDef) return statusRow(n, d, edit);
        const ctl = WB.ui.field(d, n.fields[d.key], v => { n.fields[d.key] = v; save(d.key, v); });
        // reference chips here peek instead of leaving the manuscript (one listener survives the editor's repaints)
        ctl.addEventListener('click', e => { const c = e.target.closest && e.target.closest('.wb-chip'); if (!c || e.target.closest('.wb-chip-x')) return; e.stopPropagation(); e.preventDefault(); const id = idOfChip(c, n.fields[d.key]); if (id) WB.peek(id); }, true);
        return ui.field({ label: d.label, hint: d.hint, control: ctl });
      };
      const main = defs.filter(d => (d.group || '') !== 'Beat');
      const beats = defs.filter(d => d.group === 'Beat');
      const details = main.map(fieldRow);
      if (t && t.dated) details.push(WB.ui.dateRange({ start: n.start, end: n.end, labels: t.dated, onChange: ({ start, end }) => WB.api('entries.update', n.id, { start, end }).catch(WB.fail) }));
      if (n.kind === 'story' && edit) details.push(ui.field({ label: 'Format', hint: 'Script stories get screenplay styling (scene headings, characters, dialogue) and compile to a screenplay.', control: ui.segmented({ value: n.write.format === 'script' ? 'script' : 'prose', options: [['prose', 'Prose'], ['script', 'Script']], onChange: v => WB.api('write.saveData', n.id, { format: v === 'script' ? 'script' : null }).then(() => r.views.pages.show(r.node(), { force: true })).catch(WB.fail) }) }));
      if (details.length) scrollBox.appendChild(section('details', n.kind === 'scene' ? 'Scene' : n.kind === 'chapter' ? 'Chapter' : 'Story', h('div.wbw-fields', details)));
      if (beats.length) scrollBox.appendChild(section('beats', 'Beats', h('div.wbw-fields', beats.map(fieldRow))));

      /* the world in this text */
      const inText = h('div.wbw-intext', [h('span.gk-small.gk-faint', { text: 'Looking…' })]);
      scrollBox.appendChild(section('intext', n.kind === 'scene' ? 'In this scene' : n.kind === 'chapter' ? 'In this chapter' : 'In this story', inText));
      fillMentions(n, inText, my);

      /* pinned for the story */
      const st = r.model.story(n.id);
      if (st) scrollBox.appendChild(pinned(st, edit));

      /* notes */
      const notes = ui.input({ multiline: true, rows: 3, value: n.write.notes || '', placeholder: 'Ideas, research, things to fix… only for you; never compiled.' });
      notes.classList.add('wbw-autosize');
      notes.readOnly = !edit;
      const saveNotes = WB.debounce(v => WB.api('write.saveData', n.id, { notes: v || null }).catch(WB.fail), 700);
      notes.addEventListener('input', () => { fit(notes); saveNotes(notes.value); });
      notes.addEventListener('blur', () => saveNotes.flush(notes.value));
      requestAnimationFrame(() => fit(notes));
      if (!WB.share) scrollBox.appendChild(section('notes', 'Notes', [notes]));

      /* versions */
      if (!WB.share) {
        const vers = h('div.wbw-versions', [h('span.gk-small.gk-faint', { text: 'Looking…' })]);
        scrollBox.appendChild(section('versions', 'Versions', vers, { action: edit ? h('button.wbw-sec-act', { type: 'button', title: 'Keep the text as it is now', text: '＋ Snapshot', onclick: async ev => { ev.stopPropagation(); await r.views.pages.flush(); const why = await ui.prompt('Name this snapshot', 'Before revising', 'e.g. First draft done'); if (why == null) return; await WB.api('revisions.snapshot', n.id, why || 'Snapshot').catch(WB.fail); ui.toast('Snapshot kept', '⎙'); fillVersions(n, vers, my); } }) : null }));
        fillVersions(n, vers, my);
      }
    }
    const idOfChip = (c, v) => { const ids = [].concat(v || []).filter(Boolean); const label = (c.querySelector('.wb-chip-lbl') || c).textContent; return ids.find(id => WB.titleOf(id) === label) || ids.find(id => WB.titleOf(id) && label.includes(WB.titleOf(id))) || null; };
    function fit(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

    function statusRow(n, d, edit) {
      const box = h('div.wbw-status-pick', { role: 'radiogroup', 'aria-label': d.label });
      const paint = () => {
        GK.clear(box);
        for (const o of d.options || []) box.appendChild(h('button.wbw-status-opt', { type: 'button', role: 'radio', 'aria-checked': String(n.fields[d.key] === o), class: n.fields[d.key] === o ? 'on' : '', style: { '--c': W.statusColor(n, o) }, disabled: !edit, onclick: () => {
          const v = n.fields[d.key] === o ? '' : o; n.fields[d.key] = v; paint(); WB.api('entries.update', n.id, { fieldsPatch: { [d.key]: v } }).catch(WB.fail);
        } }, [h('i'), o]));
      };
      paint();
      return ui.field({ label: d.label, control: box });
    }

    async function fillMentions(n, box, my) {
      const ids = n.kind === 'scene' ? [n.id] : [n.id].concat(r.model.descendants(n.id).map(x => x.id));
      const list = (await WB.api('write.mentions', ids).catch(() => [])).filter(x => WB.visible(x.entry));
      if (my !== seq) return;
      GK.clear(box);
      if (!list.length) { box.appendChild(h('p.gk-small.gk-faint', { text: 'Nothing from your world yet. Type @ in the text to link a character, place or thing — it appears here.' })); return; }
      const groups = new Map();
      for (const x of list) { const t = WB.typeOf(x.entry); const k = t ? t.id : '?'; if (!groups.has(k)) groups.set(k, { t, items: [] }); groups.get(k).items.push(x); }
      const order = [...groups.values()].sort((a, b) => ((a.t && a.t.sort) || 999) - ((b.t && b.t.sort) || 999));
      for (const g of order) {
        box.appendChild(h('div.wbw-intext-group', [
          h('div.wbw-intext-type', [h('span', { text: g.t ? g.t.icon : '◇', style: { color: g.t && g.t.color } }), h('span', { text: g.t ? g.t.plural : 'Other' })]),
          h('div.wb-chips', g.items.map(x => {
            const c = peekChip(x.entry);
            const n2 = x.mentions + x.fields;
            c.title = x.entry.title + ' — ' + [x.mentions ? 'named in the text' + (ids.length > 1 ? ' of ' + x.mentions + (x.mentions === 1 ? ' part' : ' parts') : '') : '', x.fields ? 'in the fields' : ''].filter(Boolean).join(', ') + ' · click to peek';
            if (ids.length > 1 && n2 > 1) c.appendChild(h('span.wbw-chip-n', { text: '×' + n2 }));
            return c;
          })),
        ]));
      }
      // characters named in a scene but not in its cast yet
      if (n.kind === 'scene' && r.editable()) {
        const castDef = ((WB.typeOf(n) || {}).fields || []).find(d => d.key === 'cast');
        const charType = WB.type('character');
        const cast = new Set([].concat(n.fields.cast || [], n.fields.pov ? [n.fields.pov] : []));
        const missing = castDef && charType ? list.filter(x => x.entry.typeId === charType.id && x.mentions && !cast.has(x.entry.id)) : [];
        if (missing.length) {
          box.appendChild(h('div.wbw-suggest', [
            h('span.gk-small.gk-muted', { text: missing.length === 1 ? 'Named in the text but not in the cast:' : 'Named in the text but not in the cast:' }),
            h('div.wb-chips', missing.map(x => h('button.wb-tagchip.btn', { type: 'button', style: { '--c': WB.colorOf(x.entry) }, title: 'Add ' + x.entry.title + ' to this scene’s characters', onclick: () => WB.api('entries.update', n.id, { fieldsPatch: { cast: [].concat(n.fields.cast || [], [x.entry.id]) } }).catch(WB.fail) }, ['＋ ' + x.entry.title]))),
            missing.length > 1 ? h('button.wbw-link', { type: 'button', text: 'Add all', onclick: () => WB.api('entries.update', n.id, { fieldsPatch: { cast: [].concat(n.fields.cast || [], missing.map(x => x.entry.id)) } }).catch(WB.fail) }) : null,
          ]));
        }
      }
    }

    function pinned(st, edit) {
      const ids = (st.write.pinned || []).filter(id => WB.liteOf(id) && WB.visible(WB.liteOf(id)));
      const save = list => WB.api('write.saveData', st.id, { pinned: list }).catch(WB.fail);
      const chips = h('div.wb-chips.wbw-pins', ids.map(id => peekChip(id, edit ? { onRemove: () => { const was = st.write.pinned || []; save(was.filter(x => x !== id)); WB.ui.undoToast('Unpinned “' + WB.titleOf(id) + '”', () => save(was)); } } : {})));
      if (!ids.length) chips.appendChild(h('span.gk-small.gk-faint', { text: edit ? 'Keep the entries you look up most at hand: pin them, or drop them here.' : 'Nothing pinned.' }));
      if (edit) WB.dnd.accept(chips, id => { const list = (st.write.pinned || []).slice(); if (!list.includes(id) && !r.model.get(id)) { list.push(id); save(list); } });
      const add = edit ? h('button.wbw-sec-act', { type: 'button', title: 'Pin entries to this story', text: '＋ Pin', onclick: async ev => {
        ev.stopPropagation();
        const got = await WB.ui.pickEntry({ title: 'Pin to “' + st.title + '”', multi: true, exclude: st.write.pinned || [] });
        if (got && got.length) save((st.write.pinned || []).concat(got.map(x => x.id)));
      } }) : null;
      return section('pinned', 'Pinned to the story', chips, { count: ids.length || null, action: add });
    }

    async function fillVersions(n, box, my) {
      const list = await WB.api('revisions.list', n.id).catch(() => []);
      if (my !== seq) return;
      GK.clear(box);
      if (!list.length) { box.appendChild(h('p.gk-small.gk-faint', { text: 'Earlier versions are kept as you write (every few minutes) and before big changes. Take a snapshot before a bold revision.' })); return; }
      for (const v of list.slice(0, 8)) {
        box.appendChild(h('div.wbw-ver', [
          h('div.gk-grow', [h('div.gk-small', { text: v.reason && v.reason !== 'edit' ? v.reason : 'Autosaved version' }), h('div.gk-tiny.gk-muted', { text: WB.fmt.rel(v.createdAt) + ' · ' + W.num(v.words) + ' words' })]),
          r.editable() ? ui.button({ label: 'Restore', small: true, kind: 'ghost', title: 'Bring this version back (the current text is kept as a version too)', onClick: async () => {
            if (!(await ui.confirm('Restore this version?', 'The text goes back to how it was ' + WB.fmt.rel(v.createdAt) + '. The current text is kept as a version, so you can switch back.', 'Restore'))) return;
            await r.views.pages.flush();
            await WB.api('revisions.restore', v.id).catch(WB.fail);
            ui.toast('Version restored', '↶');
            r.views.pages.show(r.node(), { force: true });
          } }) : null,
        ]));
      }
      if (list.length > 8) box.appendChild(h('button.wbw-link', { type: 'button', text: 'All ' + list.length + ' versions in the Codex ↗', onclick: () => WB.open(n.id) }));
    }

    const resync = WB.debounce(() => {
      const n = r.node();
      if (!n) return show(null);
      if (host.contains(document.activeElement)) { dirty = true; return; }
      if (n.id !== cur || signature(n) !== sig) show(n);
      else {
        // the text changed: refresh what it mentions
        const box = host.querySelector('.wbw-intext');
        if (box) fillMentions(n, box, seq);
        const vers = host.querySelector('.wbw-versions');
        if (vers) fillVersions(n, vers, seq);
      }
    }, 900);
    // textareas size to their text; a panel that was hidden (a drawer, a narrow room) measures again when it shows
    const ro = new ResizeObserver(() => host.querySelectorAll('textarea.wbw-autosize').forEach(fit));
    ro.observe(host);
    host.addEventListener('focusout', () => setTimeout(() => { if (dirty && !host.contains(document.activeElement)) { dirty = false; resync(); } }, 250));
    return { show, sync: () => resync(), destroy() { resync.cancel(); ro.disconnect(); } };
  };
})();
