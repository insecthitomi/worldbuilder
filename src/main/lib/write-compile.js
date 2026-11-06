'use strict';
/* Compile: a story (story → chapters → scenes) into Markdown, plain text, HTML (book typography, standard manuscript
   format or a screenplay page), RTF (opens in Word, Pages and LibreOffice) and Fountain. Pure: the Write area gathers
   the parts from the database; this file only turns them into text. Mentions become plain text and author-only
   secrets are left out unless asked for. */
const T = require('../../shared/richtext');
const SP = require('./write-script');

const DEFAULTS = {
  format: 'html',          // html | md | txt | rtf | pdf | fountain
  style: 'book',           // book | manuscript | script
  chapterHeads: 'both',    // both ("Chapter 1" + title) | words ("Chapter One" + title) | title | number | none
  sceneTitles: false,
  separator: '* * *',
  titlePage: true,
  synopsis: false,
  author: '',
  secrets: false,          // include the author's secret notes
  skipStatuses: [],        // scenes with these statuses are left out
  exclude: [],             // ids of chapters or scenes left out
  pageSize: 'A4',          // A4 | Letter
};
const STYLES = ['book', 'manuscript', 'script'];
const HEADS = ['both', 'words', 'title', 'number', 'none'];
const FORMATS = ['html', 'md', 'txt', 'rtf', 'pdf', 'fountain'];

function options(o = {}) {
  const r = Object.assign({}, DEFAULTS);
  if (FORMATS.includes(o.format)) r.format = o.format;
  if (STYLES.includes(o.style)) r.style = o.style;
  if (HEADS.includes(o.chapterHeads)) r.chapterHeads = o.chapterHeads;
  for (const k of ['sceneTitles', 'titlePage', 'synopsis', 'secrets']) if (o[k] != null) r[k] = !!o[k];
  if (o.separator != null) r.separator = String(o.separator).slice(0, 40);
  if (o.author != null) r.author = String(o.author).slice(0, 120);
  if (Array.isArray(o.skipStatuses)) r.skipStatuses = o.skipStatuses.map(String);
  if (Array.isArray(o.exclude)) r.exclude = o.exclude.map(String);
  if (o.pageSize === 'Letter' || o.pageSize === 'A4') r.pageSize = o.pageSize;
  return r;
}

/* ---------------- numbers in words ---------------- */
const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return String(n);
}

/* ---------------- the parts that make it in ---------------- */
/** doc: { story: {id, title, summary, fields, body}, parts: [{kind, id, title, summary, body, fields, children}] } */
function select(doc, o) {
  const skip = new Set(o.skipStatuses || []), ex = new Set(o.exclude || []);
  const keepScene = s => !ex.has(s.id) && !skip.has((s.fields && s.fields.status) || '');
  const out = [];
  for (const p of doc.parts || []) {
    if (ex.has(p.id)) continue;
    if (p.kind === 'scene') { if (keepScene(p)) out.push(p); continue; }
    out.push(Object.assign({}, p, { children: (p.children || []).filter(c => c.kind === 'scene' ? keepScene(c) : !ex.has(c.id)) }));
  }
  return out;
}
/** body HTML ready for output: secrets out (unless asked), mentions as plain text, images resolved or dropped */
function clean(html, o, ctx = {}) {
  let s = String(html || '');
  if (!o.secrets) s = T.stripSecrets(s);
  s = T.mapMentions(s, (id, label) => ({ text: label || (ctx.titleOf && ctx.titleOf(id)) || '' }));
  s = T.sanitize(s);
  s = s.replace(/<img data-media="([a-z0-9]+)" alt="([^"]*)">/g, (m, id, alt) => {
    const src = ctx.mediaSrc && ctx.mediaSrc(id);
    return src ? '<img src="' + T.escAttr(src) + '" alt="' + alt + '">' : '';
  });
  return s;
}
/** the heading lines for chapter n: { label, title } (either may be empty) */
function chapterHead(ch, n, mode) {
  const title = String(ch.title || '').trim();
  const generic = !title || /^(chapter|untitled)\b/i.test(title);
  switch (mode) {
    case 'none': return { label: '', title: '' };
    case 'title': return { label: '', title: title || 'Chapter ' + n };
    case 'number': return { label: 'Chapter ' + n, title: '' };
    case 'words': return generic ? { label: 'Chapter ' + numberWords(n), title: '' } : { label: 'Chapter ' + numberWords(n), title };
    default: return generic ? { label: title || 'Chapter ' + n, title: '' } : { label: 'Chapter ' + n, title };
  }
}

