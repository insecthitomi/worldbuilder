'use strict';
/* The static website: every page a reader may see, rendered from the knowledge-filtered model (publish-model.js).
   Output is a list of files (text, or media to copy); nothing here touches the disk. All links are relative, so the
   folder works opened straight from disk, from any web host, or inside the app's live preview. */
const fs = require('fs');
const path = require('path');
const T = require('../../shared/richtext');
const F = require('../../shared/fields');
const H = require('./publish-html');
const { CSS, THEMES } = require('./publish-theme');
const { esc, attr } = H;

const SECTIONS = { maps: true, chronology: true, family: true, devlog: true, shop: true, search: true, index: true };
const DEFAULTS = { title: '', tagline: '', theme: 'parchment', accent: '', audience: 'public', asOf: null, types: null, sections: SECTIONS,
  coverId: null, footer: '', baseUrl: '', featured: [], outDir: '' };
const SPECIAL = { post: 'devlog', product: 'shop', map: 'maps' };
const RESERVED = new Set(['assets', 'media', 'index', 'search', 'chronology', 'family', 'all', '404', 'feed', 'sitemap', 'robots', 'devlog', 'shop', 'maps']);
let CLIENT = null;
const clientJs = () => CLIENT || (CLIENT = fs.readFileSync(path.join(__dirname, 'publish-client.js'), 'utf8'));

/** site settings with defaults filled in */
function settingsOf(world) {
  const raw = (world && world.settings && world.settings.site) || {};
  const s = Object.assign({}, DEFAULTS, raw);
  s.sections = Object.assign({}, SECTIONS, raw.sections || {});
  if (!THEMES[s.theme]) s.theme = 'parchment';
  if (!['public', 'shared'].includes(s.audience)) s.audience = 'public';
  s.featured = Array.isArray(s.featured) ? s.featured.filter(x => typeof x === 'string') : [];
  s.baseUrl = String(s.baseUrl || '').trim();
  if (s.baseUrl && !/\/$/.test(s.baseUrl)) s.baseUrl += '/';
  return s;
}
const accentOf = s => (/^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : THEMES[s.theme].accent);
const roman = n => { const r = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let o = ''; for (const [v, l] of r) while (n >= v) { o += l; n -= v; } return o || 'I'; };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

/**
 * m: model (publish-model) built for the site's audience
 * s: settings (settingsOf)
 * x: { today, items: Map mapId → [item], reviews: [review], media(id) → { file, ext, width, height } | null, builtAt, postState(fields) }
 * → { files: [{ path, data } | { path, copy }], pages: [path], counts }
 */
