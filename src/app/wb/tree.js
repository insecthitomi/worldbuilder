/* Nesting helpers shared by the Codex and every entry menu: move with type-rule check + undo, "Move to…", delete a parent. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;
  const T = WB.tree = {};

  /** id → entries below it (any depth), from the world's parent links */
  T.descendantIds = async function (ids) {
    const all = await WB.api('entries.titles', WB.worldId);
    const kids = new Map();
    for (const e of all) if (e.parentId) { if (!kids.has(e.parentId)) kids.set(e.parentId, []); kids.get(e.parentId).push(e.id); }
    const out = new Set(), walk = id => { for (const c of kids.get(id) || []) if (!out.has(c)) { out.add(c); walk(c); } };
    ids.forEach(walk);
    return out;
  };
  /** do the type rules (and the world's "allow any nesting" switch) let `child` sit inside `parent`? */
  T.canNest = (parent, child) => {
    if (!parent || !child) return true;
    return WB.F.canNest((WB.world && WB.world.settings) || {}, WB.typeOf(parent), WB.typeOf(child));
  };
  const isRule = err => /type rules/.test((err && err.message) || '');

  /** move entries (parentId null = top level; beforeId / afterId / index place them among the new siblings).
      Type rules are checked first; a refusal offers "move anyway". Resolves to true when it moved. Undo toast included. */
  T.move = async function (ids, o = {}, { quiet = false } = {}) {
    ids = [...new Set(ids)];
    if (!ids.length) return false;
    const before = await WB.api('entries.many', ids).catch(() => []);
    const prev = new Map(before.map(e => [e.id, { parentId: e.parentId || null, position: e.position }]));
    const run = strict => WB.api('entries.moveMany', ids, Object.assign({}, o, { strict }));
    try {
      try { await run(true); }
      catch (err) {
        if (!isRule(err)) throw err;
        const ok = await ui.confirm('Not usually nested', err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') + ' Move it there anyway?', 'Move anyway');
        if (!ok) return false;
        await run(false);
      }
    } catch (err) { WB.fail(err); return false; }
    if (!quiet) {
      const where = o.parentId ? WB.titleOf(o.parentId) : 'the top level';
      WB.ui.undoToast((ids.length === 1 ? '“' + (WB.titleOf(ids[0]) || 'Entry') + '”' : ids.length + ' entries') + ' moved' + (o.parentId !== undefined ? ' to ' + (o.parentId ? '“' + where + '”' : where) : ''),
        async () => { for (const [id, p] of prev) await WB.api('entries.update', id, { parentId: p.parentId, position: p.position }).catch(() => {}); });
    }
    return true;
  };

  /** "Move to…": search a new parent (cannot pick the entries themselves or anything inside them) */
  T.moveDialog = async function (ids) {
    ids = [].concat(ids);
    const first = WB.liteOf(ids[0]);
    const below = await T.descendantIds(ids);
    const p = await WB.ui.pickEntry({ title: ids.length === 1 ? 'Move “' + ((first && first.title) || 'entry') + '” to…' : 'Move ' + ids.length + ' entries to…', exclude: ids.concat([...below]), allowNone: 'Top level' });
    if (p === undefined) return false;
    return T.move(ids, { parentId: p ? p.id : null });
  };

  /** delete with the choice a parent needs: everything inside goes with it, or the contents move up one level */
  T.deleteDialog = async function (e) {
    const counts = await WB.api('entries.descendantCounts', WB.worldId).catch(() => ({}));
    const n = counts[e.id] || 0;
    if (!n) return undefined;   // nothing inside: the caller does its usual plain delete
    const choice = await ui.dialog({ title: 'Delete “' + e.title + '”?', icon: '🗑', body: h('div.gk-stack', [
      h('p', { text: '“' + e.title + '” has ' + WB.fmt.plural(n, 'entry', 'entries') + ' inside it.' }),
      h('p.gk-small.gk-muted', { text: 'Delete everything moves all of them to the trash with it. Keep the contents moves the direct children up to where “' + e.title + '” is and deletes only this one. Either can be undone.' }),
    ]), actions: [{ label: 'Cancel', value: false }, { label: 'Keep the contents', value: 'keep' }, { label: 'Delete everything', kind: 'danger', value: 'all' }] });
    if (choice === 'all') return WB.trash(e);
    if (choice === 'keep') {
      try {
        const r = await WB.api('entries.removeKeepChildren', e.id);
        WB.ui.undoToast('“' + e.title + '” deleted, ' + WB.fmt.plural(r.promoted.length, 'entry', 'entries') + ' moved up', async () => { await WB.api('entries.restore', e.id); await WB.api('entries.moveMany', r.promoted, { parentId: e.id }); });
        return r;
      } catch (err) { WB.fail(err); }
    }
    return null;
  };
})();
