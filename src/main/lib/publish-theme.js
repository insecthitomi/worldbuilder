'use strict';
/* The published website's stylesheet: four themes (Parchment, Night, Clean, Codex) over one layout. Offline:
   system font stacks only, no web fonts, no CDN. The accent colour arrives as --accent on <html>. */

const THEMES = {
  parchment: { label: 'Parchment', accent: '#9a4a1f', desc: 'Warm paper, book serif, ink and sepia.' },
  night: { label: 'Night', accent: '#7aa2ff', desc: 'Deep blue dark mode with a glowing accent.' },
  clean: { label: 'Clean', accent: '#2f6fde', desc: 'White, airy and modern. Reads like a wiki.' },
  codex: { label: 'Codex', accent: '#b0442c', desc: 'A leather-bound sidebar and cream pages.' },
};

const CSS = String.raw`
:root{--accent:#9a4a1f;--maxw:72rem;--gap:1.25rem;--radius:10px;--font-body:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--font-head:var(--font-body);--font-mono:ui-monospace,'Cascadia Mono',Consolas,'Courier New',monospace}
html[data-theme=parchment]{--bg:#efe3c8;--bg2:#e6d4ae;--paper:#fbf4e3;--card:#fdf7ea;--ink:#33271a;--muted:#6d5a41;--faint:#9a876a;--line:#dcc79d;--head-bg:#33271a;--head-ink:#f7ecd4;--radius:6px;--font-body:'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif;--font-head:var(--font-body);--shadow:0 1px 0 rgba(255,255,255,.6) inset,0 10px 24px -16px rgba(70,45,15,.55)}
html[data-theme=night]{--bg:#0d1220;--bg2:#121a2c;--paper:#151d31;--card:#182139;--ink:#e8ecf6;--muted:#a3aec8;--faint:#6f7a96;--line:#27324c;--head-bg:#0a0f1b;--head-ink:#e8ecf6;--radius:14px;--shadow:0 12px 30px -18px rgba(0,0,0,.8)}
html[data-theme=clean]{--bg:#f6f7f9;--bg2:#eef0f4;--paper:#ffffff;--card:#ffffff;--ink:#1b2130;--muted:#5b6476;--faint:#8b93a3;--line:#e2e5eb;--head-bg:#ffffff;--head-ink:#1b2130;--radius:12px;--shadow:0 1px 2px rgba(20,30,50,.06),0 8px 24px -16px rgba(20,30,50,.25)}
html[data-theme=codex]{--bg:#ece2cd;--bg2:#e2d4b6;--paper:#f8f1e1;--card:#fbf6ea;--ink:#2a2018;--muted:#6b5846;--faint:#9a8670;--line:#d8c5a3;--head-bg:#2a1c15;--head-ink:#f1e4c8;--radius:4px;--font-body:Georgia,'Iowan Old Style','Palatino Linotype',serif;--font-head:'Book Antiqua','Palatino Linotype',Palatino,Georgia,serif;--shadow:0 10px 24px -18px rgba(40,20,5,.6)}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);color:var(--ink);font-family:var(--font-body);font-size:17px;line-height:1.62;-webkit-text-size-adjust:100%}
html[data-theme=parchment]{background:radial-gradient(ellipse at 20% 0%,rgba(255,250,235,.9),transparent 60%),radial-gradient(ellipse at 100% 100%,rgba(190,150,90,.25),transparent 55%),var(--bg)}
html[data-theme=night]{background:radial-gradient(ellipse at 15% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 55%),radial-gradient(ellipse at 110% 30%,rgba(120,80,200,.18),transparent 50%),var(--bg)}
body{margin:0;min-height:100vh;display:flex;flex-direction:column}
a{color:var(--accent);text-decoration-thickness:.08em;text-underline-offset:.18em}
a:hover{text-decoration-thickness:.14em}
img{max-width:100%;height:auto}
h1,h2,h3,h4{font-family:var(--font-head);line-height:1.2;margin:1.4em 0 .5em;font-weight:700}
h1{font-size:2.4rem;margin-top:.2em;letter-spacing:-.01em}
h2{font-size:1.5rem}h3{font-size:1.18rem}h4{font-size:1rem;color:var(--muted)}
html[data-theme=codex] h1,html[data-theme=codex] h2{font-variant:small-caps;letter-spacing:.02em}
code{font-family:var(--font-mono);font-size:.9em;background:color-mix(in srgb,var(--ink) 8%,transparent);padding:.05em .35em;border-radius:4px}
.wrap{width:100%;max-width:var(--maxw);margin:0 auto;padding:0 1.25rem}
.skip{position:absolute;left:-999px;top:0;background:var(--accent);color:#fff;padding:.5em 1em;z-index:10}.skip:focus{left:1em}
/* header */
.site-head{background:var(--head-bg);color:var(--head-ink);position:sticky;top:0;z-index:20;box-shadow:0 1px 0 color-mix(in srgb,var(--line) 70%,transparent)}
html[data-theme=clean] .site-head{background:color-mix(in srgb,#fff 88%,transparent);backdrop-filter:saturate(1.4) blur(10px)}
html[data-theme=night] .site-head{background:color-mix(in srgb,var(--head-bg) 85%,transparent);backdrop-filter:blur(10px)}
.head-row{display:flex;align-items:center;gap:1rem;min-height:3.6rem}
.brand{display:flex;align-items:center;gap:.6rem;color:inherit;text-decoration:none;font-family:var(--font-head);font-weight:700;font-size:1.15rem;white-space:nowrap;min-width:0}
.brand-mark{display:inline-grid;place-items:center;width:1.9rem;height:1.9rem;border-radius:50%;background:var(--accent);color:#fff;font-size:.95rem;flex:none}
.brand-name{overflow:hidden;text-overflow:ellipsis}
.site-nav{display:flex;align-items:center;gap:.15rem;flex:1;min-width:0}
.site-nav>a,.nav-explore>summary{color:inherit;text-decoration:none;padding:.4rem .7rem;border-radius:999px;font-size:.92rem;white-space:nowrap;cursor:pointer;opacity:.86}
.site-nav>a:hover,.nav-explore>summary:hover,.site-nav>a.on{opacity:1;background:color-mix(in srgb,currentColor 12%,transparent)}
.site-nav>a.on{box-shadow:inset 0 -2px 0 var(--accent)}
.nav-explore{position:relative}
.nav-explore>summary{list-style:none}.nav-explore>summary::-webkit-details-marker{display:none}
.nav-explore>summary::after{content:' ▾';font-size:.75em;opacity:.7}
.nav-menu{position:absolute;top:calc(100% + .4rem);left:0;min-width:15rem;background:var(--paper);color:var(--ink);border-radius:var(--radius);box-shadow:var(--shadow),0 0 0 1px var(--line);padding:.4rem;display:grid;gap:1px;z-index:30}
.nav-menu a{display:flex;align-items:center;gap:.6rem;padding:.45rem .6rem;border-radius:calc(var(--radius) * .7);color:inherit;text-decoration:none}
.nav-menu a:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.nav-menu .n{margin-left:auto;color:var(--faint);font-size:.82em}
.ti{display:inline-grid;place-items:center;width:1.6rem;height:1.6rem;border-radius:.45rem;color:var(--tc,var(--accent));background:color-mix(in srgb,var(--tc,var(--accent)) 16%,transparent);flex:none;font-size:.9rem;line-height:1}
.nav-toggle{display:none;margin-left:auto;background:none;border:0;color:inherit;font-size:1.4rem;cursor:pointer;padding:.3rem .5rem}
.site-search{position:relative;margin-left:auto;flex:0 1 15rem;min-width:9rem}
.site-search input{width:100%;font:inherit;font-size:.92rem;padding:.42rem .8rem .42rem 2rem;border-radius:999px;border:0;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;outline:none}
.site-search input:focus{background:color-mix(in srgb,currentColor 18%,transparent);box-shadow:0 0 0 2px var(--accent)}
.site-search::before{content:'⌕';position:absolute;left:.7rem;top:50%;transform:translateY(-52%);opacity:.6;pointer-events:none}
.search-pop{position:absolute;right:0;top:calc(100% + .45rem);width:min(26rem,92vw);background:var(--paper);color:var(--ink);border-radius:var(--radius);box-shadow:var(--shadow),0 0 0 1px var(--line);padding:.35rem;max-height:70vh;overflow:auto;z-index:40}
.search-pop a,.search-results a{display:flex;gap:.65rem;align-items:flex-start;padding:.5rem .6rem;border-radius:calc(var(--radius) * .7);color:inherit;text-decoration:none}
.search-pop a:hover,.search-pop a.sel,.search-results a:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.search-pop .r-t,.search-results .r-t{font-weight:700;display:block}
.search-pop .r-s,.search-results .r-s{font-size:.85em;color:var(--muted);display:block}
.search-pop .none{padding:.7rem;color:var(--muted);font-size:.9em}
mark{background:color-mix(in srgb,var(--accent) 28%,transparent);color:inherit;border-radius:3px;padding:0 .1em}
/* codex: the header becomes a leather sidebar */
.side-types{display:none}
@media (min-width:64rem){
  html[data-theme=codex] body{display:grid;grid-template-columns:17rem minmax(0,1fr);grid-template-rows:1fr auto}
  html[data-theme=codex] .site-head{grid-row:1/3;height:100vh;position:sticky;top:0;overflow:auto;background:linear-gradient(90deg,#24170f,#33231a 70%,#2a1c14);box-shadow:inset -6px 0 12px -6px rgba(0,0,0,.6)}
  html[data-theme=codex] .site-head .wrap{padding:1.4rem 1.1rem}
  html[data-theme=codex] .head-row{flex-direction:column;align-items:stretch;gap:1.1rem}
  html[data-theme=codex] .brand{white-space:normal;font-size:1.3rem;font-variant:small-caps;letter-spacing:.03em;border-bottom:1px solid rgba(241,228,200,.18);padding-bottom:1rem}
  html[data-theme=codex] .site-search{margin:0;flex:none}
  html[data-theme=codex] .site-nav{flex-direction:column;align-items:stretch}
  html[data-theme=codex] .site-nav>a{border-radius:4px}
  html[data-theme=codex] .site-nav>a.on{box-shadow:inset 3px 0 0 var(--accent)}
  html[data-theme=codex] .nav-explore{display:none}
  html[data-theme=codex] .side-types{display:grid;gap:1px;margin-top:.4rem;padding-top:.8rem;border-top:1px solid rgba(241,228,200,.18)}
  html[data-theme=codex] .side-types a{display:flex;gap:.55rem;align-items:center;color:inherit;text-decoration:none;padding:.32rem .5rem;border-radius:4px;opacity:.85;font-size:.92rem}
  html[data-theme=codex] .side-types a:hover,html[data-theme=codex] .side-types a.on{opacity:1;background:rgba(241,228,200,.1)}
  html[data-theme=codex] .side-types .n{margin-left:auto;opacity:.55;font-size:.8em}
  html[data-theme=codex] main{padding-top:1.4rem}
  html[data-theme=codex] .site-foot{grid-column:2}
}
/* main */
main{flex:1;padding:1.6rem 0 3rem}
.crumbs{font-size:.86rem;color:var(--muted);margin:.2rem 0 1rem;display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.crumbs a{color:inherit;text-decoration:none}.crumbs a:hover{color:var(--accent);text-decoration:underline}
.crumbs .sep{opacity:.5}
.page-title{margin:.1em 0 .25em}
.lead{font-size:1.18rem;color:var(--muted);margin:.2em 0 1em;max-width:46rem}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:.86rem}
.section-head{display:flex;align-items:baseline;gap:1rem;margin:2.2rem 0 .9rem;border-bottom:1px solid var(--line);padding-bottom:.4rem}
.section-head h2{margin:0;font-size:1.3rem}
.section-head a{margin-left:auto;font-size:.9rem;white-space:nowrap}
/* hero */
.hero{position:relative;border-radius:calc(var(--radius) * 1.4);overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 70%,#000),color-mix(in srgb,var(--accent) 35%,#1a1410));color:#fff;min-height:19rem;display:flex;align-items:flex-end;box-shadow:var(--shadow)}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.18) 35%,rgba(0,0,0,.76))}
.hero-body{position:relative;z-index:1;padding:2.2rem 2.2rem 1.9rem;max-width:48rem}
.hero h1{color:#fff;font-size:clamp(2.2rem,5vw,3.6rem);margin:0 0 .2em;text-shadow:0 2px 18px rgba(0,0,0,.45)}
.hero .tagline{font-size:1.25rem;margin:0 0 .6em;opacity:.95;font-style:italic}
.hero .summary{margin:0;opacity:.9;max-width:40rem}
.hero .asof{display:inline-block;margin-top:1rem;font-size:.82rem;padding:.25rem .7rem;border-radius:999px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px)}
/* tiles & cards */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.75rem}
.tile{display:flex;align-items:center;gap:.75rem;padding:.85rem 1rem;border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow),0 0 0 1px var(--line);color:inherit;text-decoration:none;transition:transform .15s}
.tile:hover{transform:translateY(-2px);box-shadow:var(--shadow),0 0 0 1px var(--tc,var(--accent))}
.tile .ti{width:2.3rem;height:2.3rem;font-size:1.15rem;border-radius:.6rem}
.tile b{display:block}.tile span.n{font-size:.84rem;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem}
.card{display:flex;flex-direction:column;border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow),0 0 0 1px var(--line);color:inherit;text-decoration:none;overflow:hidden;transition:transform .15s,box-shadow .15s;min-width:0}
a.card:hover{transform:translateY(-3px);box-shadow:var(--shadow),0 0 0 1px var(--tc,var(--accent))}
.card-img{aspect-ratio:16/9;background:linear-gradient(135deg,color-mix(in srgb,var(--tc,var(--accent)) 26%,var(--card)),color-mix(in srgb,var(--tc,var(--accent)) 8%,var(--card)));display:grid;place-items:center;font-size:2.4rem;color:var(--tc,var(--accent))}
.card-img img{width:100%;height:100%;object-fit:cover;display:block}
.card-body{padding:.85rem 1rem 1rem;display:flex;flex-direction:column;gap:.3rem;min-width:0}
.card-type{font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;color:var(--tc,var(--accent));font-weight:700}
.card h3{margin:0;font-size:1.08rem}
.card p{margin:0;color:var(--muted);font-size:.92rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{font-size:.8rem;color:var(--faint);margin-top:auto;padding-top:.3rem}
.filter{display:flex;gap:.6rem;align-items:center;margin:0 0 1rem;flex-wrap:wrap}
.filter input{font:inherit;padding:.45rem .8rem;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink);min-width:14rem}
.chip{font:inherit;font-size:.82rem;padding:.25rem .7rem;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:.35rem}
.chip.on{background:color-mix(in srgb,var(--tc,var(--accent)) 18%,var(--paper));border-color:var(--tc,var(--accent))}
.chip.off{opacity:.5}
/* entry */
.entry-head{margin-bottom:1.2rem;display:grid;gap:.15rem}
.entry-type{display:flex;align-items:center;gap:.5rem;font-size:.82rem;letter-spacing:.07em;text-transform:uppercase;color:var(--tc,var(--accent));font-weight:700}
.entry-head h1{margin:.15em 0 .1em}
.aka{margin:0;color:var(--muted);font-style:italic}
.dates{margin:.15em 0 0;color:var(--muted);font-size:.95rem}
.onmap{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem;margin:.55rem 0 0;font-size:.9rem;color:var(--muted)}.onmap .ti{width:1.4rem;height:1.4rem;font-size:.8rem}
.tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem}
.tag{font-size:.78rem;padding:.12rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--muted)}
.entry-grid{display:grid;grid-template-columns:minmax(0,1fr) 19rem;gap:2rem;align-items:start}
.entry-grid.solo{grid-template-columns:minmax(0,1fr)}
.prose{max-width:44rem}
.prose p{margin:0 0 1em}
.prose blockquote{margin:1em 0;padding:.2em 0 .2em 1.1em;border-left:3px solid var(--line);color:var(--muted);font-style:italic}
.prose aside{margin:1em 0;padding:.8em 1em;border-radius:var(--radius);background:color-mix(in srgb,var(--accent) 10%,transparent);border-left:3px solid var(--accent)}
.prose img{border-radius:var(--radius);display:block;margin:1em 0}
.prose hr{border:0;height:1px;background:var(--line);margin:2em 3em}
.prose pre{background:color-mix(in srgb,var(--ink) 6%,transparent);padding:.8em 1em;border-radius:var(--radius);overflow:auto;white-space:pre-wrap}
.prose table{border-collapse:collapse;margin:1em 0 1.3em;font-size:.93em;width:100%;display:block;overflow-x:auto;max-width:100%}
.prose th,.prose td{text-align:left;padding:.45em .8em;border-bottom:1px solid var(--line);vertical-align:top}
.prose th{font-family:var(--font-head);font-size:.82em;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--line)}
.prose tr:nth-child(even) td{background:color-mix(in srgb,var(--ink) 3%,transparent)}
a.mention{color:var(--ink);text-decoration:none;background:color-mix(in srgb,var(--accent) 13%,transparent);box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--accent) 55%,transparent);padding:0 .15em;border-radius:3px}
a.mention:hover{background:color-mix(in srgb,var(--accent) 26%,transparent)}
.toc{margin:0 0 1.4rem;padding:.8rem 1.1rem;border-radius:var(--radius);background:color-mix(in srgb,var(--ink) 4%,transparent);font-size:.92rem;max-width:44rem}
.toc b{display:block;font-size:.76rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem}
.toc ol{margin:0;padding-left:1.2rem}.toc .l3{margin-left:1rem;list-style:circle}
.infobox{border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow),0 0 0 1px var(--line);overflow:hidden;position:sticky;top:5rem}
.infobox-cover img{display:block;width:100%;max-height:22rem;object-fit:cover}
.infobox-title{padding:.65rem 1rem;background:color-mix(in srgb,var(--tc,var(--accent)) 16%,transparent);font-family:var(--font-head);font-weight:700;text-align:center}
.infobox dl{margin:0;padding:.4rem 1rem .8rem}
.infobox dt{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:.65rem}
.infobox dd{margin:.1rem 0 0;font-size:.95rem}
.infobox dd p{margin:0 0 .4em}
.infobox .group{margin:.9rem 0 0;padding-top:.5rem;border-top:1px solid var(--line);font-weight:700;font-size:.82rem;color:var(--tc,var(--accent))}
.vals{margin:0;padding-left:1.1rem}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(3.6rem,1fr));gap:.3rem}
.stat{text-align:center;padding:.25rem;border-radius:6px;background:color-mix(in srgb,var(--ink) 6%,transparent)}
.stat span{display:block;font-size:.68rem;text-transform:uppercase;color:var(--muted)}.stat b{font-size:1rem}
.stars{color:#d9a21b;letter-spacing:.05em}.stars .off{opacity:.25}
.meter{display:inline-block;width:6rem;height:.45rem;border-radius:999px;background:color-mix(in srgb,var(--ink) 12%,transparent);vertical-align:middle;overflow:hidden}.meter i{display:block;height:100%;background:var(--accent)}
.swatch{display:inline-block;width:.9em;height:.9em;border-radius:3px;vertical-align:-.1em;box-shadow:0 0 0 1px rgba(0,0,0,.2)}
.rels{display:grid;gap:.5rem;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))}
.rel{display:flex;gap:.6rem;align-items:center;padding:.55rem .75rem;border-radius:var(--radius);background:var(--card);box-shadow:0 0 0 1px var(--line);min-width:0}
.rel .lbl{font-size:.8rem;color:var(--muted);display:block}.rel a,.rel .t{font-weight:700;text-decoration:none}
.rel .when{font-size:.78rem;color:var(--faint);display:block}
.backlinks{margin-top:2.4rem;padding-top:1rem;border-top:1px solid var(--line)}
.backlinks h2{font-size:.85rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 .6rem}
.pills{display:flex;flex-wrap:wrap;gap:.4rem}
.pill{display:inline-flex;align-items:center;gap:.4rem;padding:.2rem .7rem .2rem .3rem;border-radius:999px;background:var(--card);box-shadow:0 0 0 1px var(--line);color:inherit;text-decoration:none;font-size:.9rem}
.pill:hover{box-shadow:0 0 0 1px var(--tc,var(--accent))}
.pill .ti{width:1.4rem;height:1.4rem;font-size:.8rem;border-radius:50%}
.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:2.4rem;padding-top:1rem;border-top:1px solid var(--line)}
.pager a{text-decoration:none;max-width:48%}.pager small{display:block;color:var(--muted)}
/* maps */
.map{margin:1.2rem 0 1.6rem}
.map-viewer{position:relative;border-radius:var(--radius);overflow:hidden;background:#1d1a14;box-shadow:var(--shadow),0 0 0 1px var(--line);touch-action:none;cursor:grab;max-height:78vh}
.map-viewer.drag{cursor:grabbing}
.map-stage{position:relative;transform-origin:0 0;will-change:transform}
.map-img{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;pointer-events:none}
.map-blank{width:100%;background:repeating-linear-gradient(0deg,transparent 0 39px,rgba(120,90,50,.18) 39px 40px),repeating-linear-gradient(90deg,transparent 0 39px,rgba(120,90,50,.18) 39px 40px),#e9dbb9}
.map-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.map-svg .region{pointer-events:auto;cursor:pointer;vector-effect:non-scaling-stroke;stroke-width:2}
.map-svg .route{fill:none;vector-effect:non-scaling-stroke;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.map-svg text{font-family:var(--font-head);font-weight:700;paint-order:stroke;stroke-linejoin:round}
.map-svg .region-name{fill:#fff;stroke:rgba(0,0,0,.55);stroke-width:3px;letter-spacing:.06em;opacity:.92}
.map-svg .map-label{font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-weight:600}
.pin{position:absolute;transform:translate(-50%,-100%) scale(calc(var(--ik,1) * var(--ps,1)));transform-origin:50% 100%;display:flex;flex-direction:column;align-items:center;text-decoration:none;color:#fff;z-index:2}
.pin-dot{display:grid;place-items:center;width:1.9rem;height:1.9rem;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--pc,var(--accent));box-shadow:0 2px 8px rgba(0,0,0,.5),inset 0 0 0 2px rgba(255,255,255,.75)}
.pin-dot span{transform:rotate(45deg);font-size:.85rem;line-height:1}
.pin-dot svg{width:1.05rem;height:1.05rem;transform:rotate(45deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}
.pin-label{margin-top:.25rem;font-size:.74rem;font-weight:700;white-space:nowrap;padding:.05rem .4rem;border-radius:999px;background:rgba(0,0,0,.6)}
.pin:hover .pin-dot,.pin.sel .pin-dot{box-shadow:0 0 0 3px var(--paper),0 0 0 5px var(--pc,var(--accent))}
.map-tools{position:absolute;right:.6rem;top:.6rem;display:grid;gap:.3rem;z-index:5}
.map-tools button{width:2.1rem;height:2.1rem;border-radius:8px;border:0;background:rgba(20,16,10,.72);color:#fff;font-size:1.05rem;cursor:pointer;backdrop-filter:blur(6px)}
.map-tools button:hover{background:var(--accent)}
.map-pop{position:absolute;z-index:6;width:min(17rem,80%);background:var(--paper);color:var(--ink);border-radius:var(--radius);box-shadow:0 12px 30px rgba(0,0,0,.45);padding:.8rem .9rem;transform:translate(-50%,calc(-100% - .6rem));cursor:auto}
.map-pop.below{transform:translate(-50%,.6rem)}
.map-pop h4{margin:0 0 .25rem;color:var(--ink);font-size:1rem}
.map-pop p{margin:0 0 .5rem;font-size:.88rem;color:var(--muted)}
.map-pop .x{position:absolute;right:.4rem;top:.25rem;border:0;background:none;color:var(--muted);cursor:pointer;font-size:1rem}
.map-legend{display:flex;flex-wrap:wrap;gap:.35rem .5rem;margin-top:.7rem;font-size:.88rem}
.map-legend button{font:inherit;font-size:.85rem;border:0;background:var(--card);box-shadow:0 0 0 1px var(--line);border-radius:999px;padding:.2rem .65rem .2rem .35rem;cursor:pointer;color:var(--ink);display:inline-flex;gap:.35rem;align-items:center}
.map-legend .d{width:.7rem;height:.7rem;border-radius:50%;background:var(--pc,var(--accent))}
.map-note{font-size:.84rem;color:var(--muted);margin-top:.4rem}
/* chronology */
.chron{list-style:none;margin:0;padding:0;position:relative}
.chron::before{content:'';position:absolute;left:7.6rem;top:0;bottom:0;width:2px;background:var(--line)}
.chron-era{margin:2rem 0 .6rem 9rem;font-family:var(--font-head);font-size:1.25rem;font-weight:700;color:var(--accent)}
.chron-year{margin:1.3rem 0 .3rem;display:flex;align-items:center}
.chron-year span{width:7.6rem;text-align:right;padding-right:1rem;font-weight:700;font-family:var(--font-head);font-size:1.1rem}
.chron-item{display:grid;grid-template-columns:7.6rem 1fr;gap:0;align-items:start;margin:.15rem 0}
.chron-item .when{text-align:right;padding:.55rem 1rem 0 0;font-size:.82rem;color:var(--muted)}
.chron-item .what{position:relative;margin-left:1.2rem;padding:.5rem .8rem;border-radius:var(--radius);background:var(--card);box-shadow:0 0 0 1px var(--line)}
.chron-item .what::before{content:'';position:absolute;left:-1.62rem;top:.95rem;width:.75rem;height:.75rem;border-radius:50%;background:var(--tc,var(--accent));box-shadow:0 0 0 3px var(--bg)}
.chron-item .what b a{text-decoration:none;color:var(--ink)}.chron-item .what b a:hover{color:var(--accent)}
.chron-item .k{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--tc,var(--accent));font-weight:700;margin-right:.4rem}
.chron-item p{margin:.2rem 0 0;font-size:.9rem;color:var(--muted)}
.chron-now{display:grid;grid-template-columns:7.6rem 1fr;margin:1rem 0;align-items:center}
.chron-now span{text-align:right;padding-right:1rem;font-weight:700;color:var(--accent);font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}
.chron-now i{display:block;height:2px;background:var(--accent);margin-left:-.1rem;box-shadow:0 0 10px var(--accent)}
.chron-item[hidden],.chron-year[hidden]{display:none}
/* family */
.family{margin:1.5rem 0 2.5rem;padding:1rem 1.2rem 1.4rem;border-radius:calc(var(--radius) * 1.2);background:color-mix(in srgb,var(--ink) 3%,transparent);box-shadow:0 0 0 1px var(--line)}
.family h2{margin-top:.2rem}
.gen{display:grid;grid-template-columns:3rem 1fr;gap:.8rem;align-items:start;padding:.8rem 0;border-top:1px dashed var(--line)}
.gen:first-of-type{border-top:0}
.gen-n{font-family:var(--font-head);font-weight:700;color:var(--faint);text-align:center;font-size:1.2rem;padding-top:.6rem}
.gen-row{display:flex;flex-wrap:wrap;gap:.7rem}
.couple{display:flex;align-items:center;gap:.35rem;padding:.3rem;border-radius:calc(var(--radius) * 1.1);background:color-mix(in srgb,var(--accent) 7%,transparent)}
.couple .ring{color:var(--accent);font-size:1.1rem}
.person{display:flex;gap:.55rem;align-items:center;padding:.45rem .7rem .45rem .45rem;border-radius:var(--radius);background:var(--card);box-shadow:0 0 0 1px var(--line);color:inherit;text-decoration:none;min-width:11rem}
.person img,.person .ph{width:2.4rem;height:2.4rem;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;background:color-mix(in srgb,var(--tc,var(--accent)) 18%,transparent);color:var(--tc,var(--accent))}
.person b{display:block;font-size:.95rem}.person small{display:block;color:var(--muted);font-size:.78rem}
a.person:hover{box-shadow:0 0 0 1px var(--accent)}
/* devlog & shop */
.posts{display:grid;gap:1.1rem;max-width:48rem}
.post-card{display:grid;grid-template-columns:auto 1fr;gap:1.2rem;padding:1.1rem 1.2rem;border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow),0 0 0 1px var(--line)}
.post-card .cover{width:9rem;aspect-ratio:4/3;border-radius:calc(var(--radius) * .8);overflow:hidden;background:color-mix(in srgb,var(--accent) 15%,transparent)}
.post-card .cover img{width:100%;height:100%;object-fit:cover;display:block}
.post-card.nocover{grid-template-columns:1fr}
.post-card h3{margin:.1rem 0 .3rem;font-size:1.25rem}.post-card h3 a{color:var(--ink);text-decoration:none}.post-card h3 a:hover{color:var(--accent)}
.post-card p{margin:0 0 .5rem;color:var(--muted)}
.post-date{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);font-weight:700}
.badge{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:.15rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);vertical-align:middle}
.badge.dim{background:color-mix(in srgb,var(--ink) 9%,transparent);color:var(--muted)}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:1.2rem}
.product{display:flex;flex-direction:column;border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow),0 0 0 1px var(--line);overflow:hidden}
.product .card-img{aspect-ratio:4/3}.product .card-img.short{aspect-ratio:auto;height:4.5rem;font-size:1.8rem}
.product .body{padding:1rem 1.1rem 1.2rem;display:flex;flex-direction:column;gap:.45rem;flex:1}
.product h3{margin:0;font-size:1.2rem}.product h3 a{color:var(--ink);text-decoration:none}
.price{font-size:1.25rem;font-weight:800;font-family:var(--font-head)}
.product .blurb{color:var(--muted);font-size:.93rem}.product .blurb p{margin:0 0 .5em}
.product .actions{margin-top:auto;display:flex;gap:.5rem;align-items:center;padding-top:.4rem}
.btn{display:inline-flex;align-items:center;gap:.4rem;font:inherit;font-weight:700;font-size:.92rem;padding:.55rem 1.1rem;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;border:0;cursor:pointer;box-shadow:0 6px 16px -8px var(--accent)}
.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 1.5px var(--accent)}
.buybox{margin:0 0 1.4rem;padding:1rem 1.2rem;border-radius:var(--radius);background:color-mix(in srgb,var(--accent) 8%,var(--card));box-shadow:0 0 0 1px var(--line);display:flex;flex-wrap:wrap;gap:1rem;align-items:center}
.reviews{display:grid;grid-template-columns:repeat(auto-fill,minmax(18rem,1fr));gap:1rem}
.review{margin:0;padding:1.1rem 1.2rem;border-radius:var(--radius);background:var(--card);box-shadow:0 0 0 1px var(--line);position:relative}
.review::before{content:'“';position:absolute;right:.8rem;top:-.3rem;font-size:3.4rem;color:color-mix(in srgb,var(--accent) 35%,transparent);font-family:Georgia,serif}
.review p{margin:.3rem 0 .6rem;font-style:italic}
.review footer{font-size:.85rem;color:var(--muted)}
/* a–z & search page */
.az-letters{display:flex;flex-wrap:wrap;gap:.3rem;margin:0 0 1.2rem}
.az-letters a{display:inline-grid;place-items:center;min-width:2rem;height:2rem;border-radius:6px;background:var(--card);box-shadow:0 0 0 1px var(--line);text-decoration:none;font-weight:700}
.az h2{border-bottom:1px solid var(--line);padding-bottom:.2rem}
.az ul{columns:16rem;margin:0;padding:0;list-style:none}
.az li{break-inside:avoid;padding:.2rem 0;display:flex;gap:.5rem;align-items:center}
.az li a{text-decoration:none}
.search-results{display:grid;gap:.3rem;max-width:46rem}
.search-big{display:flex;gap:.6rem;margin:0 0 1.2rem;max-width:46rem}
.search-big input{flex:1;font:inherit;font-size:1.1rem;padding:.65rem 1rem;border-radius:var(--radius);border:1px solid var(--line);background:var(--paper);color:var(--ink)}
.empty{padding:3rem 1rem;text-align:center;color:var(--muted)}
.empty .big{font-size:3rem;opacity:.5;display:block}
/* footer */
.site-foot{border-top:1px solid var(--line);padding:1.6rem 0 2.2rem;color:var(--muted);font-size:.86rem;background:color-mix(in srgb,var(--ink) 3%,transparent)}
.foot-row{display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;align-items:center}
.foot-row .grow{flex:1;min-width:12rem}
.foot-row a{color:inherit}
/* small screens */
@media (max-width:52rem){
  html{font-size:16px}
  .entry-grid{grid-template-columns:minmax(0,1fr)}
  .infobox{position:static;order:-1}
  .nav-toggle{display:block}
  .head-row{flex-wrap:wrap;padding:.4rem 0}
  .site-nav{display:none;flex-basis:100%;flex-direction:column;align-items:stretch;padding-bottom:.6rem}
  .site-nav.open{display:flex}
  .nav-menu{position:static;box-shadow:none;background:transparent;color:inherit}
  .site-search{flex-basis:100%;order:3;margin:0 0 .6rem}
  .hero-body{padding:1.4rem}
  .chron::before{left:4.6rem}.chron-item,.chron-now{grid-template-columns:4.6rem 1fr}.chron-year span{width:4.6rem}.chron-era{margin-left:5.6rem}
  .post-card{grid-template-columns:1fr}.post-card .cover{width:100%}
  .gen{grid-template-columns:1fr}.gen-n{text-align:left;padding:0}
}
@media print{
  .site-head,.site-foot,.map-tools,.nav-toggle{display:none!important}
  html,body{background:#fff;color:#000}
  .card,.infobox,.rel,.pill{box-shadow:0 0 0 1px #ccc}
  a{color:inherit}
}
`;

module.exports = { CSS, THEMES };