function render(m, s, x) {
  const files = [], pages = [];
  const world = m.world, accent = accentOf(s), siteTitle = s.title || world.name;
  const add = (p, data) => { files.push({ path: p, data }); if (/\.html$/.test(p)) pages.push(p); };

  /* ---------- media: copied only when a page uses it ---------- */
  const mediaUsed = new Map();
  const media = id => {
    if (!id) return null;
    if (mediaUsed.has(id)) return mediaUsed.get(id);
    const md = x.media ? x.media(id) : null;
    const v = md && md.file ? { rel: 'media/' + id + '.' + (md.ext || 'bin'), width: md.width, height: md.height } : null;
    mediaUsed.set(id, v);
    if (v) files.push({ path: v.rel, copy: md.file });
    return v;
  };

  /* ---------- routes ---------- */
  const typeSlug = new Map(), usedFolders = new Set(RESERVED);
  for (const t of m.types) {
    let sl = SPECIAL[t.key] || H.slug(t.plural || t.name, 40);
    if (!SPECIAL[t.key]) { if (usedFolders.has(sl)) sl = sl + '-pages'; sl = H.uniqueSlug(sl, usedFolders); }
    typeSlug.set(t.id, sl);
  }
  const post = m.types.find(t => t.key === 'post'), product = m.types.find(t => t.key === 'product'), mapType = m.types.find(t => t.key === 'map');
  const teaser = e => e.type.key === 'post' && /supporter/i.test(String(e.fields.audience_tier || ''));
  const url = new Map();
  const slugsIn = new Map();
  const ordered = m.entries.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  for (const e of ordered) {
    if (teaser(e)) continue;
    const folder = typeSlug.get(e.typeId);
    const used = slugsIn.get(folder) || slugsIn.set(folder, new Set(['index'])).get(folder);
    url.set(e.id, folder + '/' + H.uniqueSlug(H.slug(e.title), used) + '.html');
  }
  const pageOf = id => url.get(id) || null;
  const types = m.types.filter(t => !t.hidden || m.entries.some(e => e.typeId === t.id));
  const countOf = new Map();
  for (const e of m.entries) if (pageOf(e.id)) countOf.set(e.typeId, (countOf.get(e.typeId) || 0) + 1);
  const listed = types.filter(t => countOf.get(t.id) && t.key !== 'post' && t.key !== 'product');
  const has = { devlog: !!(post && s.sections.devlog && m.entries.some(e => e.typeId === post.id)), shop: !!(product && s.sections.shop && countOf.get(product.id)) };
  has.maps = !!(mapType && s.sections.maps && countOf.get(mapType.id));
  const dated = m.entries.filter(e => e.start && pageOf(e.id) && e.type.key !== 'post');
  has.chronology = !!(s.sections.chronology && dated.length);
  const fams = s.sections.family ? families(m) : [];
  const posts = post ? m.entries.filter(e => e.typeId === post.id).map(e => ({ e, ps: x.postState(e.fields) })).sort((a, b) => String(b.ps.date || '').localeCompare(String(a.ps.date || '')) || b.e.createdAt.localeCompare(a.e.createdAt)) : [];
  has.family = fams.length > 0;
  has.search = s.sections.search !== false;
  has.index = s.sections.index !== false;

  /* ---------- page shell ---------- */
  const asOfText = m.cal.format({ day: m.asOf, prec: 'day' }, 'long');
  const typeColor = t => (t && t.color) || accent;
  const tc = t => '--tc:' + typeColor(t);
  function shell({ title, depth = 0, body, active = '', desc = '', bodyClass = '', canonical = '', base = '' }) {
    const up = depth ? '../'.repeat(depth) : '';
    const navLink = (href, label, key) => `<a href="${up}${href}"${active === key ? ' class="on" aria-current="page"' : ''}>${esc(label)}</a>`;
    const explore = listed.map(t => `<a href="${up}${typeSlug.get(t.id)}/index.html" style="${tc(t)}"${active === 'type:' + t.key ? ' class="on"' : ''}><span class="ti">${esc(t.icon)}</span>${esc(t.plural)}<span class="n">${countOf.get(t.id)}</span></a>`).join('');
    const nav = [
      navLink('index.html', 'Home', 'home'),
      listed.length ? `<details class="nav-explore"><summary>Explore</summary><div class="nav-menu">${explore}${has.index ? `<a href="${up}all.html"><span class="ti">≡</span>Every page A–Z</a>` : ''}</div></details>` : '',
      has.maps ? navLink('maps/index.html', 'Maps', 'type:map') : '',
      has.chronology ? navLink('chronology.html', 'Chronology', 'chronology') : '',
      has.family ? navLink('family.html', 'Families', 'family') : '',
      has.devlog ? navLink('devlog/index.html', 'Devlog', 'devlog') : '',
      has.shop ? navLink('shop/index.html', 'Shop', 'shop') : '',
      `<div class="side-types">${explore}</div>`,
    ].join('');
    const fullTitle = title && title !== siteTitle ? title + ' · ' + siteTitle : siteTitle;
    const og = s.baseUrl && canonical ? `<link rel="canonical" href="${attr(s.baseUrl + canonical)}"><meta property="og:url" content="${attr(s.baseUrl + canonical)}">` : '';
    return `<!doctype html>
<html lang="en" data-theme="${s.theme}" data-root="${up}" style="--accent:${accent}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${attr(base)}">` : ''}<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(clip(desc || s.tagline || world.summary, 200))}">
<meta name="generator" content="Worldbuilder">
<meta property="og:title" content="${attr(title || siteTitle)}"><meta property="og:site_name" content="${attr(siteTitle)}">${og}
<link rel="icon" href="${favicon}">
<link rel="stylesheet" href="${up}assets/site.css">
${has.devlog ? `<link rel="alternate" type="application/rss+xml" title="${attr(siteTitle)} devlog" href="${up}feed.xml">` : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap head-row">
<a class="brand" href="${up}index.html"><span class="brand-mark">${esc(world.icon || (siteTitle.trim()[0] || 'W').toUpperCase())}</span><span class="brand-name">${esc(siteTitle)}</span></a>
<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">☰</button>
<nav id="site-nav" class="site-nav" aria-label="Site">${nav}</nav>
${has.search ? `<form class="site-search" role="search" action="${up}search.html"><input name="q" type="search" placeholder="Search…" autocomplete="off" aria-label="Search this site"><div class="search-pop" hidden></div></form>` : ''}
</div></header>
<main id="main" class="wrap">
${body}
</main>
<footer class="site-foot"><div class="wrap foot-row">
<span class="grow">${s.footer ? esc(s.footer) : '© ' + esc(siteTitle)}</span>
<span>As of ${esc(asOfText)}</span>
${has.devlog ? `<a href="${up}feed.xml">RSS</a>` : ''}${has.index ? `<a href="${up}all.html">All pages</a>` : ''}
<span class="faint">Made with Worldbuilder</span>
</div></footer>
${has.search ? `<script src="${up}assets/search-index.js"></script>` : ''}<script src="${up}assets/site.js"></script>
</body>
</html>
`;
  }
  const favicon = H.favicon(siteTitle, accent);

  /* ---------- shared bits ---------- */
  const hrefFrom = depth => id => { const p = pageOf(id); return p ? (depth ? '../'.repeat(depth) : '') + p : null; };
  const mediaFrom = depth => id => { const v = media(id); return v ? { src: (depth ? '../'.repeat(depth) : '') + v.rel } : null; };
  const icon = t => `<span class="ti" style="${tc(t)}">${esc(t ? t.icon : '◆')}</span>`;
  const entryDates = e => {
    const t = e.type, lab = t.dated || { start: 'Start', end: 'End' };
    const parts = [];
    if (e.start) parts.push(`${esc(lab.start || 'From')} ${esc(m.date(e.start))}`);
    if (e.end) parts.push(`${esc(lab.end || 'Until')} ${esc(m.date(e.end))}`);
    const age = m.age(e);
    if (age != null) parts.push(e.end && e.end.day <= m.asOf ? `aged ${age}` : `age ${age}`);
    return parts.join(' · ');
  };
  function card(e, depth) {
    const up = depth ? '../'.repeat(depth) : '', p = pageOf(e.id), cov = media(e.coverId);
    const inner = `<div class="card-img">${cov ? `<img src="${up}${cov.rel}" alt="" loading="lazy">` : esc(e.icon || e.type.icon)}</div>
<div class="card-body"><div class="card-type">${esc(e.type.name)}</div><h3>${esc(e.title)}</h3>${e.summary ? `<p>${esc(e.summary)}</p>` : ''}${e.start || e.end ? `<div class="card-meta">${esc(m.span(e))}</div>` : ''}</div>`;
    return p ? `<a class="card" href="${up}${p}" style="${tc(e.type)}" data-name="${attr(e.title + ' ' + (e.aliases || []).join(' '))}" data-type="${attr(e.type.key)}">${inner}</a>` : `<div class="card" style="${tc(e.type)}">${inner}</div>`;
  }
  const pill = (id, depth) => {
    const t = m.typeOf(id), title = m.titleOf(id), h = hrefFrom(depth)(id);
    if (!title) return '';
    return h ? `<a class="pill" href="${h}" style="${tc(t)}">${icon(t)}${esc(title)}</a>` : `<span class="pill" style="${tc(t)}">${icon(t)}${esc(title)}</span>`;
  };

  /* ---------- entry pages ---------- */
  // maps first: each map is drawn once and remembers which pin shows which entry ("On the map" links)
  const mapHtml = new Map(), mapIndex = new Map();
  const viewerFor = e => { if (!mapHtml.has(e.id)) mapHtml.set(e.id, mapViewer(e, 1)); return mapHtml.get(e.id); };
  for (const e of m.entries) if (e.type.lens === 'map' && pageOf(e.id)) viewerFor(e);
  const typeOrder = new Map();
  for (const e of m.entries.filter(x => pageOf(x.id)).sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))) (typeOrder.get(e.typeId) || typeOrder.set(e.typeId, []).get(e.typeId)).push(e);
  for (const e of m.entries) {
    const p = pageOf(e.id);
    if (!p) continue;
    const depth = 1, up = '../', t = e.type, href = hrefFrom(depth), md = mediaFrom(depth);
    const body = H.bodyHtml(e.body, { href, media: md, headingIds: true });
    const heads = H.headings(body);
    const crumbs = [`<a href="../index.html">Home</a>`, `<a href="index.html">${esc(t.key === 'post' ? 'Devlog' : t.key === 'product' ? 'Shop' : t.plural)}</a>`]
      .concat(m.crumbs(e.id).map(a => { const h = href(a.id); return h ? `<a href="${h}">${esc(a.title)}</a>` : esc(a.title); }));
    // infobox: visible fields with values
    const rows = [];
    let group = null;
    const skip = new Set(t.key === 'post' ? ['publish', 'status', 'audience_tier', 'excerpt'] : t.key === 'product' ? ['price', 'currency', 'link', 'blurb', 'status'] : []);
    for (const d of t.fields || []) {
      if (skip.has(d.key)) continue;
      const v = e.fields[d.key], html = H.fieldHtml(d, v, { href, title: m.titleOf, media: md });
      if (!html) continue;
      if (d.group && d.group !== group) { group = d.group; rows.push(`<div class="group">${esc(d.group)}</div>`); }
      rows.push(`<dt>${esc(d.label)}</dt><dd>${html}</dd>`);
    }
    const cover = media(e.coverId);
    const dates = entryDates(e);
    const info = rows.length || cover ? `<aside class="infobox" style="${tc(t)}">${cover ? `<div class="infobox-cover"><img src="${up}${cover.rel}" alt=""></div>` : ''}<div class="infobox-title">${esc(e.title)}</div>${rows.length ? `<dl>${rows.join('')}</dl>` : ''}</aside>` : '';
    const parts = [];
    if (t.key === 'post') {
      const ps = x.postState(e.fields);
      parts.push(`<p class="post-date">${esc(H.realDate(ps.date) || '')}</p>`);
    }
    if (t.key === 'product') parts.push(buyBox(e, depth));
    if (heads.length >= 3) parts.push(`<nav class="toc"><b>Contents</b><ol>${heads.map(h => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>`);
    if (body.trim()) parts.push(`<div class="prose">${body}</div>`);
    if (t.lens === 'map') parts.push(viewerFor(e));
    const kids = (m.children.get(e.id) || []).map(id => m.byId.get(id)).filter(k => k && pageOf(k.id));
    if (kids.length) parts.push(`<div class="section-head"><h2>${esc(kidsHeading(e, kids))}</h2></div><div class="cards">${kids.map(k => card(k, depth)).join('')}</div>`);
    const rels = m.relationsOf(e.id);
    if (rels.length) {
      parts.push(`<div class="section-head"><h2>Relations</h2></div><div class="rels">${rels.map(r => {
        const ot = m.typeOf(r.other), h = href(r.other), when = [r.startDay != null ? m.cal.yearText(m.cal.yearOf(r.startDay).y) : '', r.endDay != null ? m.cal.yearText(m.cal.yearOf(r.endDay).y) : ''];
        return `<div class="rel" style="${tc(ot)}">${icon(ot)}<div><span class="lbl">${esc(r.label)}</span>${h ? `<a href="${h}">${esc(m.titleOf(r.other))}</a>` : `<span class="t">${esc(m.titleOf(r.other))}</span>`}${when[0] || when[1] ? `<span class="when">${esc(when[0] && when[1] ? when[0] + ' – ' + when[1] : when[0] ? 'since ' + when[0] : 'until ' + when[1])}</span>` : ''}${r.note ? `<span class="when">${esc(r.note)}</span>` : ''}</div></div>`;
      }).join('')}</div>`);
    }
    if (t.key === 'product') parts.push(reviewsHtml(x.reviews.filter(r => r.productId === e.id), depth, false));
    if (t.key === 'post') parts.push(postPager(e, depth));
    const back = (m.backlinks.get(e.id) || []).filter(b => pageOf(b.src));
    const onMaps = [...mapIndex].filter(([mid, by]) => mid !== e.id && by.has(e.id) && pageOf(mid)).map(([mid, by]) => `<a href="../${pageOf(mid)}#pin-${by.get(e.id)}">${esc(m.titleOf(mid))}</a>`);
    const sibs = t.key === 'post' ? [] : typeOrder.get(e.typeId) || [], si = sibs.indexOf(e), prev = si > 0 ? sibs[si - 1] : null, next = si >= 0 && si < sibs.length - 1 ? sibs[si + 1] : null;
    const pager = prev || next ? `<nav class="pager" aria-label="${attr(t.plural)}">${prev ? `<a href="../${pageOf(prev.id)}"><small>← Previous ${esc(t.name.toLowerCase())}</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="../${pageOf(next.id)}" style="text-align:right"><small>Next ${esc(t.name.toLowerCase())} →</small>${esc(next.title)}</a>` : ''}</nav>` : '';
    const tags = (e.tags || []).map(id => m.tags.get(id)).filter(Boolean);
    const html = `<article class="entry" style="${tc(t)}">
<nav class="crumbs" aria-label="Breadcrumb">${crumbs.join('<span class="sep">›</span>')}</nav>
<header class="entry-head">
<div class="entry-type">${icon(t)}${esc(t.name)}</div>
<h1>${esc(e.title)}</h1>
${e.aliases && e.aliases.length ? `<p class="aka">Also known as ${esc(e.aliases.join(', '))}</p>` : ''}
${dates ? `<p class="dates">${dates}</p>` : ''}
${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
${tags.length ? `<div class="tags">${tags.map(g => `<span class="tag">#${esc(g.name)}</span>`).join('')}</div>` : ''}
${onMaps.length ? `<p class="onmap"><span class="ti">⌖</span>On the map: ${onMaps.join(', ')}</p>` : ''}
</header>
<div class="entry-grid${info ? '' : ' solo'}"><div class="entry-main">${parts.join('\n') || (info ? '' : '<p class="muted">Nothing more is written here yet.</p>')}</div>${info}</div>
${back.length ? `<section class="backlinks"><h2>Linked from</h2><div class="pills">${back.map(b => pill(b.src, depth)).join('')}</div></section>` : ''}
${pager}
</article>`;
    add(p, shell({ title: e.title, depth, body: html, active: t.key === 'post' ? 'devlog' : t.key === 'product' ? 'shop' : 'type:' + t.key, desc: e.summary || T.text(e.body).slice(0, 200), canonical: p, bodyClass: 'page-entry type-' + t.key }));
  }
  function kidsHeading(e, kids) {
    const kt = kids[0].type;
    return kids.every(k => k.typeId === kt.id) ? kt.plural + ' in ' + e.title : 'Inside ' + e.title;
  }

  /* ---------- type indexes ---------- */
  for (const t of listed) {
    const list = m.entries.filter(e => e.typeId === t.id && pageOf(e.id)).sort((a, b) => a.title.localeCompare(b.title));
    const folder = typeSlug.get(t.id);
    const filter = list.length > 8 ? `<div class="filter" data-filter="#list"><input type="search" placeholder="Filter ${attr(t.plural.toLowerCase())}…" aria-label="Filter"><span class="muted small">${list.length} ${esc(t.plural.toLowerCase())}</span></div>` : '';
    const body = `<nav class="crumbs"><a href="../index.html">Home</a><span class="sep">›</span>${esc(t.plural)}</nav>
<div class="entry-type" style="${tc(t)}">${icon(t)}${esc(list.length + ' ' + (list.length === 1 ? t.name : t.plural).toLowerCase())}</div>
<h1 class="page-title">${esc(t.plural)}</h1>
${t.key === 'map' && has.maps ? '<p class="lead">Explore the maps: drag to pan, scroll to zoom, click a pin to learn more.</p>' : ''}
${filter}<div class="cards" id="list">${list.map(e => card(e, 1)).join('')}</div>`;
    add(folder + '/index.html', shell({ title: t.plural, depth: 1, body, active: 'type:' + t.key, canonical: folder + '/index.html', bodyClass: 'page-index' }));
  }

  /* ---------- devlog ---------- */
  function postCard({ e, ps }, depth) {
    const up = depth ? '../'.repeat(depth) : '', p = pageOf(e.id), cov = media(e.coverId);
    const excerpt = e.fields.excerpt || e.summary || clip(T.text(e.body), 260);
    return `<article class="post-card${cov ? '' : ' nocover'}">${cov ? `<div class="cover"><img src="${up}${cov.rel}" alt="" loading="lazy"></div>` : ''}<div>
<div class="post-date">${esc(H.realDate(ps.date) || '')}${teaser(e) ? ' <span class="badge">Supporters only</span>' : ''}</div>
<h3>${p ? `<a href="${up}${p}">${esc(e.title)}</a>` : esc(e.title)}</h3>
${excerpt ? `<p>${esc(clip(excerpt, 320))}</p>` : ''}
${p ? `<a href="${up}${p}">Read more →</a>` : '<span class="muted small">This post is for supporters.</span>'}
</div></article>`;
  }
  function postPager(e, depth) {
    const list = posts.filter(x => pageOf(x.e.id)), i = list.findIndex(x => x.e.id === e.id);
    if (i < 0) return '';
    const newer = list[i - 1], older = list[i + 1], up = '../'.repeat(depth);
    return `<nav class="pager">${older ? `<a href="${up}${pageOf(older.e.id)}"><small>← Older</small>${esc(older.e.title)}</a>` : '<span></span>'}${newer ? `<a href="${up}${pageOf(newer.e.id)}" style="text-align:right"><small>Newer →</small>${esc(newer.e.title)}</a>` : ''}</nav>`;
  }
  if (has.devlog) {
    const body = `<nav class="crumbs"><a href="../index.html">Home</a><span class="sep">›</span>Devlog</nav>
<h1 class="page-title">Devlog</h1><p class="lead">News, notes and updates from ${esc(siteTitle)}. <a href="../feed.xml">Follow with RSS</a>.</p>
${posts.length ? `<div class="posts">${posts.map(p => postCard(p, 1)).join('')}</div>` : '<div class="empty"><span class="big">✦</span>No posts yet.</div>'}`;
    add('devlog/index.html', shell({ title: 'Devlog', depth: 1, body, active: 'devlog', canonical: 'devlog/index.html' }));
    add('feed.xml', rss());
  }
  function rss() {
    const base = s.baseUrl || '', link = p => base + p;
    const items = posts.filter(p => pageOf(p.e.id) || teaser(p.e)).slice(0, 50).map(({ e, ps }) => {
      const p = pageOf(e.id), excerpt = e.fields.excerpt || e.summary || clip(T.text(e.body), 400);
      const full = p ? H.bodyHtml(e.body, { href: id => { const q = pageOf(id); return q ? link(q) : null; }, media: id => { const v = media(id); return v ? { src: link(v.rel) } : null; } }) : '';
      return `<item><title>${esc(e.title)}</title>${p ? `<link>${esc(link(p))}</link>` : ''}<guid isPermaLink="false">${esc(world.id + '-' + e.id)}</guid><pubDate>${H.rfc822(ps.date || e.createdAt)}</pubDate><description>${esc(excerpt)}</description>${full ? `<content:encoded><![CDATA[${full.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></content:encoded>` : ''}</item>`;
    });
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(siteTitle)}</title>
<link>${esc(base ? base + 'devlog/index.html' : 'devlog/index.html')}</link>
<description>${esc(s.tagline || world.summary || siteTitle)}</description>
<language>en</language>
<generator>Worldbuilder</generator>
<lastBuildDate>${new Date(x.builtAt || Date.now()).toUTCString()}</lastBuildDate>
${base ? `<atom:link href="${esc(base)}feed.xml" rel="self" type="application/rss+xml"/>` : ''}
${items.join('\n')}
</channel>
</rss>
`;
  }

  /* ---------- shop ---------- */
  function buyBox(e, depth) {
    const f = e.fields, price = H.money(f.price, f.currency || world.settings.currency);
    const status = f.status && f.status !== 'Available' ? `<span class="badge dim">${esc(f.status)}</span>` : '';
    const buy = /^https?:\/\//i.test(f.link || '') && !/sold out|retired|planned/i.test(f.status || '') ? `<a class="btn" href="${attr(f.link)}" rel="noopener" target="_blank">Buy now ↗</a>` : '';
    if (!price && !buy && !f.blurb && !status) return '';
    return `<div class="buybox">${price ? `<span class="price">${esc(price)}</span>` : ''}${f.format ? `<span class="badge">${esc(f.format)}</span>` : ''}${status}${buy}</div>${f.blurb ? `<div class="prose">${H.paragraphs(f.blurb)}</div>` : ''}`;
  }
  function reviewsHtml(list, depth, withProduct) {
    if (!list.length) return '';
    return `<div class="section-head"><h2>What readers say</h2></div><div class="reviews">${list.map(r => {
      const n = Math.max(0, Math.min(5, Math.round(+r.rating || 0)));
      const prod = withProduct && r.productId && m.titleOf(r.productId) ? ` on ${pageOf(r.productId) ? `<a href="${'../'.repeat(depth)}${pageOf(r.productId)}">${esc(m.titleOf(r.productId))}</a>` : esc(m.titleOf(r.productId))}` : '';
      return `<figure class="review">${n ? `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : ''}<p>${esc(r.text)}</p><footer>— ${esc(r.author || 'A reader')}${prod}${r.source ? `, ${esc(r.source)}` : ''}</footer></figure>`;
    }).join('')}</div>`;
  }
  if (has.shop) {
    const prods = m.entries.filter(e => e.typeId === product.id && pageOf(e.id)).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    const body = `<nav class="crumbs"><a href="../index.html">Home</a><span class="sep">›</span>Shop</nav>
<h1 class="page-title">Shop</h1><p class="lead">Books, maps and more from ${esc(siteTitle)}.</p>
<div class="products">${prods.map(e => {
      const f = e.fields, cov = media(e.coverId), p = pageOf(e.id), price = H.money(f.price, f.currency || world.settings.currency);
      const buy = /^https?:\/\//i.test(f.link || '') && !/sold out|retired|planned/i.test(f.status || '') ? `<a class="btn" href="${attr(f.link)}" rel="noopener" target="_blank">Buy ↗</a>` : '';
      return `<article class="product" style="${tc(e.type)}"><div class="card-img${cov ? '' : ' short'}">${cov ? `<img src="../${cov.rel}" alt="" loading="lazy">` : esc(e.icon || e.type.icon)}</div><div class="body">
<div class="card-type">${esc(f.format || e.type.name)}${f.status && f.status !== 'Available' ? ` · ${esc(f.status)}` : ''}</div>
<h3><a href="../${p}">${esc(e.title)}</a></h3>
${price ? `<div class="price">${esc(price)}</div>` : ''}
<div class="blurb">${f.blurb ? H.paragraphs(clip(f.blurb, 360)) : e.summary ? `<p>${esc(e.summary)}</p>` : ''}</div>
<div class="actions">${buy}<a class="btn ghost" href="../${p}">Details</a></div>
</div></article>`;
    }).join('')}</div>
${reviewsHtml(x.reviews, 1, true)}`;
    add('shop/index.html', shell({ title: 'Shop', depth: 1, body, active: 'shop', canonical: 'shop/index.html' }));
  }

  /* ---------- maps ---------- */
  function mapViewer(e, depth) {
    if (!s.sections.maps) {
      const v = media(e.data.image);
      return v ? `<figure class="map"><img src="${'../'.repeat(depth)}${v.rel}" alt="${attr(e.title)}"></figure>` : '';
    }
    const up = '../'.repeat(depth), img = media(e.data.image);
    const W = +e.data.width || (img && img.width) || 0, Hh = +e.data.height || (img && img.height) || 0;
    const items = (x.items.get(e.id) || []).filter(it => !it.entryId || m.visible.has(it.entryId));
    if (!img && !items.length) return '';
    const w = W || 1600, h = Hh || 1000;
    const pins = [], svg = [], legend = [], byEntry = new Map();
    mapIndex.set(e.id, byEntry);
    const pct = (v, n) => Math.max(-5, Math.min(105, (v / n) * 100)).toFixed(3);
    for (const it of items) {
      const t = it.entryId ? m.typeOf(it.entryId) : null;
      const label = it.hideLabel && it.kind !== 'pin' ? '' : it.label || (it.entryId ? m.titleOf(it.entryId) : '');
      const color = it.color || (t && t.color) || accent;
      const pinData = { t: label || (t ? t.name : 'Marker'), k: t ? t.name : '', s: it.entryId ? ((m.byId.get(it.entryId) || m.lite(it.entryId) || {}).summary || '') : '', u: it.entryId ? hrefFrom(depth)(it.entryId) : null, m: it.subMapId && m.visible.has(it.subMapId) ? hrefFrom(depth)(it.subMapId) : null };
      if (it.kind === 'pin' && Number.isFinite(it.x) && Number.isFinite(it.y)) {
        const i = pins.length; pins.push(pinData);
        if (it.entryId && !byEntry.has(it.entryId)) byEntry.set(it.entryId, i);
        const target = pinData.u || pinData.m;
        const ic = it.icon && x.icons && x.icons.get(it.icon);
        const glyph = ic ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${attr(ic.d)}" fill="#fff" fill-rule="${ic.rule === 'evenodd' ? 'evenodd' : 'nonzero'}"/></svg>` : `<span>${esc(t ? t.icon : '•')}</span>`;
        const big = it.size && it.size !== 1 ? `;--ps:${Math.max(.6, Math.min(2.2, it.size))}` : '';
        pins[i].el = `<${target ? `a href="${attr(target)}"` : 'span'} class="pin" data-i="${i}" style="left:${pct(it.x, w)}%;top:${pct(it.y, h)}%;--pc:${attr(color)}${big}" title="${attr(pinData.t)}"><span class="pin-dot">${glyph}</span>${label && !it.hideLabel ? `<span class="pin-label">${esc(label)}</span>` : ''}</${target ? 'a' : 'span'}>`;
        legend.push(`<button type="button" data-go="${i}" style="--pc:${attr(color)}"><span class="d"></span>${esc(pinData.t)}</button>`);
      } else if ((it.kind === 'region' || it.kind === 'path') && it.points.length > 1) {
        const pts = it.points.map(p => (+p[0]).toFixed(1) + ',' + (+p[1]).toFixed(1)).join(' ');
        if (it.kind === 'region') { const i = pins.length; pins.push(pinData); if (it.entryId && !byEntry.has(it.entryId)) byEntry.set(it.entryId, i); svg.push(`<polygon class="region" data-i="${i}" points="${pts}" fill="${attr(color)}" fill-opacity="${it.fill != null ? +it.fill : .22}" stroke="${attr(color)}"${it.dashed ? ' stroke-dasharray="8 6"' : ''}><title>${esc(pinData.t)}</title></polygon>`); }
        else svg.push(`<polyline class="route" points="${pts}" stroke="${attr(color)}" style="stroke-width:${Math.max(1, Math.min(10, it.width || 2.5))}px"${it.dashed ? ' stroke-dasharray="10 8"' : ''}${it.opacity != null ? ` stroke-opacity="${it.opacity}"` : ''}><title>${esc(pinData.t)}</title></polyline>`);
        // region names sized by the region's area, as the Atlas does (map pixels, so they zoom with the map)
        if (it.kind === 'region' && label) { const c = centroid(it.points), size = Math.max(10, Math.min(Math.min(w, h) / 9, Math.sqrt(area(it.points)) / 11)) * (it.labelSize || 1); svg.push(`<text class="region-name" x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${size.toFixed(1)}">${esc(label)}</text>`); }
      } else if (it.kind === 'label' && Number.isFinite(it.x) && label) {
        const size = Math.max(6, Math.min(Math.min(w, h) / 4, it.size || 18)), c = it.color || '#2b2116', text = it.caps ? label.toUpperCase() : label;
        const light = /^#[0-9a-f]{6}$/i.test(c) && lum(c) > .6;
        svg.push(`<text class="map-label" x="${it.x.toFixed(1)}" y="${it.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${size.toFixed(1)}" style="fill:${attr(c)};stroke:${light ? 'rgba(20,30,40,.45)' : 'rgba(250,246,234,.7)'};stroke-width:${Math.max(2, size * .16).toFixed(1)}px${it.italic ? ';font-style:italic' : ''}${it.caps ? ';letter-spacing:' + (size * .16).toFixed(1) + 'px' : ''}"${it.angle ? ` transform="rotate(${it.angle} ${it.x.toFixed(1)} ${it.y.toFixed(1)})"` : ''}>${esc(text)}</text>`);
      }
    }
    const data = JSON.stringify({ pins: pins.map(p => ({ t: p.t, k: p.k, s: clip(p.s, 220), u: p.u, m: p.m })) }).replace(/</g, '\\u003c');
    return `<figure class="map"><div class="map-viewer" style="aspect-ratio:${w} / ${h}"><div class="map-stage">
${img ? `<img class="map-img" src="${up}${img.rel}" alt="${attr(e.title)}" width="${w}" height="${h}">` : `<div class="map-blank" style="aspect-ratio:${w} / ${h}"></div>`}
<svg class="map-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${svg.join('')}</svg>
${pins.map(p => p.el || '').join('')}
</div><div class="map-tools"><button type="button" data-zoom="in" title="Zoom in">+</button><button type="button" data-zoom="out" title="Zoom out">−</button><button type="button" data-zoom="fit" title="Show the whole map">⤢</button></div></div>
<script type="application/json" class="map-data">${data}</script>
${legend.length ? `<figcaption class="map-legend">${legend.join('')}</figcaption>` : ''}${!img ? '<p class="map-note">This map has no image yet.</p>' : ''}</figure>`;
  }

  /* ---------- chronology ---------- */
  if (has.chronology) {
    const items = [];
    for (const e of dated) {
      const lab = e.type.dated || {};
      items.push({ e, d: e.start, k: lab.start || (e.end ? 'Begins' : ''), end: e.end });
      if (e.end && e.end.day !== e.start.day && lab.end) items.push({ e, d: e.end, k: lab.end, isEnd: true });
    }
    items.sort((a, b) => a.d.day - b.d.day || (a.d.min || 0) - (b.d.min || 0) || a.e.title.localeCompare(b.e.title));
    const rows = [];
    let era = undefined, year = null, nowDone = false;
    const typesUsed = [...new Set(items.map(i => i.e.type))];
    for (const it of items) {
      if (!nowDone && it.d.day > m.asOf) { rows.push(`<li class="chron-now"><span>As of</span><i title="${attr(asOfText)}"></i></li>`); nowDone = true; }
      const ymd = m.cal.ymd(it.d.day), er = m.cal.eraOf(ymd.y);
      if (er.index !== era) { era = er.index; if (er.name) rows.push(`<li class="chron-era">${esc(er.name)}</li>`); year = null; }
      if (ymd.y !== year) { year = ymd.y; rows.push(`<li class="chron-year"><span>${esc(m.cal.yearText(ymd.y))}</span></li>`); }
      const when = it.d.prec === 'year' ? '' : it.d.prec === 'month' ? m.cal.monthName(ymd.m) : ymd.d + ' ' + m.cal.monthName(ymd.m) + (it.d.prec === 'time' ? ', ' + m.cal.timeText(it.d.min) : '');
      const h = pageOf(it.e.id);
      rows.push(`<li class="chron-item" style="${tc(it.e.type)}" data-type="${attr(it.e.type.key)}" data-name="${attr(it.e.title)}"><div class="when">${esc(when)}</div><div class="what"><span class="k">${esc(it.k || it.e.type.name)}</span><b><a href="${h}">${esc(it.e.title)}</a></b>${!it.isEnd && it.e.summary ? `<p>${esc(clip(it.e.summary, 200))}</p>` : ''}${!it.isEnd && it.end ? `<p class="small faint">until ${esc(m.date(it.end))}</p>` : ''}</div></li>`);
    }
    if (!nowDone) rows.push(`<li class="chron-now"><span>As of</span><i title="${attr(asOfText)}"></i></li>`);
    const chips = typesUsed.length > 1 ? `<div class="filter" data-filter="#chron"><input type="search" placeholder="Filter…" aria-label="Filter">${typesUsed.map(t => `<button type="button" class="chip on" data-type="${attr(t.key)}" style="${tc(t)}">${esc(t.icon)} ${esc(t.plural)}</button>`).join('')}</div>` : '';
    const body = `<nav class="crumbs"><a href="index.html">Home</a><span class="sep">›</span>Chronology</nav>
<h1 class="page-title">Chronology</h1><p class="lead">Everything dated, in order, on the ${esc(m.cal.cal.name || 'world')} calendar. The line marks ${esc(asOfText)}.</p>
${chips}<ol class="chron" id="chron">${rows.join('\n')}</ol>`;
    add('chronology.html', shell({ title: 'Chronology', depth: 0, body, active: 'chronology', canonical: 'chronology.html' }));
  }

  /* ---------- families ---------- */
  if (has.family) {
    const person = (id, f) => {
      const e = m.byId.get(id), h = pageOf(id), cov = e && media(e.coverId);
      const parents = (f.parents.get(id) || []).map(p => m.titleOf(p)).filter(Boolean);
      const sub = [e && (e.start || e.end) ? m.span(e) : '', parents.length ? 'child of ' + parents.join(' & ') : ''].filter(Boolean).join(' · ');
      const inner = `${cov ? `<img src="${cov.rel}" alt="">` : `<span class="ph">${esc(e ? e.icon || e.type.icon : '☺')}</span>`}<span><b>${esc(m.titleOf(id))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
      return h ? `<a class="person" href="${h}" style="${tc(e && e.type)}">${inner}</a>` : `<span class="person">${inner}</span>`;
    };
    const body = `<nav class="crumbs"><a href="index.html">Home</a><span class="sep">›</span>Families</nav>
<h1 class="page-title">Families</h1><p class="lead">Lineages traced through parents, marriages and siblings.</p>
${fams.map(f => `<section class="family"><h2>${esc(f.name)}</h2>${f.gens.map((g, i) => `<div class="gen"><div class="gen-n" title="Generation ${i + 1}">${roman(i + 1)}</div><div class="gen-row">${g.map(unit => unit.length > 1 ? `<div class="couple">${unit.map(id => person(id, f)).join('<span class="ring" title="married">⚭</span>')}</div>` : person(unit[0], f)).join('')}</div></div>`).join('')}</section>`).join('')}`;
    add('family.html', shell({ title: 'Families', depth: 0, body, active: 'family', canonical: 'family.html' }));
  }

  /* ---------- home ---------- */
  {
    const cover = media(s.coverId || world.coverId);
    let featured = s.featured.filter(id => pageOf(id)).map(id => m.byId.get(id));
    if (!featured.length) featured = m.entries.filter(e => e.favorite && pageOf(e.id) && e.type.key !== 'post' && e.type.key !== 'product');
    if (!featured.length) featured = m.entries.filter(e => pageOf(e.id) && e.type.key !== 'post' && e.type.key !== 'product').sort((a, b) => (b.coverId ? 1 : 0) - (a.coverId ? 1 : 0) || b.wordCount - a.wordCount).slice(0, 6);
    featured = featured.slice(0, 6);
    const latest = posts.slice(0, 3);
    const body = `<section class="hero">${cover ? `<img src="${cover.rel}" alt="">` : ''}<div class="hero-body">
<h1>${esc(siteTitle)}</h1>${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}${world.summary ? `<p class="summary">${esc(world.summary)}</p>` : ''}
<span class="asof">As of ${esc(asOfText)}</span></div></section>
${listed.length ? `<div class="section-head"><h2>Explore</h2>${has.index ? '<a href="all.html">Every page A–Z →</a>' : ''}</div><div class="tiles">${listed.map(t => `<a class="tile" href="${typeSlug.get(t.id)}/index.html" style="${tc(t)}">${icon(t)}<span><b>${esc(t.plural)}</b><span class="n">${countOf.get(t.id)} ${countOf.get(t.id) === 1 ? 'page' : 'pages'}</span></span></a>`).join('')}
${has.chronology ? `<a class="tile" href="chronology.html"><span class="ti">⧗</span><span><b>Chronology</b><span class="n">${dated.length} dated</span></span></a>` : ''}${has.family ? `<a class="tile" href="family.html"><span class="ti">⚭</span><span><b>Families</b><span class="n">${fams.length} ${fams.length === 1 ? 'family' : 'families'}</span></span></a>` : ''}</div>` : ''}
${featured.length ? `<div class="section-head"><h2>Featured</h2></div><div class="cards">${featured.map(e => card(e, 0)).join('')}</div>` : ''}
${latest.length && has.devlog ? `<div class="section-head"><h2>Latest from the devlog</h2><a href="devlog/index.html">All posts →</a></div><div class="posts">${latest.map(p => postCard(p, 0)).join('')}</div>` : ''}
${has.shop ? `<div class="section-head"><h2>From the shop</h2><a href="shop/index.html">Visit the shop →</a></div><div class="cards">${m.entries.filter(e => product && e.typeId === product.id && pageOf(e.id)).slice(0, 3).map(e => card(e, 0)).join('')}</div>` : ''}
${!listed.length && !latest.length ? '<div class="empty"><span class="big">◆</span>Nothing has been published yet.</div>' : ''}`;
    add('index.html', shell({ title: siteTitle, depth: 0, body, active: 'home', desc: s.tagline || world.summary, canonical: 'index.html', bodyClass: 'page-home' }));
  }

  /* ---------- A–Z, search, 404 ---------- */
  const all = m.entries.filter(e => pageOf(e.id)).sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  if (has.index) {
    const groups = new Map();
    for (const e of all) { const L = (e.title.normalize('NFKD').replace(/[̀-ͯ]/g, '')[0] || '#').toUpperCase(); const k = /[A-Z]/.test(L) ? L : '#'; (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    const body = `<nav class="crumbs"><a href="index.html">Home</a><span class="sep">›</span>All pages</nav>
<h1 class="page-title">Every page</h1><p class="lead">${all.length} pages, A to Z.</p>
<nav class="az-letters">${[...groups.keys()].map(k => `<a href="#l-${k === '#' ? 'num' : k}">${k}</a>`).join('')}</nav>
<div class="az">${[...groups].map(([k, list]) => `<h2 id="l-${k === '#' ? 'num' : k}">${k}</h2><ul>${list.map(e => `<li style="${tc(e.type)}">${icon(e.type)}<a href="${pageOf(e.id)}">${esc(e.title)}</a> <span class="faint small">${esc(e.type.name)}</span></li>`).join('')}</ul>`).join('')}</div>`;
    add('all.html', shell({ title: 'All pages', depth: 0, body, active: '', canonical: 'all.html' }));
  }
  if (has.search) {
    const index = all.map(e => ({ t: e.title, u: pageOf(e.id), k: e.type.name, c: typeColor(e.type), i: e.icon || e.type.icon, s: e.summary || '', a: e.aliases || [], x: clip(T.text(e.body), 600) }));
    files.push({ path: 'assets/search-index.js', data: 'window.WB_SITE_INDEX = ' + JSON.stringify(index).replace(/</g, '\\u003c') + ';\n' });
    files.push({ path: 'assets/search-index.json', data: JSON.stringify(index) });
    add('search.html', shell({ title: 'Search', depth: 0, active: '', canonical: 'search.html', body: `<div id="search-page"><h1 class="page-title">Search</h1>
<form class="search-big" action="search.html" onsubmit="return false"><input name="q" type="search" placeholder="Search names, places, events…" autocomplete="off" aria-label="Search"></form>
<p class="search-count muted small"></p><div class="search-results"></div></div>` }));
  }
  add('404.html', shell({ title: 'Not found', depth: 0, base: s.baseUrl || '', body: `<div class="empty"><span class="big">⌖</span><h1>Lost at sea</h1><p>This page isn't on any map. Try the <a href="index.html">home page</a>${has.search ? ' or <a href="search.html">search</a>' : ''}.</p></div>` }));

  /* ---------- assets, sitemap ---------- */
  files.push({ path: 'assets/site.css', data: CSS });
  files.push({ path: 'assets/site.js', data: clientJs() });
  const loc = p => esc((s.baseUrl || '') + p);
  files.push({ path: 'sitemap.xml', data: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter(p => p !== '404.html').map(p => `<url><loc>${loc(p)}</loc></url>`).join('\n')}\n</urlset>\n` });
  if (s.baseUrl) files.push({ path: 'robots.txt', data: `User-agent: *\nAllow: /\nSitemap: ${s.baseUrl}sitemap.xml\n` });

  const indexes = listed.map(t => ({ path: typeSlug.get(t.id) + '/index.html', label: t.plural, icon: t.icon, n: countOf.get(t.id) }));
  return { files, pages, indexes, counts: { pages: pages.length, entries: url.size, media: [...mediaUsed.values()].filter(Boolean).length, posts: posts.length, maps: has.maps ? countOf.get(mapType.id) || 0 : 0, families: fams.length }, urls: url };
}

/** the area-weighted centre of a polygon (falls back to the mean of its points) */
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) { let x = 0, y = 0; for (const p of pts) { x += +p[0]; y += +p[1]; } return [x / pts.length, y / pts.length]; }
  return [cx / (3 * a), cy / (3 * a)];
}
const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a / 2); };
const lum = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; return .2126 * r + .7152 * g + .0722 * b; };

/** families: connected groups (3+) over parent / spouse / sibling relations, laid out in generations */
function families(m) {
  const rels = m.relations.filter(r => r.familyRole && m.included.has(r.src) && m.included.has(r.dst));
  if (!rels.length) return [];
  const parent = new Map(), adj = new Map(), parents = new Map(), spouses = [];
  const link = (a, b) => { (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a); };
  for (const r of rels) {
    link(r.src, r.dst);
    if (r.familyRole === 'parent') (parents.get(r.dst) || parents.set(r.dst, []).get(r.dst)).push(r.src);
    if (r.familyRole === 'spouse') spouses.push([r.src, r.dst]);
  }
  const seen = new Set(), out = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [], q = [start]; seen.add(start);
    while (q.length) { const a = q.shift(); comp.push(a); for (const b of adj.get(a) || []) if (!seen.has(b)) { seen.add(b); q.push(b); } }
    if (comp.length < 3) continue;
    // generations: parents one above their children, spouses and siblings level
    const gen = new Map([[comp[0], 0]]);
    for (let pass = 0; pass < comp.length * 3; pass++) {
      let changed = false;
      for (const r of rels) {
        if (!comp.includes(r.src)) continue;
        const a = gen.get(r.src), b = gen.get(r.dst), d = r.familyRole === 'parent' ? 1 : 0;
        if (a != null && b == null) { gen.set(r.dst, a + d); changed = true; }
        else if (b != null && a == null) { gen.set(r.src, b - d); changed = true; }
      }
      if (!changed) break;
    }
    const min = Math.min(...comp.map(id => gen.get(id) || 0));
    const rows = [];
    for (const id of comp) { const g = (gen.get(id) || 0) - min; (rows[g] = rows[g] || []).push(id); }
    const gens = rows.filter(Boolean).map(row => {
      const units = [], used = new Set();
      const byBirth = row.slice().sort((a, b) => ((m.byId.get(a) || {}).start || { day: 0 }).day - ((m.byId.get(b) || {}).start || { day: 0 }).day);
      for (const id of byBirth) {
        if (used.has(id)) continue;
        used.add(id);
        const mate = spouses.filter(p => p.includes(id)).map(p => (p[0] === id ? p[1] : p[0])).find(o => row.includes(o) && !used.has(o));
        if (mate) { used.add(mate); units.push([id, mate]); } else units.push([id]);
      }
      return units;
    });
    // named after the most common surname, else the eldest
    const names = new Map();
    for (const id of comp) { const w = m.titleOf(id).trim().split(/\s+/); if (w.length > 1) { const n = w[w.length - 1]; names.set(n, (names.get(n) || 0) + 1); } }
    const top = [...names].sort((a, b) => b[1] - a[1])[0];
    const name = top && top[1] > 1 ? 'The ' + top[0] + ' family' : 'Family of ' + m.titleOf(gens[0][0][0]);
    out.push({ name, gens, parents, members: comp });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

module.exports = { render, settingsOf, accentOf, DEFAULTS, THEMES, families };
