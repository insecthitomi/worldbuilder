/* Rich text: a small HTML subset, sanitized without a DOM (it runs in the main process too).
   Mentions <a class="wb-m" data-id="ID">, secrets <span class="wb-s"> / <p class="wb-s">, notes <aside class="wb-note">,
   images <img data-media="ID">. Also plain text, word counts, mention ids, Markdown in and out. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ID = /^[a-z0-9]{6,32}$/;
  const VOID = new Set(['br', 'hr', 'img']);
  const BLOCK = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'aside', 'hr', 'br', 'table', 'tr', 'td', 'th']);
  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'head', 'title', 'meta', 'link', 'noscript', 'svg', 'math', 'canvas', 'video', 'audio', 'select', 'textarea', 'button', 'input', 'colgroup', 'caption']);
  const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', h1: 'h2', h5: 'h4', h6: 'h4', section: 'p', article: 'p', header: 'p', footer: 'p', tt: 'code', tfoot: 'tbody' };
  const PLAIN = new Set(['h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'u', 's', 'code', 'pre', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
  const CELL = new Set(['td', 'th']);

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', middot: '·', bull: '•' };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      const v = ENT[e.toLowerCase()]; return v == null ? m : v;
    });
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => esc(s).replace(/"/g, '&quot;');

  function attrs(src) {
    const out = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
    return out;
  }
  const classes = a => String(a.class || '').split(/\s+/).filter(Boolean);
  const safeHref = h => { h = String(h || '').trim(); return /^(https?:\/\/|mailto:)/i.test(h) ? h : null; };

  /** tokens: { t: 'text', v } | { t: 'open', tag, a, self } | { t: 'close', tag } */
  function tokens(html) {
    const out = [], s = String(html || '');
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { out.push({ t: 'text', v: decode(s.slice(i)) }); break; }
      if (lt > i) out.push({ t: 'text', v: decode(s.slice(i, lt)) });
      if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(s.slice(lt));
      if (!m) { out.push({ t: 'text', v: '<' }); i = lt + 1; continue; }
      const tag = m[2].toLowerCase();
      if (m[1]) out.push({ t: 'close', tag });
      else out.push({ t: 'open', tag, a: attrs(m[3]), self: /\/\s*$/.test(m[3]) });
      i = lt + m[0].length;
    }
    return out;
  }

  /** the stored form: only the allowed subset survives; unknown tags unwrap, dangerous ones drop with their content */
  function sanitize(html) {
    const toks = tokens(html), out = [], stack = [];
    let drop = 0;
    const close = (tag) => { const k = stack.lastIndexOf(tag); if (k < 0) return; while (stack.length > k) out.push('</' + stack.pop() + '>'); };
    for (const tk of toks) {
      if (tk.t === 'text') { if (!drop) out.push(esc(tk.v)); continue; }
      let tag = tk.tag;
      if (DROP.has(tag)) { if (tk.t === 'open' && !tk.self && !VOID.has(tag)) drop++; else if (tk.t === 'close' && drop) drop--; continue; }
      if (drop) continue;
      tag = RENAME[tag] || tag;
      if (tk.t === 'close') {
        if (tag === 'a' || tag === 'span' || tag === 'aside' || PLAIN.has(tag) || tag === 'p') close(tag);
        continue;
      }
      const a = tk.a || {}, cls = classes(a);
      let open = null;
      if (tag === 'p') open = cls.includes('wb-s') ? '<p class="wb-s">' : '<p>';
      else if (PLAIN.has(tag)) open = '<' + tag + '>';
      else if (tag === 'a') {
        const id = a['data-id'];
        if (cls.includes('wb-m') && ID.test(id || '')) open = '<a class="wb-m" data-id="' + id + '">';
        else { const href = safeHref(a.href); if (href) open = '<a href="' + escAttr(href) + '">'; }
      }
      else if (tag === 'span') { if (cls.includes('wb-s')) open = '<span class="wb-s">'; }
      else if (tag === 'aside') open = '<aside class="wb-note">';
      else if (tag === 'img') { const id = a['data-media']; if (ID.test(id || '')) out.push('<img data-media="' + id + '" alt="' + escAttr(a.alt || '') + '">'); continue; }
      if (!open) continue;   // unknown tag: unwrap (its text stays)
      if (VOID.has(tag)) { out.push(open); continue; }
      // a block inside a paragraph ends the paragraph (browsers do the same), except inside a table cell
      const cellAt = Math.max(stack.lastIndexOf('td'), stack.lastIndexOf('th'));
      if (BLOCK.has(tag) && tag !== 'li' && !CELL.has(tag) && tag !== 'tr' && stack.lastIndexOf('p') > cellAt) close('p');
      if (tag === 'li') { const k = stack.lastIndexOf('li'), l = Math.max(stack.lastIndexOf('ul'), stack.lastIndexOf('ol')); if (k > l) close('li'); }
      // table structure: a row closes the open row, a cell closes the open cell; cells and rows need their parents
      if (tag === 'tr') { if (!stack.includes('table')) continue; const k = stack.lastIndexOf('tr'); if (k > stack.lastIndexOf('table')) close('tr'); }
      if (CELL.has(tag)) { if (!stack.includes('tr')) continue; if (cellAt > stack.lastIndexOf('tr')) close(stack[cellAt]); }
      if ((tag === 'tbody' || tag === 'thead') && !stack.includes('table')) continue;
      out.push(open); stack.push(tag);
    }
    while (stack.length) out.push('</' + stack.pop() + '>');
    return out.join('').replace(/<p><\/p>/g, '').trim();
  }

  /** removes secret spans and paragraphs (with nesting), for anyone but the author */
  function stripSecrets(html) {
    const toks = tokens(html), out = [];
    let depth = 0, inSecret = 0;
    const stack = [];
    for (const tk of toks) {
      if (tk.t === 'open' && !VOID.has(tk.tag) && !tk.self) {
        const secret = (tk.tag === 'span' || tk.tag === 'p') && classes(tk.a || {}).includes('wb-s');
        stack.push(secret);
        if (secret) inSecret++;
        if (!inSecret) out.push(rebuild(tk));
        depth++;
        continue;
      }
      if (tk.t === 'close') {
        const secret = stack.pop();
        if (!inSecret) out.push('</' + tk.tag + '>');
        if (secret) inSecret--;
        depth--;
        continue;
      }
      if (!inSecret) out.push(tk.t === 'text' ? esc(tk.v) : rebuild(tk));
    }
    return out.join('');
  }
  function rebuild(tk) {
    const a = Object.entries(tk.a || {}).map(([k, v]) => ' ' + k + '="' + escAttr(v) + '"').join('');
    return '<' + tk.tag + a + '>';
  }

  /** plain text with paragraph breaks (search index, word counts, summaries) */
  function text(html, { secrets = true } = {}) {
    const src = secrets ? html : stripSecrets(html);
    const parts = [];
    for (const tk of tokens(src)) {
      if (tk.t === 'text') parts.push(tk.v);
      else if (BLOCK.has(tk.tag) || tk.tag === 'li') parts.push('\n');
      else if (tk.tag === 'img' && tk.t === 'open') parts.push(' ');
    }
    return parts.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
  const words = s => (String(s || '').match(WORD) || []).length;
  function mentions(html) {
    const ids = new Set();
    for (const tk of tokens(html)) if (tk.t === 'open' && tk.tag === 'a' && classes(tk.a).includes('wb-m') && ID.test(tk.a['data-id'] || '')) ids.add(tk.a['data-id']);
    return [...ids];
  }
  function media(html) {
    const ids = new Set();
    for (const tk of tokens(html)) if (tk.t === 'open' && tk.tag === 'img' && ID.test((tk.a || {})['data-media'] || '')) ids.add(tk.a['data-media']);
    return [...ids];
  }
  /** rewrites mentions: fn(id, label) → { href } (link) | { text } (plain) | null (keep) */
  function mapMentions(html, fn) {
    const toks = tokens(html), out = [];
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t === 'open' && tk.tag === 'a' && classes(tk.a).includes('wb-m')) {
        let j = i + 1, label = '';
        while (j < toks.length && !(toks[j].t === 'close' && toks[j].tag === 'a')) { if (toks[j].t === 'text') label += toks[j].v; j++; }
        const r = fn(tk.a['data-id'], label);
        if (!r) { out.push(rebuild(tk), esc(label), '</a>'); }
        else if (r.href) out.push('<a href="' + escAttr(r.href) + '"' + (r.cls ? ' class="' + escAttr(r.cls) + '"' : '') + '>' + esc(r.label != null ? r.label : label) + '</a>');
        else out.push(esc(r.text != null ? r.text : label));
        i = j;
        continue;
      }
      out.push(tk.t === 'text' ? esc(tk.v) : tk.t === 'close' ? '</' + tk.tag + '>' : rebuild(tk));
    }
    return out.join('');
  }

  /* ---- Markdown ---- */
  /** opts.link(id, label) → markdown for a mention (default [[label]]) */
  function toMarkdown(html, opts = {}) {
    const link = opts.link || ((id, label) => '[[' + label + ']]');
    const toks = tokens(sanitize(html));
    let out = '', list = [], line = '';
    const flush = (sep = '\n\n') => { if (line.trim() || line.startsWith('    ')) out += line.replace(/[ \t]+$/g, '') + sep; line = ''; };
    let quote = 0, pre = false, aHref = null, aId = null, aLabel = '';
    let table = null, row = null, cell = null;   // tables become pipe tables
    const put = s => { if (cell != null) cell += s; else line += s; };
    for (const tk of toks) {
      if (tk.t === 'text') { if (aId != null || aHref != null) aLabel += tk.v; else put(pre ? tk.v : tk.v.replace(/\n/g, ' ')); continue; }
      const open = tk.t === 'open', tag = tk.tag;
      if (tag === 'a') {
        if (open) { aId = (tk.a || {})['data-id'] || null; aHref = aId ? null : (tk.a || {}).href || null; aLabel = ''; }
        else { put(aId ? link(aId, aLabel) : aHref ? '[' + aLabel + '](' + aHref + ')' : aLabel); aId = aHref = null; }
        continue;
      }
      if (tag === 'table') {
        if (open) { flush(); table = []; }
        else if (table) {
          const cols = Math.max(1, ...table.map(r => r.length));
          const fmt = r => '| ' + Array.from({ length: cols }, (_, i) => (r[i] || '').replace(/\|/g, '\\|').trim()).join(' | ') + ' |';
          if (table.length) out += fmt(table[0]) + '\n|' + ' --- |'.repeat(cols) + '\n' + table.slice(1).map(fmt).join('\n') + (table.length > 1 ? '\n' : '') + '\n';
          table = null;
        }
        continue;
      }
      if (table) {
        if (tag === 'tr') { if (open) row = []; else if (row) { table.push(row); row = null; } continue; }
        if (tag === 'td' || tag === 'th') { if (open) cell = ''; else if (row && cell != null) { row.push(cell.replace(/\s+/g, ' ')); cell = null; } continue; }
        if (tag === 'thead' || tag === 'tbody') continue;
        if (cell != null) { if (tag === 'strong') cell += '**'; else if (tag === 'em') cell += '*'; else if (tag === 'br') cell += ' '; continue; }
      }
      const prefix = () => '> '.repeat(quote);
      switch (tag) {
        case 'p': case 'aside': if (open) line = prefix() + (tag === 'aside' ? '> ' : ''); else flush(); break;
        case 'h2': case 'h3': case 'h4': if (open) line = prefix() + '#'.repeat(+tag[1]) + ' '; else flush(); break;
        case 'strong': line += '**'; break;
        case 'em': line += '*'; break;
        case 's': line += '~~'; break;
        case 'u': break;
        case 'code': if (!pre) line += '`'; break;
        case 'pre': if (open) { pre = true; line = '```\n'; } else { pre = false; line = line.replace(/`$/, '') + '\n```'; flush(); } break;
        case 'blockquote': quote += open ? 1 : -1; break;
        case 'ul': case 'ol': if (open) list.push({ ol: tag === 'ol', n: 0 }); else { list.pop(); if (!list.length) out += '\n'; } break;
        case 'li': if (open) { const l = list[list.length - 1] || { ol: false, n: 0 }; l.n++; line = '  '.repeat(Math.max(0, list.length - 1)) + (l.ol ? l.n + '. ' : '- '); } else flush('\n'); break;
        case 'br': line += '  \n'; break;
        case 'hr': flush(); out += '---\n\n'; break;
        case 'img': line += '![' + ((tk.a || {}).alt || '') + '](media:' + ((tk.a || {})['data-media'] || '') + ')'; break;
        case 'span': break;
      }
    }
    flush();
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  const inlineMd = (s, resolve) => esc(s)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => { const id = resolve && resolve(target.trim()); return id ? '<a class="wb-m" data-id="' + id + '">' + (label || target).trim() + '</a>' : (label || target); })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  /** resolve(title) → entry id or null, for [[wikilinks]] */
  function fromMarkdown(md, resolve) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n'), out = [];
    let para = [], list = null, quote = [], code = null;
    const endPara = () => { if (para.length) { out.push('<p>' + inlineMd(para.join(' '), resolve) + '</p>'); para = []; } };
    const endList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.map(x => '<li>' + inlineMd(x, resolve) + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
    const endQuote = () => { if (quote.length) { out.push('<blockquote>' + fromMarkdown(quote.join('\n'), resolve) + '</blockquote>'); quote = []; } };
    const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      if (code) { if (/^```/.test(raw)) { out.push('<pre>' + esc(code.join('\n')) + '</pre>'); code = null; } else code.push(raw); continue; }
      // pipe tables: a header row, a --- separator, then rows
      if (/^\s*\|.*\|\s*$/.test(raw) && /^\s*\|?\s*:?-{3,}/.test(lines[li + 1] || '')) {
        endPara(); endList(); endQuote();
        const head = cells(raw), body = [];
        li += 2;
        while (li < lines.length && /^\s*\|.*\|\s*$/.test(lines[li])) body.push(cells(lines[li++]));
        li--;
        out.push('<table><thead><tr>' + head.map(c => '<th>' + inlineMd(c, resolve) + '</th>').join('') + '</tr></thead><tbody>' + body.map(r => '<tr>' + head.map((x, i) => '<td>' + inlineMd(r[i] || '', resolve) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      if (/^```/.test(raw)) { endPara(); endList(); endQuote(); code = []; continue; }
      const line = raw.replace(/\s+$/, '');
      let m;
      if (/^>\s?/.test(line)) { endPara(); endList(); quote.push(line.replace(/^>\s?/, '')); continue; } else endQuote();
      if (!line.trim()) { endPara(); endList(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { endPara(); endList(); const n = Math.min(4, Math.max(2, m[1].length + (m[1].length === 1 ? 1 : 0))); out.push('<h' + n + '>' + inlineMd(m[2], resolve) + '</h' + n + '>'); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { endPara(); endList(); out.push('<hr>'); continue; }
      if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) { endPara(); const tag = /\d/.test(m[1]) ? 'ol' : 'ul'; if (!list || list.tag !== tag) { endList(); list = { tag, items: [] }; } list.items.push(m[2]); continue; }
      endList(); para.push(line.trim());
    }
    if (code) out.push('<pre>' + esc(code.join('\n')) + '</pre>');
    endPara(); endList(); endQuote();
    return sanitize(out.join(''));
  }
  /** plain text to paragraphs */
  const fromText = s => String(s || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

  return { sanitize, stripSecrets, text, words, mentions, media, mapMentions, toMarkdown, fromMarkdown, fromText, esc, escAttr, decode, tokens, ID };
});
