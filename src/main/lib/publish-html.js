'use strict';
/* HTML pieces shared by the website, the PDF world bible and handouts: escaping, slugs, entry text with mentions
   turned into links (or plain text when the reader may not see the target), images, field values. */
const T = require('../../shared/richtext');
const F = require('../../shared/fields');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attr = esc;

/** url-safe slug with hyphens (diacritics folded) */
function slug(s, max = 64) {
  const v = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return v || 'entry';
}
/** a slug not yet in `used` (Set), adding it */
function uniqueSlug(base, used) {
  let s = base, n = 2;
  while (used.has(s)) s = base + '-' + n++;
  used.add(s);
  return s;
}

/**
 * the body of an entry for a reader: secrets are already out (model), mentions become links to pages that exist,
 * plain text otherwise; images point at copied media or are dropped.
 * o: { href(id) → url | null, media(id) → { src, alt? } | null, headingIds: bool, onImage(id) }
 */
function bodyHtml(html, o = {}) {
  let out = T.mapMentions(html || '', (id, label) => {
    const h = o.href ? o.href(id) : null;
    return h ? { href: h, cls: 'mention' } : { text: label };
  });
  out = out.replace(/<img\b([^>]*)>/g, (m, a) => {
    const id = (/data-media="([a-z0-9]+)"/.exec(a) || [])[1], alt = (/alt="([^"]*)"/.exec(a) || [])[1] || '';
    const md = id && o.media ? o.media(id) : null;
    return md ? '<img src="' + attr(md.src) + '" alt="' + alt + '" loading="lazy">' : '';
  });
  // external links open outside the site
  out = out.replace(/<a href="(https?:\/\/[^"]*|mailto:[^"]*)">/g, '<a href="$1" rel="noopener" target="_blank">');
  if (o.headingIds) {
    const used = new Set();
    out = out.replace(/<(h2|h3)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => '<' + tag + ' id="' + uniqueSlug('s-' + slug(T.text(inner), 40), used) + '">' + inner + '</' + tag + '>');
  }
  return out.replace(/<p><\/p>/g, '');
}
/** the h2/h3 headings of a body rendered with headingIds */
function headings(html) {
  const out = [];
  html.replace(/<(h2|h3) id="([^"]+)">([\s\S]*?)<\/\1>/g, (m, tag, id, inner) => { out.push({ level: +tag[1], id, text: T.text(inner) }); return m; });
  return out;
}

const REAL_FMT = (() => { try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return null; } })();
/** 'YYYY-MM-DD' → '14 September 2026' */
function realDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (isNaN(d)) return '';
  return REAL_FMT ? REAL_FMT.format(d) : iso.slice(0, 10);
}
/** RFC 822 date for RSS */
function rfc822(iso) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso + 'T09:00:00Z' : iso || Date.now());
  return isNaN(d) ? new Date().toUTCString() : d.toUTCString();
}
function money(cents, currency) {
  const c = String(currency || 'USD').toUpperCase();
  if (cents == null || cents === '' || !Number.isFinite(+cents)) return '';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(+cents / 100); } catch { return (+cents / 100).toFixed(2) + ' ' + c; }
}
const paragraphs = s => String(s || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

/**
 * a field value as HTML for readers. o: { href(id), title(id), media(id) → {src} }
 * refs to entries without a page show as plain titles; refs the reader may not see were already removed (model).
 */
function fieldHtml(def, v, o = {}) {
  if (!F.filled(def.kind, v)) return '';
  const ref = id => { const t = o.title ? o.title(id) : ''; if (!t) return ''; const h = o.href ? o.href(id) : null; return h ? '<a href="' + attr(h) + '">' + esc(t) + '</a>' : '<span>' + esc(t) + '</span>'; };
  switch (def.kind) {
    case 'ref': return ref(v);
    case 'refs': return v.map(ref).filter(Boolean).join(', ');
    case 'multi': case 'list': return '<ul class="vals">' + v.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    case 'stats': return '<div class="stats">' + v.map(s => '<div class="stat"><span>' + esc(s.label) + '</span><b>' + esc(s.value) + '</b></div>').join('') + '</div>';
    case 'bool': return v ? 'Yes' : 'No';
    case 'rating': { const n = Math.max(0, Math.min(5, Math.round(+v) || 0)); return '<span class="stars" aria-label="' + n + ' of 5">' + '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span></span>'; }
    case 'progress': { const n = Math.max(0, Math.min(100, +v || 0)); return '<span class="meter"><i style="width:' + n + '%"></i></span> ' + n + '%'; }
    case 'url': return /^(https?:\/\/|mailto:)/i.test(v) ? '<a href="' + attr(v) + '" rel="noopener" target="_blank">' + esc(String(v).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a>' : esc(v);
    case 'image': { const md = o.media ? o.media(v) : null; return md ? '<img src="' + attr(md.src) + '" alt="" loading="lazy">' : ''; }
    case 'color': return /^#[0-9a-f]{3,8}$/i.test(v) ? '<span class="swatch" style="background:' + v + '"></span> ' + esc(v) : esc(v);
    case 'realdate': return esc(realDate(v) || v);
    case 'number': return esc(Number(v).toLocaleString('en-US')) + (def.unit && def.unit !== 'cents' ? ' ' + esc(def.unit) : '');
    case 'longtext': return paragraphs(v);
    case 'dice': return '<code>' + esc(v) + '</code>';
    default: return esc(v);
  }
}

/** a small favicon: the world's initial on its accent colour */
function favicon(name, color) {
  const letter = esc((String(name || 'W').trim()[0] || 'W').toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="44" font-family="Georgia,serif" font-size="38" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { esc, attr, slug, uniqueSlug, bodyHtml, headings, realDate, rfc822, money, paragraphs, fieldHtml, favicon };
