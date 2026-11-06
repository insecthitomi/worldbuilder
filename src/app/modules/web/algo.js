/* Graph algorithms for the Web: neighbourhoods, connection paths and communities. Edges are { id, a, b, … }
   (undirected for these purposes). UMD: the renderer and the unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBGraph = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** id → [{ to, e }] */
  function adjacency(ids, edges) {
    const adj = new Map();
    for (const id of ids) adj.set(id, []);
    for (const e of edges) {
      if (!adj.has(e.a) || !adj.has(e.b) || e.a === e.b) continue;
      adj.get(e.a).push({ to: e.b, e });
      adj.get(e.b).push({ to: e.a, e });
    }
    return adj;
  }

  /** id → hops from `start`, up to `depth` */
  function around(adj, start, depth) {
    const d = new Map([[start, 0]]), q = [start];
    while (q.length) {
      const x = q.shift(), k = d.get(x);
      if (k >= depth) continue;
      for (const { to } of adj.get(x) || []) if (!d.has(to)) { d.set(to, k + 1); q.push(to); }
    }
    return d;
  }

  /** shortest path avoiding some nodes / edges: { nodes: [ids], edges: [edge] } or null */
  function bfsPath(adj, a, b, banNodes, banEdges) {
    if (a === b) return { nodes: [a], edges: [] };
    const prev = new Map([[a, null]]), q = [a];
    while (q.length) {
      const x = q.shift();
      for (const { to, e } of adj.get(x) || []) {
        if (prev.has(to) || (banNodes && banNodes.has(to)) || (banEdges && banEdges.has(e))) continue;
        prev.set(to, { from: x, e });
        if (to === b) {
          const nodes = [b], edges = [];
          for (let y = b; prev.get(y); y = prev.get(y).from) { edges.unshift(prev.get(y).e); nodes.unshift(prev.get(y).from); }
          return { nodes, edges };
        }
        q.push(to);
      }
    }
    return null;
  }

  /** every shortest path from a to b (at most `max`) */
  function shortest(adj, a, b, max = 12) {
    if (!adj.has(a) || !adj.has(b)) return [];
    const dist = new Map([[a, 0]]), q = [a];
    while (q.length) { const x = q.shift(); if (x === b) break; for (const { to } of adj.get(x)) if (!dist.has(to)) { dist.set(to, dist.get(x) + 1); q.push(to); } }
    if (!dist.has(b)) return [];
    // walk back from b through nodes one step closer to a
    const out = [];
    const walk = (x, nodes, edges) => {
      if (out.length >= max) return;
      if (x === a) { out.push({ nodes: [a].concat(nodes), edges: edges.slice() }); return; }
      const dx = dist.get(x);
      const seen = new Set();
      for (const { to, e } of adj.get(x)) {
        if (dist.get(to) !== dx - 1) continue;
        const key = to + '|' + e.id;
        if (seen.has(key)) continue;
        seen.add(key);
        walk(to, [x].concat(nodes), [e].concat(edges));
      }
    };
    walk(b, [], []);
    // one path per distinct chain of nodes (parallel links between the same two entries are folded together)
    const byNodes = new Map();
    for (const p of out) { const k = p.nodes.join('>'); if (!byNodes.has(k)) byNodes.set(k, p); }
    return [...byNodes.values()];
  }

  /** up to k loopless paths from a to b, shortest first (Yen); paths through the same nodes count once */
  function paths(adj, a, b, k = 5) {
    const first = shortest(adj, a, b, k);
    if (!first.length) return [];
    const A = first.slice(0, k), B = [];
    const key = p => p.nodes.join('>');
    const have = new Set(A.map(key));
    while (A.length < k) {
      const last = A[A.length - 1];
      for (let i = 0; i < last.nodes.length - 1; i++) {
        const spur = last.nodes[i], rootNodes = last.nodes.slice(0, i + 1), rootEdges = last.edges.slice(0, i);
        const banE = new Set(), banN = new Set(rootNodes.slice(0, -1));
        for (const p of A) if (p.nodes.length > i && p.nodes.slice(0, i + 1).join('>') === rootNodes.join('>')) {
          // ban every parallel edge between the spur node and the next node of a known path
          for (const { to, e } of adj.get(spur) || []) if (to === p.nodes[i + 1]) banE.add(e);
        }
        const sp = bfsPath(adj, spur, b, banN, banE);
        if (!sp) continue;
        const cand = { nodes: rootNodes.slice(0, -1).concat(sp.nodes), edges: rootEdges.concat(sp.edges) };
        if (!have.has(key(cand)) && !B.some(x => key(x) === key(cand))) B.push(cand);
      }
      if (!B.length) break;
      B.sort((x, y) => x.nodes.length - y.nodes.length);
      const nx = B.shift();
      have.add(key(nx)); A.push(nx);
    }
    return A;
  }

  /** communities by modularity (Louvain): id → group number (0 = largest); unlinked entries get -1 */
  function communities(ids, edges, { weight } = {}) {
    const index = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    // level-0 graph: merged weighted adjacency
    let adj = Array.from({ length: n }, () => new Map());
    let total = 0;
    for (const e of edges) {
      const i = index.get(e.a), j = index.get(e.b);
      if (i == null || j == null || i === j) continue;
      const w = weight ? weight(e) : 1;
      adj[i].set(j, (adj[i].get(j) || 0) + w);
      adj[j].set(i, (adj[j].get(i) || 0) + w);
      total += w;
    }
    let member = ids.map((_, i) => i);     // original node → current super node
    if (!total) return new Map(ids.map(id => [id, -1]));
    const m2 = total * 2;
    for (let level = 0; level < 12; level++) {
      const N = adj.length;
      const k = adj.map(a => { let s = 0; for (const w of a.values()) s += w; return s; });
      const self = adj.map((a, i) => a.get(i) || 0);
      const comm = Array.from({ length: N }, (_, i) => i);
      const tot = k.slice();
      let moved = false;
      for (let pass = 0; pass < 20; pass++) {
        let changes = 0;
        for (let i = 0; i < N; i++) {
          const ci = comm[i];
          const wTo = new Map();
          for (const [j, w] of adj[i]) { if (j === i) continue; const cj = comm[j]; wTo.set(cj, (wTo.get(cj) || 0) + w); }
          tot[ci] -= k[i];
          let best = ci, gain = (wTo.get(ci) || 0) - tot[ci] * k[i] / m2;
          for (const [c, w] of wTo) { const g = w - tot[c] * k[i] / m2; if (g > gain + 1e-12) { gain = g; best = c; } }
          tot[best] += k[i];
          if (best !== ci) { comm[i] = best; changes++; }
        }
        if (!changes) break;
        moved = true;
      }
      if (!moved) break;
      // aggregate
      const ren = new Map();
      for (const c of comm) if (!ren.has(c)) ren.set(c, ren.size);
      const nadj = Array.from({ length: ren.size }, () => new Map());
      for (let i = 0; i < N; i++) {
        const ci = ren.get(comm[i]);
        if (self[i]) nadj[ci].set(ci, (nadj[ci].get(ci) || 0) + self[i]);
        for (const [j, w] of adj[i]) { if (j === i) continue; const cj = ren.get(comm[j]); nadj[ci].set(cj, (nadj[ci].get(cj) || 0) + w); }
      }
      member = member.map(s => ren.get(comm[s]));
      adj = nadj;
      if (ren.size === N) break;
    }
    // number the groups by size; a node with no links is in no group
    const deg = new Array(n).fill(0);
    for (const e of edges) { const i = index.get(e.a), j = index.get(e.b); if (i != null && j != null && i !== j) { deg[i]++; deg[j]++; } }
    const size = new Map();
    member.forEach((c, i) => { if (deg[i]) size.set(c, (size.get(c) || 0) + 1); });
    const order = [...size.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]);
    const rank = new Map(order.map((c, i) => [c, i]));
    return new Map(ids.map((id, i) => [id, deg[i] ? rank.get(member[i]) : -1]));
  }

  /** connected pieces: id → piece number (0 = largest) */
  function components(ids, edges) {
    const adj = adjacency(ids, edges), comp = new Map();
    const pieces = [];
    for (const id of ids) {
      if (comp.has(id)) continue;
      const list = [id]; comp.set(id, -1);
      for (let i = 0; i < list.length; i++) for (const { to } of adj.get(list[i])) if (!comp.has(to)) { comp.set(to, -1); list.push(to); }
      pieces.push(list);
    }
    pieces.sort((a, b) => b.length - a.length);
    pieces.forEach((p, i) => p.forEach(id => comp.set(id, i)));
    return comp;
  }

  return { adjacency, around, bfsPath, shortest, paths, communities, components };
});
