/* Checks → quick fixes (with Undo), "Mark as intended" with a note, the world-date picker for date fixes, and the
   "Fix next" walk-through that steps through open issues one by one. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const K = WB.checks = WB.checks || {};

  K.SEV = { error: ['Error', '⛔', 'bad'], warn: ['Warning', '⚠', 'warn'], info: ['Note', 'ℹ', 'info'] };

  /** chips for an issue's entries (trashed or deleted ones stay readable) */
  K.chips = function (issue) {
    const refs = new Map((issue.refs || []).map(r => [r.id, r]));
    return h('div.wb-chips.ck-chips', (issue.entryIds || []).map(id => {
      if (WB.liteOf(id)) return U.chip(id, { size: 'sm' });
      const r = refs.get(id);
      return h('span.wb-chip.sm.gone', { title: r ? '“' + r.title + '” is in the trash' : 'This entry was deleted' }, [h('span.wb-chip-ico', { text: '🗑' }), h('span.wb-chip-lbl', { text: r ? r.title : 'deleted entry' })]);
    }));
  };

  /** a small dialog with the world-date input; resolves the date value, null to clear, undefined when cancelled */
  K.pickDate = function ({ title, value, hint, allowEmpty = true }) {
    let v = value || null;
    const input = U.dateInput({ value: v, onChange: d => { v = d; } });
    const body = h('div.ck-datepick', [hint ? h('p.gk-small.gk-muted.ck-tight', { text: hint }) : null, input]);
    return ui.dialog({ title, icon: '▦', body, actions: [{ label: 'Cancel', value: false }].concat(allowEmpty && value ? [{ label: 'Clear the date', value: 'clear' }] : []).concat([{ label: 'Save', kind: 'primary', value: true }]) })
      .then(ok => { if (ok === 'clear') return null; if (!ok) return undefined; const i = body.querySelector('input'); if (i) i.dispatchEvent(new Event('change')); return v; });
  };

  const entryUndo = async (id, parts) => {
    const e = await WB.api('entries.get', id).catch(() => null);
    if (!e) return null;
    const snap = {};
    for (const k of parts) snap[k] = k === 'fields' ? Object.assign({}, e.fields) : e[k];
    return { title: e.title, undo: () => WB.api('entries.update', id, snap) };
  };

  /** runs one fix; resolves true when something changed */
  K.applyFix = async function (issue, fix) {
    const W = WB.worldId;
    const run = f => WB.api('checks.fix', W, f);
    switch (fix.kind) {
      case 'open': WB.open(fix.entryId); return false;
      case 'openField': WB.open(fix.entryId, { field: fix.field, focusField: fix.field }); return false;
      case 'openMap': WB.go('atlas', { entryId: fix.entryId, itemId: fix.itemId }); return false;
      case 'openBoard': WB.go('boards', { entryId: fix.entryId, itemId: fix.itemId }); return false;
      case 'openLibrary': WB.go('library', { mediaId: fix.mediaId }); return false;
      case 'replaceMedia': { const m = await WB.api('media.replace', fix.mediaId).catch(WB.fail); if (m) ui.toast('Replaced the file', '▣'); return !!m; }
      case 'merge': {
        const a = WB.liteOf(fix.into), b = WB.liteOf(fix.from);
        if (!a || !b) { ui.toast('One of the two entries is gone already', 'ℹ'); return false; }
        const ok = await ui.confirm('Merge “' + b.title + '” into “' + a.title + '”?', '“' + b.title + '” becomes part of “' + a.title + '”: its text, empty fields, tags, children and every link move over, and its name becomes an alias. A backup is made first. If they are really different, cancel and mark the issue as intended.', 'Merge', true);
        if (!ok) return false;
        const r = await run(fix).catch(WB.fail);
        if (r) U.undoToast(r.message + ' A backup was made first.', null, 6000);
        return !!r;
      }
      case 'setDate': {
        const e = await WB.api('entries.get', fix.entryId).catch(WB.fail);
        if (!e) return false;
        const t = WB.typeOf(e), labels = (t && t.dated) || { start: 'Start', end: 'End' }, which = fix.which === 'end' ? 'end' : 'start';
        const other = which === 'end' ? e.start : e.end;
        const v = await K.pickDate({ title: (labels[which] || (which === 'end' ? 'End' : 'Start')) + ' — ' + e.title, value: e[which], hint: other ? (labels[which === 'end' ? 'start' : 'end'] || '') + ': ' + WB.fmt.date(other) : issue.title });
        if (v === undefined) return false;
        const u = await entryUndo(e.id, [which]);
        const r = await run(Object.assign({}, fix, { value: v })).catch(WB.fail);
        if (r && u) U.undoToast('Date changed for “' + u.title + '”', u.undo);
        return !!r;
      }
      case 'restore': {
        const r = await run(fix).catch(WB.fail);
        if (r) U.undoToast(r.message, () => WB.api('entries.trash', fix.entryId));
        return !!r;
      }
      case 'trashMedia': { const r = await run(fix).catch(WB.fail); if (r) U.undoToast(r.message, () => WB.api('media.restore', fix.mediaId)); return !!r; }
      case 'restoreMedia': { const r = await run(fix).catch(WB.fail); if (r) U.undoToast(r.message, () => WB.api('media.remove', fix.mediaId)); return !!r; }
      case 'swapLinkDates': { const r = await run(fix).catch(WB.fail); if (r) U.undoToast(r.message, () => run(fix)); return !!r; }
      default: {
        // entry edits: keep what changes so Undo can put it back
        const parts = { unmention: ['body'], swapDates: ['start', 'end'], removeRef: ['fields'], setField: ['fields'], audience: ['audience'], clearReveal: ['revealDay'] }[fix.kind];
        const u = parts && fix.entryId ? await entryUndo(fix.entryId, parts) : null;
        const r = await run(fix).catch(WB.fail);
        if (r) { if (u) U.undoToast(r.message, u.undo); else ui.toast(r.message, '✓'); }
        return !!r;
      }
    }
  };

  /** "Mark as intended" with an optional note; resolves true when marked */
  K.ignore = function (issue, anchor) {
    return new Promise(resolve => {
      const note = ui.input({ multiline: true, rows: 3, value: issue.note || '', placeholder: 'Why it is fine (optional) — e.g. “she visits the ruins”' });
      let done = false;
      const finish = async ok => {
        if (done) return; done = true; pop.close();
        if (!ok) return resolve(false);
        await WB.api('checks.ignore', WB.worldId, issue.key, note.value.trim()).catch(WB.fail);
        U.undoToast('Marked as intended', () => WB.api('checks.unignore', WB.worldId, issue.key));
        resolve(true);
      };
      const body = h('div.ck-ignore', [
        h('b', { text: 'Mark as intended' }),
        h('p.gk-small.gk-muted.ck-tight', { text: 'The issue moves to “Marked as intended” and stays quiet until what it is about changes.' }),
        note,
        h('div.gk-row.ck-ignore-foot', [h('span.gk-grow'), ui.button({ label: 'Cancel', small: true, onClick: () => finish(false) }), ui.button({ label: 'Mark as intended', small: true, kind: 'primary', onClick: () => finish(true) })]),
      ]);
      note.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); finish(true); } });
      const pop = U.popover(anchor || { x: innerWidth / 2, y: innerHeight / 3 }, body, { cls: 'ck-ignore-pop', group: 'ckignore', width: '22em', onClose: () => { if (!done) { done = true; resolve(false); } } });
      setTimeout(() => note.focus(), 30);
    });
  };

  /* ---------------- Fix next: one issue at a time ---------------- */
  K.walk = function (issues, { start = 0, reload } = {}) {
    let list = issues.slice(), i = Math.max(0, Math.min(start, list.length - 1)), busy = false, fixed = 0, marked = 0;
    const body = h('div.ck-walk');
    const panel = ui.panel({ title: 'Fix next', icon: '➜', cls: 'gk-dialog ck-walkdlg', body: [body] });
    const foot = h('div.gk-panel-foot');
    panel.appendChild(foot);
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); if (fixed + marked) ui.toast((fixed ? WB.fmt.plural(fixed, 'fix', 'fixes') : '') + (fixed && marked ? ' · ' : '') + (marked ? marked + ' marked as intended' : ''), '✓'); };
    const refresh = async (keepKey) => {
      const fresh = await reload();
      const k = keepKey || (list[i] && list[i].key);
      list = fresh;
      const at = list.findIndex(x => x.key === k);
      if (at >= 0) i = at; else i = Math.min(i, list.length - 1);
      paint();
    };
    const next = () => { if (i < list.length - 1) { i++; paint(); } else paint(true); };
    const prev = () => { if (i > 0) { i--; paint(); } };
    function paint(end) {
      GK.clear(body); GK.clear(foot);
      if (!list.length || end) {
        body.appendChild(U.empty({ icon: list.length ? '⚑' : '✓', title: list.length ? 'That was the last one' : 'Nothing left to fix', text: list.length ? 'You went through every open issue. The ones you skipped are still on the list.' : 'Every check passes, or what is left is marked as intended. Nicely kept world.' }));
        GK.append(foot, [h('span.gk-grow'), list.length ? ui.button({ label: 'Start over', onClick: () => { i = 0; paint(); } }) : null, ui.button({ label: 'Close', kind: 'primary', onClick: close })]);
        return;
      }
      const it = list[i], [sevLabel, sevIco, tone] = K.SEV[it.severity] || K.SEV.info;
      const cat = (K.catalog || []).find(c => c.id === it.check) || { label: it.check, icon: '◇' };
      body.append(
        h('div.ck-walk-top', [
          h('span.ck-sev', { class: tone, text: sevIco + ' ' + sevLabel }),
          h('span.gk-small.gk-muted', { text: cat.icon + ' ' + cat.label }),
          h('span.gk-grow'),
          h('span.gk-small.gk-muted', { text: (i + 1) + ' of ' + list.length }),
        ]),
        h('div.ck-walk-bar', [h('i', { style: { width: ((i + 1) / list.length * 100) + '%' } })]),
        h('h3.ck-walk-title', { text: it.title }),
        h('p.ck-walk-detail', { text: it.detail }),
        K.chips(it),
        h('div.ck-walk-fixes', (it.fixes || []).map((f, n) => ui.button({ label: f.label, kind: n === 0 ? 'primary' : '', small: true, title: n === 0 ? 'Enter' : '', onClick: async () => {
          if (busy) return; busy = true;
          try { const changed = await K.applyFix(it, f); if (/^open/.test(f.kind)) { close(); return; } if (changed) { fixed++; await refresh(); } } finally { busy = false; }
        } }))),
      );
      foot.append(
        ui.button({ label: '‹ Back', small: true, kind: 'ghost', disabled: i === 0, title: '←', onClick: prev }),
        ui.button({ label: 'Mark as intended…', small: true, title: 'I', onClick: async e => { if (await K.ignore(it, e.currentTarget)) { marked++; await refresh(); } } }),
        h('span.gk-grow'),
        h('span.gk-tiny.gk-faint', [U.kbd('Enter'), ' fix · ', U.kbd('→'), ' skip · ', U.kbd('Esc'), ' close']),
        ui.button({ label: 'Skip ›', small: true, title: '→', onClick: next }),
      );
    }
    const onKey = e => {
      const top = [...document.querySelectorAll('.gk-scrim')].pop();
      if (top !== scrim || document.querySelector('.wb-pop[data-group="ckignore"]')) return;
      if (e.target.closest && e.target.closest('input, textarea, select') && e.key !== 'Escape') return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Enter') { const b = body.querySelector('.ck-walk-fixes .gk-btn'); if (b && !e.target.closest('.gk-btn')) { e.preventDefault(); b.click(); } }
      else if (e.key === 'i' || e.key === 'I') { const b = [...foot.querySelectorAll('.gk-btn')].find(x => /intended/.test(x.textContent)); if (b) { e.preventDefault(); b.click(); } }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    paint();
  };
})();