/** walks the selected parts: visit({type: 'chapter'|'scene'|'sep'|'chapterBody', node, n, first}) */
function walk(parts, o, visit) {
  let n = 0, prevScene = false;
  for (const p of parts) {
    if (p.kind === 'scene') {
      if (prevScene && o.separator) visit({ type: 'sep' });
      visit({ type: 'scene', node: p, first: !prevScene });
      prevScene = true;
      continue;
    }
    n++;
    visit({ type: 'chapter', node: p, n });
    prevScene = false;
    if (T.text(p.body || '')) { visit({ type: 'chapterBody', node: p }); }
    for (const c of p.children || []) {
      if (prevScene && o.separator) visit({ type: 'sep' });
      visit({ type: 'scene', node: c, first: !prevScene });
      prevScene = true;
    }
    prevScene = false;
  }
}

/* ---------------- statistics ---------------- */
function stats(doc, o) {
  const parts = select(doc, o);
  let words = 0, scenes = 0, chapters = 0;
  walk(parts, o, ev => {
    if (ev.type === 'chapter') chapters++;
    if (ev.type === 'scene') scenes++;
    if (ev.type === 'scene' || ev.type === 'chapterBody') words += T.words(T.text(clean(ev.node.body, o)));
  });
  const perPage = o.style === 'manuscript' ? 250 : o.style === 'script' ? 180 : 300;
  return { words, scenes, chapters, pages: Math.max(1, Math.ceil(words / perPage)), minutes: Math.max(1, Math.round(words / 230)) };
}

