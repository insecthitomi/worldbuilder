/* Write · model: the manuscript tree (stories → chapters → scenes) built from write.tree, word roll-ups, statuses,
   the writing session (words and active time since the screen opened today) and small formatting helpers. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h;

  /* ---------------- statuses (data colours) ---------------- */
  const STATUS = { Idea: '#9aa5b1', Outline: '#b07ad6', Draft: '#e2b33d', Revised: '#6fa7d8', Final: '#5fb38a' };
  const STAGE = { Idea: '#9aa5b1', Outlining: '#b07ad6', Drafting: '#e2b33d', Revising: '#6fa7d8', Editing: '#4fb6b2', Finished: '#5fb38a', Published: '#e06aa8' };
  const SPARE = ['#e0796b', '#8f7ad8', '#4fae7d', '#d97f9f', '#c7835b', '#5a9fd4'];
  W.statusKey = n => (n.kind === 'story' ? 'stage' : 'status');
  W.statusOptions = n => {
    const t = WB.typeOf(n), def = t && (t.fields || []).find(f => f.key === W.statusKey(n));
    return (def && def.options) || (n.kind === 'story' ? Object.keys(STAGE) : ['Idea', 'Draft', 'Revised', 'Final']);
  };
  W.statusColor = (n, value) => {
    const v = value !== undefined ? value : (n.fields || {})[W.statusKey(n)];
    if (!v) return '';
    const map = n.kind === 'story' ? STAGE : STATUS;
    if (map[v]) return map[v];
    const opts = W.statusOptions(n), i = Math.max(0, opts.indexOf(v));
    return SPARE[i % SPARE.length];
  };
  W.status = n => (n.fields || {})[W.statusKey(n)] || '';

  /* ---------------- numbers ---------------- */
  W.k = n => (n == null ? '' : n < 1000 ? String(n) : n < 10000 ? (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k');
  W.num = n => WB.fmt.num(n || 0);
  W.minutes = s => { s = Math.max(0, Math.round(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60); return hh ? hh + ' h ' + String(mm).padStart(2, '0') + ' min' : mm + ' min'; };
  W.clock = s => { s = Math.max(0, Math.round(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0'); };
  W.readTime = w => { const m = Math.round((w || 0) / 230); return m < 1 ? 'under a minute' : m < 60 ? m + ' min read' : (Math.round(m / 6) / 10) + ' h read'; };
  /** a thin progress bar (fraction may exceed 1: reached targets turn green) */
  W.bar = (f, cls) => { const el = h('span.wbw-bar', { class: cls || '' }, [h('i')]); W.setBar(el, f); return el; };
  W.setBar = (el, f) => { if (!el) return; const v = Math.max(0, f || 0); el.firstChild.style.width = Math.min(1, v) * 100 + '%'; el.classList.toggle('done', v >= 1); };

  /* ---------------- the tree ---------------- */
  W.Model = class Model {
    constructor(worldId) { this.worldId = worldId; this.nodes = new Map(); this.kids = new Map(); this.roots = []; this.loose = []; this.typeIds = {}; }
    async load() {
      const t = await WB.api('write.tree', this.worldId);
      this.build(t);
      return this;
    }
    build(t) {
      this.typeIds = t.typeIds || {};
      const all = new Map(t.nodes.map(n => [n.id, n]));
      // Share view: hidden entries and everything inside them disappear
      const hidden = id => { let n = all.get(id), g = 0; while (n && g++ < 60) { if (!WB.visible(n)) return true; n = all.get(n.parentId); } return false; };
      const prev = this.nodes;
      this.nodes = new Map();
      for (const n of t.nodes) if (!hidden(n.id)) { const old = prev.get(n.id); if (old && old.live != null && old.liveAt > Date.now() - 3000) n.words = old.live; this.nodes.set(n.id, n); }
      this.kids = new Map();
      for (const n of this.nodes.values()) {
        const p = n.parentId && this.nodes.has(n.parentId) ? n.parentId : null;
        if (!p) continue;
        if (!this.kids.has(p)) this.kids.set(p, []);
        this.kids.get(p).push(n);
      }
      for (const list of this.kids.values()) list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      const top = [...this.nodes.values()].filter(n => !n.parentId || !this.nodes.has(n.parentId)).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      this.roots = top.filter(n => n.kind === 'story');
      this.loose = top.filter(n => n.kind !== 'story');
      const depth = (n, d) => { n.depth = d; for (const c of this.children(n.id)) depth(c, d + 1); };
      this.roots.forEach(n => depth(n, 0));
      this.loose.forEach(n => depth(n, 1));
      this.rollup();
    }
    get(id) { return this.nodes.get(id) || null; }
    children(id) { return this.kids.get(id) || []; }
    parent(id) { const n = this.get(id); return n && n.parentId ? this.get(n.parentId) : null; }
    ancestors(id) { const out = []; let p = this.parent(id), g = 0; while (p && g++ < 60) { out.unshift(p); p = this.parent(p.id); } return out; }
    story(id) { const n = this.get(id); if (!n) return null; if (n.kind === 'story') return n; return this.ancestors(id).find(a => a.kind === 'story') || null; }
    /** every node under id, depth first, in order */
    descendants(id, acc = []) { for (const c of this.children(id)) { acc.push(c); this.descendants(c.id, acc); } return acc; }
    scenes(id) { const n = this.get(id); if (!n) return []; return n.kind === 'scene' ? [n] : this.descendants(id).filter(x => x.kind === 'scene'); }
    /** scenes of the whole manuscript in reading order (for next / previous) */
    readingOrder(storyId) { return storyId ? this.scenes(storyId) : this.roots.flatMap(r => this.scenes(r.id)).concat(this.loose.filter(n => n.kind === 'scene')); }
    neighbour(id, dir) { const s = this.story(id), list = this.readingOrder(s && s.id), i = list.findIndex(x => x.id === id); return i < 0 ? null : list[i + dir] || null; }
    rollup() {
      const walk = n => { n.total = n.words + this.children(n.id).reduce((a, c) => a + walk(c), 0); return n.total; };
      this.roots.forEach(walk); this.loose.forEach(walk);
    }
    /** live word count from an editor; returns the ids whose totals changed */
    setWords(id, words) {
      const n = this.get(id);
      if (!n || n.words === words) return [];
      n.words = words; n.live = words; n.liveAt = Date.now();
      this.rollup();
      return [id].concat(this.ancestors(id).map(a => a.id));
    }
    target(n) { return +((n.fields || {}).target) || 0; }
    /** what a new child of a node should be */
    childKind(n) { return !n ? 'story' : n.kind === 'story' ? 'chapter' : n.kind === 'chapter' ? 'scene' : null; }
    canContain(parent, kind) {
      if (!parent) return kind === 'story';
      if (parent.kind === 'story') return kind === 'chapter' || kind === 'scene';
      if (parent.kind === 'chapter') return kind === 'scene';
      return false;
    }
    lite(n) { return { id: n.id, title: n.title, typeId: n.typeId, summary: n.summary, icon: n.icon, color: n.color, favorite: n.favorite, audience: n.audience, start: n.start, end: n.end, deletedAt: null, aliases: [] }; }
  };

  /* ---------------- the writing session (per app run, per day) ---------------- */
  const S = W.session = W.session || { day: null, base: new Map(), cur: new Map(), secs: new Map(), active: 0, last: 0, startedAt: null, unsent: new Map() };
  const reset = () => { S.day = WB.today(); S.base = new Map(); S.cur = new Map(); S.secs = new Map(); S.unsent = new Map(); S.active = 0; S.startedAt = new Date().toISOString(); };
  W.sessionTouch = (id, words) => { if (S.day !== WB.today()) reset(); if (!S.base.has(id)) S.base.set(id, words); };
  W.sessionWords = (id, words) => { if (S.day !== WB.today()) reset(); if (!S.base.has(id)) S.base.set(id, words); S.cur.set(id, words); };
  W.sessionTotal = () => { let n = 0; for (const [id, w] of S.cur) n += w - (S.base.get(id) || 0); return n; };
  W.sessionPing = id => { S.last = Date.now(); S.lastId = id; };
  /** counts a second of writing when the writer typed in the last 45 seconds */
  W.sessionTick = () => {
    if (!S.lastId || Date.now() - S.last > 45000) return false;
    S.active++;
    S.secs.set(S.lastId, (S.secs.get(S.lastId) || 0) + 1);
    S.unsent.set(S.lastId, (S.unsent.get(S.lastId) || 0) + 1);
    return true;
  };
  W.sessionFlush = () => {
    if (!WB.worldId) return;
    for (const [id, s] of S.unsent) if (s > 0) WB.api('writing.addTime', WB.worldId, id, s).catch(() => {});
    S.unsent = new Map();
  };
  if (!S.day) reset();
})();
