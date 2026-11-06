'use strict';
/* CSV for the sales ledger: reading (quotes, separators, BOM), guessing which column is which, money and date
   parsing in the formats shops export, and writing. No database access: the business area resolves products. */

/** the separator used in the first lines: comma, semicolon, tab or pipe */
function detectDelimiter(text) {
  const sample = String(text || '').split(/\r?\n/).slice(0, 6).join('\n');
  let best = ',', bestN = 0;
  for (const d of [',', ';', '\t', '|']) {
    let n = 0, q = false;
    for (const ch of sample) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/** rows of cells; handles quoted cells with separators, doubled quotes and line breaks */
function parse(text, delim) {
  const s = String(text || '').replace(/^﻿/, '');
  const d = delim || detectDelimiter(s);
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === '') { q = true; cell = ''; i++; continue; }
    if (ch === d) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch; i++;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(c => c.trim()));
}

const needsQuote = /[",;\t\r\n]/;
function stringify(rows) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return needsQuote.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n') + '\r\n';
}

/* ---------------- columns ---------------- */
const FIELDS = [
  ['date', 'Date', 'When the sale happened'],
  ['product', 'Product', 'Matched to your Product entries by name'],
  ['qty', 'Quantity', 'Units sold (1 when empty)'],
  ['gross', 'Gross', 'What the buyer paid for the row'],
  ['fees', 'Fees', 'Platform, payment and shipping fees'],
  ['net', 'Net', 'What you kept (gross − fees when empty)'],
  ['channel', 'Channel', 'Shop, platform or event'],
  ['buyer', 'Buyer', 'Name or e-mail'],
  ['currency', 'Currency', 'Three-letter code, e.g. EUR'],
  ['coupon', 'Coupon', 'Discount code used'],
  ['refund', 'Refunded', 'yes / refunded / 1 marks a refund'],
  ['note', 'Note', ''],
];
const SYN = {
  date: ['date', 'day', 'sold', 'sold on', 'order date', 'sale date', 'purchase date', 'created', 'created at', 'paid at', 'timestamp', 'time', 'datum', 'fecha'],
  product: ['product', 'item', 'title', 'name', 'product name', 'item name', 'product title', 'listing', 'sku', 'book', 'work'],
  qty: ['qty', 'quantity', 'units', 'count', 'copies', 'units sold', 'pieces'],
  gross: ['gross', 'gross revenue', 'gross sales', 'price', 'total', 'sale price', 'amount', 'paid', 'revenue', 'sales', 'subtotal', 'item total', 'order total'],
  fees: ['fee', 'fees', 'commission', 'processing fee', 'platform fee', 'transaction fee', 'payment fee', 'shipping', 'cut'],
  net: ['net', 'net revenue', 'net sales', 'earnings', 'payout', 'royalty', 'royalties', 'proceeds', 'profit', 'you earned', 'net amount'],
  channel: ['channel', 'store', 'platform', 'marketplace', 'shop', 'source', 'site', 'storefront', 'venue'],
  buyer: ['buyer', 'customer', 'purchaser', 'client', 'email', 'e-mail', 'buyer email', 'customer email', 'buyer name', 'customer name', 'full name'],
  currency: ['currency', 'cur', 'ccy', 'currency code'],
  coupon: ['coupon', 'coupon code', 'discount code', 'promo', 'promo code', 'offer code', 'code', 'discount'],
  refund: ['refund', 'refunded', 'is refunded', 'status', 'refund status'],
  note: ['note', 'notes', 'memo', 'comment', 'comments', 'description', 'details'],
};
const norm = s => String(s || '').toLowerCase().replace(/[_\-.()[\]:#]+/g, ' ').replace(/\s+/g, ' ').trim();

/** { field: column index | -1 } from header names (each column used once, best match first) */
function guessMapping(headers) {
  const H = (headers || []).map(norm);
  const cand = [];
  for (const [field] of FIELDS) {
    const syn = SYN[field];
    H.forEach((h, col) => {
      if (!h) return;
      let score = 0;
      syn.forEach((s, rank) => {
        let v = 0;
        if (h === s) v = 100 - rank;
        else if (new RegExp('(^| )' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(h)) v = 50 - rank - (h.length - s.length) * .2;
        score = Math.max(score, v);
      });
      if (score > 0) cand.push({ field, col, score });
    });
  }
  cand.sort((a, b) => b.score - a.score);
  const out = Object.fromEntries(FIELDS.map(([f]) => [f, -1])), used = new Set();
  for (const c of cand) if (out[c.field] < 0 && !used.has(c.col)) { out[c.field] = c.col; used.add(c.col); }
  return out;
}

/** whether the first row looks like column names (no money or date values in it) */
function looksLikeHeader(row) {
  if (!row || !row.length) return false;
  const n = row.filter(c => c && (money(c) != null || date(c, {}) != null)).length;
  return n === 0;
}

/* ---------------- values ---------------- */
const SYMBOLS = { '$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD', 'kr': 'SEK', 'zł': 'PLN', 'R$': 'BRL', 'CHF': 'CHF', '₩': 'KRW' };
/** a currency code found in a money string ("€12,00", "12.00 USD"), or '' */
function currencyOf(s) {
  const t = String(s || '');
  const code = /\b([A-Z]{3})\b/.exec(t);
  if (code && code[1] !== 'NAN') return code[1];
  for (const sym of Object.keys(SYMBOLS).sort((a, b) => b.length - a.length)) if (t.includes(sym)) return SYMBOLS[sym];
  return '';
}
/** "19.99", "$1,299.00", "1.299,50 €", "(4.00)", "-3" → cents (integer) or null */
function money(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s * 100) : null;
  let t = String(s == null ? '' : s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[A-Za-z$€£¥₹₩zł\s'’]/g, '');
  if (/^[-−]/.test(t)) { neg = !neg; t = t.slice(1); }
  if (/[-−]$/.test(t)) { neg = !neg; t = t.slice(0, -1); }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) dec = /^\d{1,3}(,\d{3})+$/.test(t) || (t.match(/,/g) || []).length > 1 ? '' : ',';
  else if (lastDot >= 0) dec = /^\d{1,3}(\.\d{3})+$/.test(t) || (t.match(/\./g) || []).length > 1 ? '' : '.';
  const thou = dec === '.' ? ',' : dec === ',' ? '.' : /[.,]/;
  let clean = t.split(thou).join('');
  if (dec === ',') clean = clean.replace(',', '.');
  const v = parseFloat(clean);
  if (!Number.isFinite(v)) return null;
  return Math.round((neg ? -v : v) * 100);
}
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  if (!(y > 1000 && y < 3000 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? y + '-' + pad(m) + '-' + pad(d) : null;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** many date spellings → 'YYYY-MM-DD' | null; opts.dayFirst decides 03/04/2026 */
function date(s, opts = {}) {
  if (typeof s === 'number' && s > 20000 && s < 80000) s = String(s);
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/.exec(t))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(t))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    const dayFirst = a > 12 ? true : b > 12 ? false : !!opts.dayFirst;
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }
  if ((m = /^(\d{5})(\.\d+)?$/.exec(t))) {   // a spreadsheet serial number
    const d = new Date(Date.UTC(1899, 11, 30) + (+m[1]) * 864e5);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const words = t.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  let y = null, mo = null, d = null;
  for (const w of words) {
    const mi = MONTHS.indexOf(w.slice(0, 3));
    if (mi >= 0 && /^[a-z]/.test(w)) mo = mi + 1;
    else if (/^\d{4}$/.test(w)) y = +w;
    else if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && d == null) d = parseInt(w, 10);
  }
  if (y && mo && d) return iso(y, mo, d);
  if (y && mo && !d) return iso(y, mo, 1);
  return null;
}
/** decides day-first for a column of dates like 03/04/2026 (true when any first part is above 12) */
function detectDayFirst(values) {
  let dayFirst = 0, monthFirst = 0;
  for (const v of values || []) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(String(v || '').trim());
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    if (+m[2] > 12) monthFirst++;
  }
  return dayFirst > monthFirst;
}
const truthy = s => /^(1|y|yes|true|refund|refunded|refunded in full|reversed|chargeback|charged back|cancel+ed|void(ed)?)$/i.test(String(s || '').trim());
function int(s, d) { const v = parseInt(String(s == null ? '' : s).replace(/[^\d-]/g, ''), 10); return Number.isFinite(v) ? v : d; }

/**
 * Raw rows → sale drafts (no product ids yet).
 * mapping: { field: column index | -1 }; opts: { hasHeader, dayFirst, channel, currency }
 * → { drafts: [{ row, date, productName, qty, gross, fees, net, channel, buyer, currency, coupon, refund, note }], problems: [{ row, msg }] }
 */
function toDrafts(rows, mapping, opts = {}) {
  const body = opts.hasHeader === false ? rows : rows.slice(1);
  const first = opts.hasHeader === false ? 1 : 2;
  const col = (r, f) => (mapping[f] != null && mapping[f] >= 0 ? (r[mapping[f]] || '') : '');
  const dayFirst = opts.dayFirst != null ? !!opts.dayFirst : detectDayFirst(body.map(r => col(r, 'date')));
  const drafts = [], problems = [];
  body.forEach((r, i) => {
    const rowNo = i + first;
    const rawGross = col(r, 'gross'), rawNet = col(r, 'net'), rawFees = col(r, 'fees');
    let gross = money(rawGross), fees = money(rawFees), net = money(rawNet);
    const d = date(col(r, 'date'), { dayFirst }) || (mapping.date >= 0 ? null : opts.today || null);
    if (!d) { problems.push({ row: rowNo, msg: col(r, 'date') ? 'Unreadable date “' + col(r, 'date') + '”' : 'No date' }); return; }
    if (gross == null && net == null) { problems.push({ row: rowNo, msg: 'No amount' }); return; }
    let refund = truthy(col(r, 'refund'));
    if (gross != null && gross < 0) { refund = true; gross = -gross; }
    if (net != null && net < 0 && (gross == null || refund)) { refund = true; net = -net; }
    if (fees != null && fees < 0) fees = -fees;
    if (fees == null) fees = gross != null && net != null ? Math.max(0, gross - net) : 0;
    if (gross == null) gross = net + fees;
    if (net == null) net = gross - fees;
    const cur = (col(r, 'currency') || '').trim().toUpperCase().slice(0, 3) || currencyOf(rawGross) || currencyOf(rawNet) || opts.currency || '';
    drafts.push({
      row: rowNo, date: d, productName: col(r, 'product').trim(), qty: Math.max(0, int(col(r, 'qty'), 1)),
      gross, fees, net, channel: col(r, 'channel').trim() || opts.channel || '', buyer: col(r, 'buyer').trim(),
      currency: /^[A-Z]{3}$/.test(cur) ? cur : '', coupon: col(r, 'coupon').trim(), refund, note: col(r, 'note').trim(),
    });
  });
  return { drafts, problems, dayFirst };
}

/** cents → "19.99" (plain decimal for files) */
const plain = c => (c == null ? '' : ((c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + pad(Math.abs(c) % 100)));

module.exports = { detectDelimiter, parse, stringify, FIELDS, guessMapping, looksLikeHeader, money, currencyOf, date, detectDayFirst, toDrafts, plain };