/* ---------------- Markdown & plain text ---------------- */
const mdEsc = s => String(s).replace(/^([#>*+\-=_`]|\d+\.)/, '\\$1');
function markdown(doc, o, ctx) {
  const parts = select(doc, o), st = doc.story, out = [];
  if (o.titlePage) {
    out.push('# ' + st.title);
    if (o.author) out.push('*by ' + o.author + '*');
  }
  if (o.synopsis) { const syn = synopsisText(st); if (syn) out.push(syn.split(/\n+/).map(l => '> ' + l).join('\n')); }
  walk(parts, o, ev => {
    if (ev.type === 'chapter') { const hd = chapterHead(ev.node, ev.n, o.chapterHeads); if (hd.label || hd.title) out.push('## ' + [hd.label, hd.title].filter(Boolean).join(': ')); }
    else if (ev.type === 'sep') out.push(/^[*\-_ ]+$/.test(o.separator) && o.separator.replace(/\s/g, '').length >= 3 ? o.separator : mdEsc(o.separator));
    else {
      if (ev.type === 'scene' && o.sceneTitles && ev.node.title) out.push('### ' + ev.node.title);
      const md = T.toMarkdown(clean(ev.node.body, o, ctx)).replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
      if (md) out.push(md);
    }
  });
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function plain(doc, o, ctx) {
  const parts = select(doc, o), st = doc.story, out = [];
  if (o.titlePage) { out.push(st.title.toUpperCase() + (o.author ? '\nby ' + o.author : '')); }
  if (o.synopsis) { const syn = synopsisText(st); if (syn) out.push(syn); }
  walk(parts, o, ev => {
    if (ev.type === 'chapter') { const hd = chapterHead(ev.node, ev.n, o.chapterHeads); if (hd.label || hd.title) out.push([hd.label.toUpperCase(), hd.title].filter(Boolean).join('\n')); }
    else if (ev.type === 'sep') out.push(o.separator);
    else {
      if (ev.type === 'scene' && o.sceneTitles && ev.node.title) out.push(ev.node.title);
      const t = T.text(clean(ev.node.body, o, ctx));
      if (t) out.push(t);
    }
  });
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const synopsisText = st => [st.fields && st.fields.logline, st.summary].map(x => String(x || '').trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join('\n\n');

/* ---------------- screenplay blocks ---------------- */
/** top-level blocks of cleaned HTML: [{ tag, html (outer), inner, text }] */
function blocks(html) {
  const toks = T.tokens(html), out = [];
  let depth = 0, cur = null;
  const rebuild = tk => tk.t === 'text' ? T.esc(tk.v) : tk.t === 'close' ? '</' + tk.tag + '>' : '<' + tk.tag + Object.entries(tk.a || {}).map(([k, v]) => ' ' + k + '="' + T.escAttr(v) + '"').join('') + '>';
  for (const tk of toks) {
    const isVoid = tk.t === 'open' && (tk.tag === 'br' || tk.tag === 'hr' || tk.tag === 'img');
    if (depth === 0) {
      if (tk.t === 'open' && !isVoid) { cur = { tag: tk.tag, parts: [rebuild(tk)], inner: [], text: '' }; depth = 1; continue; }
      if (isVoid && tk.tag === 'hr') { out.push({ tag: 'hr', html: '<hr>', inner: '', text: '' }); continue; }
      if (tk.t === 'text' && tk.v.trim()) out.push({ tag: 'p', html: '<p>' + T.esc(tk.v) + '</p>', inner: T.esc(tk.v), text: tk.v });
      continue;
    }
    if (tk.t === 'open' && !isVoid) depth++;
    if (tk.t === 'close') depth--;
    if (depth === 0) { cur.parts.push(rebuild(tk)); out.push({ tag: cur.tag, html: cur.parts.join(''), inner: cur.inner.join(''), text: cur.text }); cur = null; continue; }
    cur.parts.push(rebuild(tk)); cur.inner.push(rebuild(tk));
    if (tk.t === 'text') cur.text += tk.v;
    else if (tk.tag === 'br') cur.text += '\n';
  }
  return out;
}
function scriptHtml(html) {
  const bl = blocks(html);
  const kinds = SP.classifyAll(bl.map(b => (b.tag === 'p' ? b.text : '')));
  return bl.map((b, i) => {
    if (b.tag !== 'p') return b.html;
    const k = kinds[i];
    if (k === 'empty') return '';
    let inner = b.inner;
    if (k === 'heading' || k === 'character' || k === 'transition') inner = T.esc(SP.display(b.text, k));
    else if (k === 'centered') inner = T.esc(SP.display(b.text, k));
    return '<p class="sp-' + k + '">' + inner + '</p>';
  }).join('');
}

/* ---------------- HTML ---------------- */
const CSS = {
  book: (o) => `
@page { size: ${o.pageSize}; margin: 22mm 20mm 24mm; }
:root { color-scheme: light; }
html { background: #f4f1ea; }
body { margin: 0; color: #1e1b16; font: 11.5pt/1.55 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Book Antiqua', serif; text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: common-ligatures oldstyle-nums; }
main { max-width: 34em; margin: 0 auto; padding: 3.5em 2.4em 5em; background: #fffdf8; box-shadow: 0 0 0 1px #0000000d, 0 1em 3em -1.5em #0000002e; }
p { margin: 0; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }
p + p, p + ul, p + ol { text-indent: 1.5em; }
.title-page { text-align: center; padding: 22vh 0 18vh; break-after: page; }
.title-page h1 { font-size: 2.6em; font-weight: 400; letter-spacing: .04em; margin: 0 0 .4em; line-height: 1.15; }
.title-page p { text-align: center; text-indent: 0; }
.title-page .by { font-style: italic; font-size: 1.15em; color: #4a443a; }
.title-page .rule { width: 4em; height: 1px; background: #8c826f; margin: 1.6em auto; }
.synopsis { break-after: page; padding-top: 2em; }
.synopsis h2 { font-size: .85em; letter-spacing: .3em; text-transform: uppercase; font-weight: 400; text-align: center; margin: 0 0 1.6em; color: #6b6253; }
.synopsis p { text-indent: 0; margin-bottom: .8em; font-style: italic; text-align: left; }
.chapter { break-before: page; padding-top: 4.5em; }
.chapter:first-of-type { break-before: auto; }
.chapter-head { text-align: center; margin: 0 0 2.6em; }
.chapter-head .label { display: block; font-size: .78em; letter-spacing: .32em; text-transform: uppercase; color: #6b6253; }
.chapter-head .name { display: block; font-size: 1.7em; font-weight: 400; font-style: italic; margin-top: .35em; line-height: 1.2; }
.chapter-head .label:only-child { font-size: 1.05em; letter-spacing: .24em; }
.scene-title { font-size: .95em; font-weight: 600; letter-spacing: .04em; margin: 1.6em 0 .7em; text-align: left; }
.sep { text-align: center; text-indent: 0; margin: 1.3em 0; letter-spacing: .4em; color: #6b6253; break-after: avoid; }
.sep + p, .chapter-head + p, .chapter-head + .scene > p:first-child, .sep + .scene > p:first-child, .scene-title + p, h2 + p, h3 + p, h4 + p, hr + p, blockquote + p { text-indent: 0; }
.chapter-head + .scene > p:first-child::first-line, .chapter-head + p::first-line { font-variant: small-caps; letter-spacing: .04em; }
h2, h3, h4 { font-weight: 600; margin: 1.4em 0 .6em; text-align: left; font-size: 1.05em; }
blockquote { margin: .8em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
ul, ol { margin: .4em 0 .6em 1.4em; padding: 0; text-align: left; }
hr { border: 0; text-align: center; margin: 1.2em 0; height: 1em; }
hr::after { content: '\\2042'; color: #6b6253; }
aside { margin: .8em 0; padding: .5em .8em; border-left: 3px solid #b8ad97; background: #f3eee3; font-size: .95em; }
aside p { text-indent: 0; }
.wb-s, p.wb-s { background: #fff0c2; box-decoration-break: clone; }
img { max-width: 100%; display: block; margin: 1em auto; }
code { font-family: Consolas, 'Courier New', monospace; font-size: .9em; }
@media print { html { background: none; } main { max-width: none; margin: 0; padding: 0; box-shadow: none; background: none; } .title-page { padding: 32vh 0 0; } }
`,
  manuscript: (o) => `
@page { size: ${o.pageSize}; margin: 1in; }
:root { color-scheme: light; }
html { background: #ececec; }
body { margin: 0; color: #000; font: 12pt/2 'Courier New', Courier, monospace; }
main { max-width: 6.5in; margin: 0 auto; padding: 1in; background: #fff; box-shadow: 0 0 0 1px #00000014, 0 1em 3em -1.5em #00000040; box-sizing: content-box; }
p { margin: 0; text-indent: .5in; text-align: left; orphans: 2; widows: 2; }
.title-page { min-height: 8.5in; position: relative; break-after: page; line-height: 1.2; }
.title-page .contact { text-indent: 0; }
.title-page .count { position: absolute; top: 0; right: 0; text-indent: 0; }
.title-page .center { position: absolute; left: 0; right: 0; top: 3.6in; text-align: center; line-height: 2; }
.title-page .center p { text-indent: 0; text-align: center; }
.synopsis { break-after: page; }
.synopsis h2 { font: inherit; text-align: center; margin: 0 0 1em; text-transform: uppercase; }
.chapter { break-before: page; padding-top: 2.5in; }
.chapter:first-of-type { break-before: auto; }
.chapter-head { text-align: center; margin: 0 0 1em; font: inherit; }
.chapter-head span { display: block; }
.chapter-head .label { text-transform: uppercase; }
.scene-title { text-indent: 0; text-align: left; text-decoration: underline; font: inherit; margin: 0; }
.sep { text-align: center; text-indent: 0; }
h2, h3, h4 { font: inherit; margin: 0; text-align: center; text-transform: uppercase; }
blockquote { margin: 0 0 0 1in; }
ul, ol { margin: 0 0 0 1in; padding: 0; }
hr { border: 0; text-align: center; margin: 0; height: 2em; }
hr::after { content: '#'; }
em { font-style: normal; text-decoration: underline; }
strong { font-weight: 700; }
aside { margin: 0 0 0 .5in; }
.wb-s { background: #eee; }
img { max-width: 100%; display: block; margin: 1em auto; }
@media print { html { background: none; } main { max-width: none; margin: 0; padding: 0; box-shadow: none; } .title-page { min-height: 9in; } }
`,
  script: (o) => `
@page { size: ${o.pageSize}; margin: 1in 1in 1in 1.5in; }
:root { color-scheme: light; }
html { background: #ececec; }
body { margin: 0; color: #000; font: 12pt/1.15 'Courier Prime', 'Courier New', Courier, monospace; }
main { width: 6in; margin: 0 auto; padding: 1in 1in 1in 1.5in; background: #fff; box-shadow: 0 0 0 1px #00000014, 0 1em 3em -1.5em #00000040; box-sizing: content-box; }
p { margin: 0 0 1em; }
.title-page { min-height: 8.5in; position: relative; break-after: page; text-align: center; }
.title-page h1 { font: inherit; text-transform: uppercase; text-decoration: underline; margin: 3.2in 0 1em; }
.title-page .by { margin: 0; }
.chapter { break-before: page; }
.chapter:first-of-type { break-before: auto; }
.chapter-head { font: inherit; text-align: center; text-transform: uppercase; text-decoration: underline; margin: 0 0 2em; }
.chapter-head span + span::before { content: ': '; }
.scene-title { display: none; }
.sep { display: none; }
.sp-heading { text-transform: uppercase; font-weight: 700; margin-top: 1.5em; break-after: avoid; }
.sp-character { margin: 1em 0 0 2.2in; text-transform: uppercase; break-after: avoid; }
.sp-paren { margin: 0 0 0 1.6in; max-width: 2in; break-after: avoid; }
.sp-dialogue { margin: 0 0 1em 1in; max-width: 3.5in; }
.sp-character + .sp-dialogue, .sp-paren + .sp-dialogue { margin-top: 0; }
.sp-transition { text-align: right; text-transform: uppercase; margin-top: 1em; }
.sp-centered { text-align: center; }
h2, h3, h4 { font: inherit; text-transform: uppercase; text-decoration: underline; margin: 1.5em 0 1em; }
hr { border: 0; margin: 1em 0; }
.wb-s { background: #eee; }
@media print { html { background: none; } main { width: auto; margin: 0; padding: 0; box-shadow: none; } }
`,
};

function html(doc, o, ctx = {}) {
  const parts = select(doc, o), st = doc.story, e = T.esc, out = [];
  const style = o.style;
  if (o.titlePage) {
    if (style === 'manuscript') {
      const n = stats(doc, o).words, approx = n < 1000 ? Math.max(100, Math.round(n / 100) * 100) : Math.round(n / 1000) * 1000;
      out.push('<section class="title-page"><p class="contact">' + e(o.author || 'Your name') + '</p><p class="count">about ' + approx.toLocaleString('en-US') + ' words</p>' +
        '<div class="center"><p>' + e(st.title.toUpperCase()) + '</p><p>by ' + e(o.author || 'Your name') + '</p></div></section>');
    } else {
      out.push('<section class="title-page"><h1>' + e(st.title) + '</h1>' + (style === 'book' ? '<div class="rule"></div>' : '') + (o.author ? '<p class="by">' + (style === 'script' ? 'written by<br>' : 'by ') + e(o.author) + '</p>' : '') + '</section>');
    }
  }
  if (o.synopsis) { const syn = synopsisText(st); if (syn) out.push('<section class="synopsis"><h2>Synopsis</h2>' + syn.split(/\n+/).map(p => '<p>' + e(p) + '</p>').join('') + '</section>'); }
  let open = false;
  const body = h => (style === 'script' ? scriptHtml(clean(h, o, ctx)) : clean(h, o, ctx));
  walk(parts, o, ev => {
    if (ev.type === 'chapter') {
      if (open) out.push('</section>');
      const hd = chapterHead(ev.node, ev.n, o.chapterHeads);
      out.push('<section class="chapter" id="c-' + ev.node.id + '">' + (hd.label || hd.title ? '<h2 class="chapter-head">' + (hd.label ? '<span class="label">' + e(hd.label) + '</span>' : '') + (hd.title ? '<span class="name">' + e(hd.title) + '</span>' : '') + '</h2>' : ''));
      open = true;
    } else if (ev.type === 'sep') out.push('<p class="sep">' + e(style === 'manuscript' && o.separator === DEFAULTS.separator ? '#' : o.separator) + '</p>');
    else if (ev.type === 'chapterBody') out.push(body(ev.node.body));
    else out.push((o.sceneTitles && ev.node.title ? '<h3 class="scene-title">' + e(ev.node.title) + '</h3>' : '') + '<div class="scene">' + body(ev.node.body) + '</div>');
  });
  if (open) out.push('</section>');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + e(st.title) + '</title><style>' + CSS[style](o) + '</style></head><body class="' + style + '"><main>' + out.join('\n') + '</main></body></html>';
}

/* ---------------- RTF (word processors) ---------------- */
function rtfEsc(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\t') out += '\\tab ';
    else if (c < 128) out += ch;
    else if (c < 0x10000) out += '\\u' + (c > 32767 ? c - 65536 : c) + '?';
    else { const v = c - 0x10000, hi = 0xd800 + (v >> 10), lo = 0xdc00 + (v & 0x3ff); out += '\\u' + (hi - 65536) + '?\\u' + (lo - 65536) + '?'; }
  }
  return out;
}
/** RTF paragraphs from cleaned HTML; p = the paragraph format for body text */
function rtfBody(html, P, style) {
  const out = [];
  let run = [], first = true, list = [], quote = 0, inBlock = false, kind = 'p';
  const pfmt = () => {
    if (kind === 'h') return P.head;
    if (kind === 'li') return P.plain + '\\li' + (360 * (list.length + 1)) + '\\fi-360 ';
    if (quote) return P.plain + '\\li720\\ri720\\i ';
    return first ? P.first : P.body;
  };
  const flush = () => { const t = run.join(''); if (t.trim() || kind === 'li') { out.push('{\\pard' + pfmt() + t + '\\par}'); if (kind === 'p') first = false; } run = []; };
  let bullets = [];
  for (const tk of T.tokens(html)) {
    if (tk.t === 'text') { run.push(rtfEsc(tk.v)); continue; }
    const open = tk.t === 'open', tag = tk.tag;
    switch (tag) {
      case 'p': case 'aside': if (open) { run = []; kind = 'p'; inBlock = true; } else { flush(); inBlock = false; } break;
      case 'h2': case 'h3': case 'h4': if (open) { run = []; kind = 'h'; } else { flush(); kind = 'p'; first = true; } break;
      case 'strong': run.push(open ? '{\\b ' : '}'); break;
      case 'em': run.push(open ? (style === 'manuscript' ? '{\\ul ' : '{\\i ') : '}'); break;
      case 'u': run.push(open ? '{\\ul ' : '}'); break;
      case 's': run.push(open ? '{\\strike ' : '}'); break;
      case 'br': run.push('\\line '); break;
      case 'blockquote': quote += open ? 1 : -1; break;
      case 'ul': case 'ol': if (open) { list.push(tag); bullets.push(0); } else { list.pop(); bullets.pop(); } break;
      case 'li': if (open) { run = []; kind = 'li'; bullets[bullets.length - 1]++; run.push(list[list.length - 1] === 'ol' ? bullets[bullets.length - 1] + '.\\tab ' : '\\bullet\\tab '); } else { flush(); kind = 'p'; } break;
      case 'hr': if (open) { out.push('{\\pard' + P.sep + rtfEsc(P.sepText) + '\\par}'); first = true; } break;
      default: break;
    }
  }
  if (run.length && !inBlock) flush();
  return out.join('\n');
}
function rtf(doc, o, ctx) {
  const parts = select(doc, o), st = doc.story, style = o.style === 'script' ? 'manuscript' : o.style;
  const ms = style === 'manuscript';
  const font = ms ? '{\\f0\\fmodern\\fcharset0 Courier New;}' : '{\\f0\\froman\\fcharset0 Georgia;}';
  const size = ms ? 24 : 23;
  const paper = o.pageSize === 'Letter' ? '\\paperw12240\\paperh15840' : '\\paperw11906\\paperh16838';
  const P = ms
    ? { body: '\\plain\\f0\\fs24\\sl480\\slmult1\\fi720 ', first: '\\plain\\f0\\fs24\\sl480\\slmult1\\fi720 ', plain: '\\plain\\f0\\fs24\\sl480\\slmult1 ', head: '\\plain\\f0\\fs24\\sl480\\slmult1\\qc ', sep: '\\plain\\f0\\fs24\\sl480\\slmult1\\qc ', sepText: '#' }
    : { body: '\\plain\\f0\\fs23\\sl360\\slmult1\\qj\\fi340 ', first: '\\plain\\f0\\fs23\\sl360\\slmult1\\qj ', plain: '\\plain\\f0\\fs23\\sl360\\slmult1 ', head: '\\plain\\f0\\fs24\\b\\sb240\\sa120 ', sep: '\\plain\\f0\\fs23\\sl360\\slmult1\\qc\\sb120\\sa120 ', sepText: o.separator || '* * *' };
  const surname = String(o.author || '').trim().split(/\s+/).pop() || 'Author';
  const shortTitle = st.title.toUpperCase().split(/\s+/).slice(0, 4).join(' ');
  const out = ['{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl' + font + '}', paper + '\\margl1440\\margr1440\\margt1440\\margb1440\\titlepg\\viewkind1'];
  if (ms) out.push('{\\header\\pard\\plain\\f0\\fs24\\qr ' + rtfEsc(surname + ' / ' + shortTitle + ' / ') + '\\chpgn\\par}');
  else out.push('{\\footer\\pard\\plain\\f0\\fs18\\qc \\chpgn\\par}');
  if (o.titlePage) {
    if (ms) {
      const n = stats(doc, o).words, approx = n < 1000 ? Math.max(100, Math.round(n / 100) * 100) : Math.round(n / 1000) * 1000;
      out.push('{\\pard\\plain\\f0\\fs24\\tqr\\tx9360 ' + rtfEsc(o.author || 'Your name') + '\\tab ' + rtfEsc('about ' + approx.toLocaleString('en-US') + ' words') + '\\par}');
      out.push('{\\pard\\plain\\f0\\fs24\\sb4320\\qc ' + rtfEsc(st.title.toUpperCase()) + '\\par}');
      out.push('{\\pard\\plain\\f0\\fs24\\sl480\\slmult1\\qc ' + rtfEsc('by ' + (o.author || 'Your name')) + '\\par}');
    } else {
      out.push('{\\pard\\plain\\f0\\fs56\\sb3600\\qc ' + rtfEsc(st.title) + '\\par}');
      if (o.author) out.push('{\\pard\\plain\\f0\\fs28\\i\\sb480\\qc ' + rtfEsc('by ' + o.author) + '\\par}');
    }
    out.push('{\\pard\\page\\par}');
  }
  if (o.synopsis) { const syn = synopsisText(st); if (syn) { out.push('{\\pard' + P.head + '\\qc SYNOPSIS\\par}'); for (const p of syn.split(/\n+/)) out.push('{\\pard' + P.plain + rtfEsc(p) + '\\par}'); out.push('{\\pard\\page\\par}'); } }
  let chapters = 0;
  walk(parts, o, ev => {
    if (ev.type === 'chapter') {
      if (chapters++) out.push('{\\pard\\page\\par}');
      const hd = chapterHead(ev.node, ev.n, o.chapterHeads);
      if (ms) out.push('{\\pard\\plain\\f0\\fs24\\sb' + (o.titlePage || chapters > 1 ? 2880 : 0) + '\\qc ' + rtfEsc((hd.label || '').toUpperCase()) + (hd.label && hd.title ? '\\line ' : '') + rtfEsc(hd.title) + '\\par}{\\pard\\plain\\f0\\fs24\\sl480\\slmult1\\par}');
      else if (hd.label || hd.title) out.push('{\\pard\\plain\\f0\\fs20\\sb1440\\qc\\expndtw40 ' + rtfEsc((hd.label || '').toUpperCase()) + '\\par}' + (hd.title ? '{\\pard\\plain\\f0\\fs36\\i\\sb120\\sa480\\qc ' + rtfEsc(hd.title) + '\\par}' : '{\\pard\\plain\\sa480\\par}'));
    } else if (ev.type === 'sep') out.push('{\\pard' + P.sep + rtfEsc(ms ? '#' : o.separator) + '\\par}');
    else {
      if (ev.type === 'scene' && o.sceneTitles && ev.node.title) out.push('{\\pard' + P.head + rtfEsc(ev.node.title) + '\\par}');
      out.push(rtfBody(clean(ev.node.body, o, ctx), P, style));
    }
  });
  out.push('}');
  return out.join('\n');
}

/* ---------------- Fountain (screenplays as plain text) ---------------- */
function fountain(doc, o, ctx) {
  const parts = select(doc, o), st = doc.story, out = [];
  if (o.titlePage) out.push('Title: ' + st.title + (o.author ? '\nAuthor: ' + o.author : '') + '\n');
  walk(parts, o, ev => {
    if (ev.type === 'chapter') { const hd = chapterHead(ev.node, ev.n, o.chapterHeads); if (hd.label || hd.title) out.push('# ' + [hd.label, hd.title].filter(Boolean).join(': ')); }
    else if (ev.type === 'sep') return;
    else {
      const bl = blocks(clean(ev.node.body, o, ctx)).filter(b => b.tag === 'p');
      const kinds = SP.classifyAll(bl.map(b => b.text));
      let lines = [];
      bl.forEach((b, i) => {
        const k = kinds[i]; if (k === 'empty') return;
        const t = b.text.trim();
        if (k === 'dialogue' || k === 'paren') { lines.push(t); return; }
        if (lines.length) out.push(lines.join('\n'));
        lines = [];
        if (k === 'character') { lines.push(SP.display(t, k)); return; }
        out.push(k === 'heading' ? (HEADING_OK(t) ? t.toUpperCase() : '.' + t.replace(/^\./, '').toUpperCase()) : k === 'transition' ? '> ' + SP.display(t, k) : k === 'centered' ? t : t);
      });
      if (lines.length) out.push(lines.join('\n'));
    }
  });
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const HEADING_OK = t => /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i.test(t);

/** the header line printed on every PDF page: manuscript "Surname / TITLE / page", book page numbers in the foot */
function pdfFrame(st, o) {
  const surname = String(o.author || '').trim().split(/\s+/).pop() || 'Author';
  const shortTitle = T.esc(st.title.toUpperCase().split(/\s+/).slice(0, 4).join(' '));
  if (o.style === 'manuscript') return { header: `<div style="font-family:'Courier New',monospace;font-size:10pt;width:100%;text-align:right;padding:0 1in;box-sizing:border-box;">${T.esc(surname)} / ${shortTitle} / <span class="pageNumber"></span></div>`, footer: '<div></div>' };
  if (o.style === 'script') return { header: `<div style="font-family:'Courier New',monospace;font-size:10pt;width:100%;text-align:right;padding:0 1in;box-sizing:border-box;"><span class="pageNumber"></span>.</div>`, footer: '<div></div>' };
  return { header: '<div></div>', footer: `<div style="font-family:Georgia,serif;font-size:8pt;width:100%;text-align:center;color:#6b6253;"><span class="pageNumber"></span></div>` };
}

/** one call for everything: { text (in the chosen format; html for pdf), ext, mime, stats } */
function compile(doc, raw, ctx = {}) {
  const o = options(raw);
  const s = stats(doc, o);
  switch (o.format) {
    case 'md': return { text: markdown(doc, o, ctx), ext: 'md', mime: 'text/markdown', stats: s, options: o };
    case 'txt': return { text: plain(doc, o, ctx), ext: 'txt', mime: 'text/plain', stats: s, options: o };
    case 'rtf': return { text: rtf(doc, o, ctx), ext: 'rtf', mime: 'application/rtf', stats: s, options: o };
    case 'fountain': return { text: fountain(doc, o, ctx), ext: 'fountain', mime: 'text/plain', stats: s, options: o };
    case 'pdf': return { text: html(doc, o, ctx), ext: 'pdf', mime: 'application/pdf', stats: s, options: o, frame: pdfFrame(doc.story, o) };
    default: return { text: html(doc, o, ctx), ext: 'html', mime: 'text/html', stats: s, options: o };
  }
}

module.exports = { compile, options, markdown, plain, html, rtf, fountain, stats, select, clean, chapterHead, numberWords, blocks, scriptHtml, DEFAULTS };
