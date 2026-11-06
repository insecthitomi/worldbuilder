'use strict';
/* Business: a creator's ledger — sales (with refunds and CSV import/export), membership tiers and supporters,
   coupons and reviews, and a summary (revenue by month, product and channel, recurring revenue, goal). */
const fs = require('fs');
const path = require('path');
const { uid, now, today, J, placeholders } = require('../util');
const CSV = require('../lib/business-csv');

const migrations = [{
  id: 'business-001',
  sql: `
  CREATE TABLE tiers (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT '',
    price_cents INTEGER DEFAULT 0, currency TEXT DEFAULT '', period TEXT DEFAULT 'month', perks TEXT DEFAULT '', color TEXT DEFAULT '', sort REAL DEFAULT 0, created_at TEXT);
  CREATE INDEX tiers_world ON tiers (world_id, sort);
  CREATE TABLE supporters (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT '',
    email TEXT DEFAULT '', tier_id TEXT, pledge_cents INTEGER, status TEXT DEFAULT 'active', since TEXT, until TEXT, channel TEXT DEFAULT '',
    note TEXT DEFAULT '', created_at TEXT);
  CREATE INDEX supporters_world ON supporters (world_id, status);
  CREATE TABLE sales (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES entries(id) ON DELETE SET NULL, date TEXT NOT NULL, channel TEXT DEFAULT '', qty INTEGER DEFAULT 1,
    gross_cents INTEGER DEFAULT 0, fees_cents INTEGER DEFAULT 0, net_cents INTEGER DEFAULT 0, currency TEXT DEFAULT '', buyer TEXT DEFAULT '',
    coupon_code TEXT DEFAULT '', refund INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT);
  CREATE INDEX sales_world ON sales (world_id, date);
  CREATE INDEX sales_product ON sales (product_id);
  CREATE TABLE coupons (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, code TEXT NOT NULL DEFAULT '',
    percent_off REAL, amount_off_cents INTEGER, product_id TEXT REFERENCES entries(id) ON DELETE SET NULL, channel TEXT DEFAULT '',
    expires TEXT, max_uses INTEGER, uses INTEGER DEFAULT 0, active INTEGER DEFAULT 1, note TEXT DEFAULT '', created_at TEXT);
  CREATE INDEX coupons_world ON coupons (world_id);
  CREATE TABLE reviews (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES entries(id) ON DELETE SET NULL, rating INTEGER DEFAULT 5, text TEXT DEFAULT '', author TEXT DEFAULT '',
    source TEXT DEFAULT '', date TEXT, featured INTEGER DEFAULT 0, created_at TEXT);
  CREATE INDEX reviews_world ON reviews (world_id, featured);
  `,
}];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = v => (v && ISO.test(String(v)) ? String(v) : null);
const cents = v => (v == null || v === '' || !Number.isFinite(+v) ? 0 : Math.round(+v));
const centsOrNull = v => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.round(+v));
const str = (v, n = 500) => String(v == null ? '' : v).trim().slice(0, n);
const cur = v => (/^[A-Za-z]{3}$/.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '');
const STATUSES = ['active', 'paused', 'ended'];
const monthOf = d => String(d).slice(0, 7);
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + '-' + String(m).padStart(2, '0'); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function handlers(ctx) {
  const { db } = ctx;
  const C = () => ctx.core;
  const settingsOf = worldId => C().world(worldId).settings;

  /* ---------------- row mappers ---------------- */
  const titleOf = id => { if (!id) return ''; const r = db.get('SELECT title FROM entries WHERE id = ?', id); return r ? r.title : ''; };
  const saleRow = r => r && ({
    id: r.id, worldId: r.world_id, productId: r.product_id || null, productTitle: r.product_title != null ? r.product_title || '' : titleOf(r.product_id),
    date: r.date, channel: r.channel || '', qty: r.qty == null ? 1 : r.qty, gross: r.gross_cents || 0, fees: r.fees_cents || 0, net: r.net_cents || 0,
    currency: r.currency || '', buyer: r.buyer || '', coupon: r.coupon_code || '', refund: !!r.refund, note: r.note || '', createdAt: r.created_at,
  });
  const tierRow = r => r && ({ id: r.id, worldId: r.world_id, name: r.name, price: r.price_cents || 0, currency: r.currency || '', period: r.period === 'year' ? 'year' : 'month', perks: r.perks || '', color: r.color || '', sort: r.sort || 0 });
  const supporterRow = r => r && ({ id: r.id, worldId: r.world_id, name: r.name, email: r.email || '', tierId: r.tier_id || null, pledge: r.pledge_cents == null ? null : r.pledge_cents, status: STATUSES.includes(r.status) ? r.status : 'active', since: r.since || null, until: r.until || null, channel: r.channel || '', note: r.note || '', createdAt: r.created_at });
  const couponRow = r => r && ({ id: r.id, worldId: r.world_id, code: r.code, percentOff: r.percent_off == null ? null : r.percent_off, amountOff: r.amount_off_cents == null ? null : r.amount_off_cents, productId: r.product_id || null, channel: r.channel || '', expires: r.expires || null, maxUses: r.max_uses == null ? null : r.max_uses, uses: r.uses || 0, active: !!r.active, note: r.note || '', createdAt: r.created_at });
  const reviewRow = r => r && ({ id: r.id, worldId: r.world_id, productId: r.product_id || null, productTitle: titleOf(r.product_id), rating: Math.max(0, Math.min(5, r.rating || 0)), text: r.text || '', author: r.author || '', source: r.source || '', date: r.date || null, featured: !!r.featured, createdAt: r.created_at });

  const productIn = (worldId, id) => (id && db.get('SELECT 1 FROM entries WHERE id = ? AND world_id = ?', id, worldId) ? id : null);
  const productEntries = worldId => db.all(`SELECT e.id, e.title, e.aliases, e.fields, e.summary, e.cover_id, e.audience, e.created_at FROM entries e JOIN types t ON t.id = e.type_id
    WHERE e.world_id = ? AND t.key = 'product' AND e.deleted_at IS NULL ORDER BY e.position, e.title COLLATE NOCASE`, worldId);

  /* ---------------- sales ---------------- */
  function salesWhere(worldId, f = {}) {
    const where = ['s.world_id = ?'], vals = [worldId];
    if (isoOrNull(f.from)) { where.push('s.date >= ?'); vals.push(f.from); }
    if (isoOrNull(f.to)) { where.push('s.date <= ?'); vals.push(f.to); }
    if (f.productId === 'none') where.push('s.product_id IS NULL');
    else if (f.productId) { where.push('s.product_id = ?'); vals.push(f.productId); }
    if (f.channel != null && f.channel !== '') { where.push('s.channel = ?'); vals.push(f.channel); }
    if (f.refunds === false) where.push('s.refund = 0');
    if (f.refunds === 'only') where.push('s.refund = 1');
    if (f.q) { const q = '%' + String(f.q).trim() + '%'; where.push('(s.buyer LIKE ? OR s.note LIKE ? OR s.coupon_code LIKE ? OR s.channel LIKE ? OR e.title LIKE ?)'); vals.push(q, q, q, q, q); }
    return { where: where.join(' AND '), vals };
  }
  function listSales(worldId, f = {}) {
    const { where, vals } = salesWhere(worldId, f);
    const lim = f.limit ? ' LIMIT ' + Math.max(1, Math.min(100000, +f.limit)) : '';
    return db.all(`SELECT s.*, e.title AS product_title FROM sales s LEFT JOIN entries e ON e.id = s.product_id WHERE ${where}
      ORDER BY s.date ${f.order === 'asc' ? 'ASC' : 'DESC'}, s.created_at ${f.order === 'asc' ? 'ASC' : 'DESC'}${lim}`, ...vals).map(saleRow);
  }
  function totalsOf(list) {
    const t = { count: 0, qty: 0, gross: 0, fees: 0, net: 0, refunds: { count: 0, gross: 0, net: 0 } };
    for (const s of list) {
      if (s.refund) { t.refunds.count++; t.refunds.gross += s.gross; t.refunds.net += s.net; continue; }
      t.count++; t.qty += s.qty; t.gross += s.gross; t.fees += s.fees; t.net += s.net;
    }
    t.avg = t.count ? Math.round(t.gross / t.count) : 0;
    return t;
  }
  function saveSale(s = {}) {
    const worldId = s.worldId || (s.id && (db.get('SELECT world_id FROM sales WHERE id = ?', s.id) || {}).world_id);
    if (!worldId) throw new Error('A sale needs a world.');
    const old = s.id ? db.get('SELECT * FROM sales WHERE id = ?', s.id) : null;
    const pick = (k, col, fn) => (s[k] !== undefined ? fn(s[k]) : old ? old[col] : fn(undefined));
    const date = pick('date', 'date', v => isoOrNull(v) || today());
    const gross = pick('gross', 'gross_cents', cents), fees = pick('fees', 'fees_cents', cents);
    // net follows gross − fees unless it was given (or kept apart from them before)
    let net;
    if (s.net !== undefined && s.net !== null && s.net !== '') net = cents(s.net);
    else if (old && (s.gross === undefined && s.fees === undefined)) net = old.net_cents;
    else net = gross - fees;
    const row = {
      product_id: s.productId !== undefined ? productIn(worldId, s.productId) : old ? old.product_id : null,
      date, channel: pick('channel', 'channel', v => str(v, 80)), qty: pick('qty', 'qty', v => (v == null || v === '' ? 1 : Math.max(0, Math.round(+v) || 0))),
      gross_cents: gross, fees_cents: fees, net_cents: net, currency: pick('currency', 'currency', cur), buyer: pick('buyer', 'buyer', v => str(v, 200)),
      coupon_code: pick('coupon', 'coupon_code', v => str(v, 60).toUpperCase()), refund: pick('refund', 'refund', v => (v ? 1 : 0)), note: pick('note', 'note', v => str(v, 2000)),
    };
    const id = old ? old.id : (s.id && /^[a-z0-9]{6,32}$/.test(s.id) ? s.id : uid());
    if (old) db.run(`UPDATE sales SET ${Object.keys(row).map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(row), id);
    else db.run(`INSERT INTO sales (id, world_id, ${Object.keys(row).join(', ')}, created_at) VALUES (?, ?, ${placeholders(Object.keys(row).length)}, ?)`, id, worldId, ...Object.values(row), s.createdAt || now());
    ctx.changed(['sales'], [id]);
    return saleRow(db.get('SELECT * FROM sales WHERE id = ?', id));
  }

  /* ---------------- generic remove with undo ---------------- */
  const TABLES = { sales: 'sales', tiers: 'tiers', supporters: 'supporters', coupons: 'coupons', reviews: 'reviews' };
  function removeRow(table, id) {
    const r = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!r) return null;
    db.run(`DELETE FROM ${table} WHERE id = ?`, id);
    ctx.changed([table], [id]);
    return { table, row: r };
  }
  function restoreRow(table, row) {
    const t = TABLES[table];
    if (!t || !row || !row.id || !row.world_id) throw new Error('Nothing to restore.');
    const cols = new Set(db.columns(t)), keys = Object.keys(row).filter(k => cols.has(k));
    const vals = keys.map(k => row[k]);
    // a product that was purged in the meantime can't be pointed at any more
    const pi = keys.indexOf('product_id');
    if (pi >= 0 && vals[pi] && !db.get('SELECT 1 FROM entries WHERE id = ?', vals[pi])) vals[pi] = null;
    db.run(`INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${placeholders(keys.length)})`, ...vals);
    ctx.changed([t], [row.id]);
    return true;
  }

  /* ---------------- tiers & supporters ---------------- */
  function saveTier(t = {}) {
    if (t.id && db.get('SELECT 1 FROM tiers WHERE id = ?', t.id)) {
      const o = db.get('SELECT * FROM tiers WHERE id = ?', t.id);
      db.run('UPDATE tiers SET name = ?, price_cents = ?, currency = ?, period = ?, perks = ?, color = ?, sort = ? WHERE id = ?',
        t.name !== undefined ? str(t.name, 80) || o.name : o.name, t.price !== undefined ? Math.max(0, cents(t.price)) : o.price_cents,
        t.currency !== undefined ? cur(t.currency) : o.currency, t.period !== undefined ? (t.period === 'year' ? 'year' : 'month') : o.period,
        t.perks !== undefined ? str(t.perks, 4000) : o.perks, t.color !== undefined ? str(t.color, 20) : o.color, t.sort !== undefined ? +t.sort || 0 : o.sort, t.id);
      ctx.changed(['tiers'], [t.id]);
      return tierRow(db.get('SELECT * FROM tiers WHERE id = ?', t.id));
    }
    if (!t.worldId) throw new Error('A tier needs a world.');
    const id = uid();
    db.run('INSERT INTO tiers (id, world_id, name, price_cents, currency, period, perks, color, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, t.worldId, str(t.name, 80) || 'New tier', Math.max(0, cents(t.price)), cur(t.currency), t.period === 'year' ? 'year' : 'month', str(t.perks, 4000), str(t.color, 20),
      t.sort != null ? +t.sort : (db.value('SELECT max(sort) FROM tiers WHERE world_id = ?', t.worldId) || 0) + 1, now());
    ctx.changed(['tiers'], [id]);
    return tierRow(db.get('SELECT * FROM tiers WHERE id = ?', id));
  }
  function saveSupporter(s = {}) {
    const old = s.id ? db.get('SELECT * FROM supporters WHERE id = ?', s.id) : null;
    const worldId = old ? old.world_id : s.worldId;
    if (!worldId) throw new Error('A supporter needs a world.');
    const pick = (k, col, fn) => (s[k] !== undefined ? fn(s[k]) : old ? old[col] : fn(undefined));
    const tierOk = v => (v && db.get('SELECT 1 FROM tiers WHERE id = ? AND world_id = ?', v, worldId) ? v : null);
    const row = {
      name: pick('name', 'name', v => str(v, 120) || 'Supporter'), email: pick('email', 'email', v => str(v, 200)), tier_id: pick('tierId', 'tier_id', tierOk),
      pledge_cents: pick('pledge', 'pledge_cents', centsOrNull), status: pick('status', 'status', v => (STATUSES.includes(v) ? v : 'active')),
      since: pick('since', 'since', v => isoOrNull(v) || (old ? null : today())), until: pick('until', 'until', isoOrNull),
      channel: pick('channel', 'channel', v => str(v, 80)), note: pick('note', 'note', v => str(v, 2000)),
    };
    // ending a membership dates it; reactivating clears the end
    if (s.status === 'ended' && !row.until && !(s.until !== undefined)) row.until = today();
    if (s.status === 'active' && old && old.status === 'ended' && s.until === undefined) row.until = null;
    const id = old ? old.id : uid();
    if (old) db.run(`UPDATE supporters SET ${Object.keys(row).map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(row), id);
    else db.run(`INSERT INTO supporters (id, world_id, ${Object.keys(row).join(', ')}, created_at) VALUES (?, ?, ${placeholders(Object.keys(row).length)}, ?)`, id, worldId, ...Object.values(row), now());
    ctx.changed(['supporters'], [id]);
    return supporterRow(db.get('SELECT * FROM supporters WHERE id = ?', id));
  }
  const monthly = (cents0, period) => (period === 'year' ? Math.round(cents0 / 12) : cents0);
  function recurring(worldId) {
    const tiers = db.all('SELECT * FROM tiers WHERE world_id = ? ORDER BY sort, price_cents', worldId).map(tierRow);
    const sup = db.all('SELECT * FROM supporters WHERE world_id = ?', worldId).map(supporterRow);
    const byTier = tiers.map(t => ({ tierId: t.id, name: t.name, price: t.price, period: t.period, color: t.color, active: 0, paused: 0, ended: 0, mrr: 0 }));
    const none = { tierId: null, name: 'No tier', price: 0, period: 'month', color: '', active: 0, paused: 0, ended: 0, mrr: 0 };
    let mrr = 0;
    const counts = { active: 0, paused: 0, ended: 0 };
    for (const s of sup) {
      const t = tiers.find(x => x.id === s.tierId), row = byTier.find(x => x.tierId === s.tierId) || none;
      row[s.status]++; counts[s.status]++;
      if (s.status !== 'active') continue;
      const m = s.pledge != null ? s.pledge : t ? monthly(t.price, t.period) : 0;
      row.mrr += m; mrr += m;
    }
    if (none.active + none.paused + none.ended) byTier.push(none);
    const since30 = addDays(today(), -30);
    return { mrr, counts, byTier, total: sup.length, newThisMonth: sup.filter(s => s.since && s.since >= since30).length, churned: sup.filter(s => s.status === 'ended' && s.until && s.until >= since30).length };
  }

  /* ---------------- coupons & reviews ---------------- */
  function couponStatus(c, used) {
    if (!c.active) return 'off';
    if (c.expires && c.expires < today()) return 'expired';
    if (c.maxUses != null && c.maxUses > 0 && used >= c.maxUses) return 'used';
    return 'live';
  }
  function listCoupons(worldId) {
    const counts = new Map(db.all(`SELECT upper(coupon_code) AS code, count(*) AS n, sum(gross_cents) AS g FROM sales WHERE world_id = ? AND coupon_code != '' AND refund = 0 GROUP BY upper(coupon_code)`, worldId).map(r => [r.code, r]));
    return db.all('SELECT * FROM coupons WHERE world_id = ? ORDER BY active DESC, created_at DESC', worldId).map(couponRow).map(c => {
      const led = counts.get(c.code.toUpperCase());
      const used = c.uses + (led ? led.n : 0);
      return Object.assign(c, { ledgerUses: led ? led.n : 0, ledgerGross: led ? led.g : 0, used, status: couponStatus(c, used), productTitle: titleOf(c.productId) });
    });
  }
  function saveCoupon(c = {}) {
    const old = c.id ? db.get('SELECT * FROM coupons WHERE id = ?', c.id) : null;
    const worldId = old ? old.world_id : c.worldId;
    if (!worldId) throw new Error('A coupon needs a world.');
    const pick = (k, col, fn) => (c[k] !== undefined ? fn(c[k]) : old ? old[col] : fn(undefined));
    const code = pick('code', 'code', v => str(v, 40).toUpperCase().replace(/\s+/g, ''));
    if (!code) throw new Error('A coupon needs a code.');
    const dup = db.get('SELECT id FROM coupons WHERE world_id = ? AND upper(code) = ? AND id != ?', worldId, code, old ? old.id : '');
    if (dup) throw new Error('There is already a coupon “' + code + '”.');
    const row = {
      code, percent_off: pick('percentOff', 'percent_off', v => (v == null || v === '' ? null : Math.max(0, Math.min(100, +v || 0)))),
      amount_off_cents: pick('amountOff', 'amount_off_cents', centsOrNull), product_id: c.productId !== undefined ? productIn(worldId, c.productId) : old ? old.product_id : null,
      channel: pick('channel', 'channel', v => str(v, 80)), expires: pick('expires', 'expires', isoOrNull),
      max_uses: pick('maxUses', 'max_uses', v => (v == null || v === '' || +v <= 0 ? null : Math.round(+v))), uses: pick('uses', 'uses', v => Math.max(0, Math.round(+v || 0))),
      active: pick('active', 'active', v => (v === undefined ? 1 : v ? 1 : 0)), note: pick('note', 'note', v => str(v, 2000)),
    };
    const id = old ? old.id : uid();
    if (old) db.run(`UPDATE coupons SET ${Object.keys(row).map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(row), id);
    else db.run(`INSERT INTO coupons (id, world_id, ${Object.keys(row).join(', ')}, created_at) VALUES (?, ?, ${placeholders(Object.keys(row).length)}, ?)`, id, worldId, ...Object.values(row), now());
    ctx.changed(['coupons'], [id]);
    return listCoupons(worldId).find(x => x.id === id);
  }
  function listReviews(worldId, o = {}) {
    const where = ['world_id = ?'], vals = [worldId];
    if (o.featured) where.push('featured = 1');
    if (o.productId) { where.push('product_id = ?'); vals.push(o.productId); }
    return db.all(`SELECT * FROM reviews WHERE ${where.join(' AND ')} ORDER BY featured DESC, coalesce(date, created_at) DESC`, ...vals).map(reviewRow);
  }
  function saveReview(r = {}) {
    const old = r.id ? db.get('SELECT * FROM reviews WHERE id = ?', r.id) : null;
    const worldId = old ? old.world_id : r.worldId;
    if (!worldId) throw new Error('A review needs a world.');
    const pick = (k, col, fn) => (r[k] !== undefined ? fn(r[k]) : old ? old[col] : fn(undefined));
    const row = {
      product_id: r.productId !== undefined ? productIn(worldId, r.productId) : old ? old.product_id : null,
      rating: pick('rating', 'rating', v => (v == null ? 5 : Math.max(0, Math.min(5, Math.round(+v) || 0)))), text: pick('text', 'text', v => str(v, 8000)),
      author: pick('author', 'author', v => str(v, 120)), source: pick('source', 'source', v => str(v, 120)), date: pick('date', 'date', v => isoOrNull(v) || (old ? null : today())),
      featured: pick('featured', 'featured', v => (v ? 1 : 0)),
    };
    const id = old ? old.id : uid();
    if (old) db.run(`UPDATE reviews SET ${Object.keys(row).map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(row), id);
    else db.run(`INSERT INTO reviews (id, world_id, ${Object.keys(row).join(', ')}, created_at) VALUES (?, ?, ${placeholders(Object.keys(row).length)}, ?)`, id, worldId, ...Object.values(row), now());
    ctx.changed(['reviews'], [id]);
    return reviewRow(db.get('SELECT * FROM reviews WHERE id = ?', id));
  }

  /* ---------------- products ---------------- */
  function products(worldId) {
    const stats = new Map(db.all(`SELECT product_id AS id, count(*) AS n, sum(qty) AS qty, sum(gross_cents) AS gross, sum(net_cents) AS net, sum(fees_cents) AS fees, max(date) AS last,
      sum(CASE WHEN date >= ? THEN net_cents ELSE 0 END) AS net30
      FROM sales WHERE world_id = ? AND refund = 0 AND product_id IS NOT NULL GROUP BY product_id`, addDays(today(), -30), worldId).map(r => [r.id, r]));
    const refunds = new Map(db.all('SELECT product_id AS id, count(*) AS n FROM sales WHERE world_id = ? AND refund = 1 GROUP BY product_id', worldId).map(r => [r.id, r.n]));
    const rates = new Map(db.all('SELECT product_id AS id, avg(rating) AS avg, count(*) AS n, sum(featured) AS f FROM reviews WHERE world_id = ? AND product_id IS NOT NULL GROUP BY product_id', worldId).map(r => [r.id, r]));
    const months = new Map();
    const since = addMonths(monthOf(today()), -11) + '-01';
    for (const r of db.all(`SELECT product_id AS id, substr(date, 1, 7) AS m, sum(net_cents) AS net FROM sales WHERE world_id = ? AND refund = 0 AND date >= ? AND product_id IS NOT NULL GROUP BY product_id, m`, worldId, since)) {
      if (!months.has(r.id)) months.set(r.id, {});
      months.get(r.id)[r.m] = r.net;
    }
    const axis = Array.from({ length: 12 }, (_, i) => addMonths(monthOf(today()), i - 11));
    return productEntries(worldId).map(e => {
      const f = J(e.fields, {}), s = stats.get(e.id) || {}, rt = rates.get(e.id), m = months.get(e.id) || {};
      return {
        id: e.id, title: e.title, summary: e.summary || '', coverId: e.cover_id || null, audience: e.audience,
        price: f.price == null || f.price === '' ? null : +f.price, currency: f.currency || '', format: f.format || '', status: f.status || '', link: f.link || '', released: f.released || '',
        sales: { count: s.n || 0, qty: s.qty || 0, gross: s.gross || 0, net: s.net || 0, fees: s.fees || 0, last: s.last || null, net30: s.net30 || 0, refunds: refunds.get(e.id) || 0 },
        rating: rt ? { avg: Math.round(rt.avg * 10) / 10, n: rt.n, featured: rt.f || 0 } : null,
        trend: axis.map(k => m[k] || 0),
      };
    });
  }
  function findProduct(worldId, name, cache) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let hit = null;
    for (const e of productEntries(worldId)) {
      if (e.title.trim().toLowerCase() === key || J(e.aliases, []).some(a => String(a).trim().toLowerCase() === key)) { hit = e.id; break; }
    }
    cache.set(key, hit);
    return hit;
  }

  /* ---------------- summary ---------------- */
  function summary(worldId, o = {}) {
    const w = C().world(worldId), st = w.settings || {};
    const from = isoOrNull(o.from), to = isoOrNull(o.to);
    const list = listSales(worldId, { from, to, order: 'asc' });
    const totals = totalsOf(list);
    // months on the axis: the chosen range, else the twelve months up to now (or up to the last sale)
    const last = list.length ? list[list.length - 1].date : today();
    const endM = monthOf(to || (last > today() ? last : today()));
    let startM = from ? monthOf(from) : addMonths(endM, -11);
    if (!from && list.length) {
      const first = monthOf(list[0].date);
      if (first < startM && first >= addMonths(endM, -35)) startM = first;
      else if (first > startM) startM = first < addMonths(endM, -5) ? first : addMonths(endM, -5);
    }
    const months = [];
    for (let m = startM, guard = 0; m <= endM && guard < 120; m = addMonths(m, 1), guard++) months.push({ month: m, gross: 0, fees: 0, net: 0, qty: 0, count: 0, refunds: 0 });
    const idx = new Map(months.map((m, i) => [m.month, i]));
    const byProduct = new Map(), byChannel = new Map(), currencies = new Set();
    for (const s of list) {
      const mi = idx.get(monthOf(s.date));
      if (s.currency) currencies.add(s.currency);
      if (s.refund) { if (mi != null) months[mi].refunds += s.gross; continue; }
      if (mi != null) { const m = months[mi]; m.gross += s.gross; m.fees += s.fees; m.net += s.net; m.qty += s.qty; m.count++; }
      const pk = s.productId || '';
      if (!byProduct.has(pk)) byProduct.set(pk, { productId: s.productId, title: s.productId ? s.productTitle || 'Deleted product' : 'No product', gross: 0, net: 0, fees: 0, qty: 0, count: 0 });
      const p = byProduct.get(pk); p.gross += s.gross; p.net += s.net; p.fees += s.fees; p.qty += s.qty; p.count++;
      const ck = s.channel || '';
      if (!byChannel.has(ck)) byChannel.set(ck, { channel: s.channel || '', gross: 0, net: 0, fees: 0, qty: 0, count: 0 });
      const c = byChannel.get(ck); c.gross += s.gross; c.net += s.net; c.fees += s.fees; c.qty += s.qty; c.count++;
    }
    // the period before, for comparison
    let prev = null;
    if (from && to) {
      const len = daysBetween(from, to) + 1;
      prev = totalsOf(listSales(worldId, { from: addDays(from, -len), to: addDays(from, -1) }));
      prev.from = addDays(from, -len); prev.to = addDays(from, -1);
    }
    const rec = recurring(worldId);
    // goal: net sales in the current month (or year) plus recurring revenue for it
    let goal = null;
    const gc = +st.revenueGoal || 0;
    if (gc > 0) {
      const period = st.revenueGoalPeriod === 'year' ? 'year' : 'month';
      const start = period === 'year' ? today().slice(0, 4) + '-01-01' : today().slice(0, 7) + '-01';
      const t = totalsOf(listSales(worldId, { from: start, to: today() }));
      const recurringPart = st.revenueGoalRecurring === false ? 0 : period === 'year' ? rec.mrr * 12 : rec.mrr;
      const progress = t.net + recurringPart;
      goal = { cents: gc, period, start, sales: t.net, recurring: recurringPart, progress, fraction: Math.max(0, progress / gc), label: st.revenueGoalLabel || '' };
    }
    const sortV = a => [...a.values()].sort((x, y) => y.net - x.net);
    return {
      currency: st.currency || 'USD', currencies: [...currencies], from, to, totals, prev,
      byMonth: months, byProduct: sortV(byProduct), byChannel: sortV(byChannel),
      recurring: rec, mrr: rec.mrr, goal,
      recent: listSales(worldId, { limit: 8 }),
      products: productEntries(worldId).length,
      allTime: totalsOf(listSales(worldId, {})),
      firstSale: (db.get('SELECT min(date) AS d FROM sales WHERE world_id = ?', worldId) || {}).d || null,
    };
  }

  /* ---------------- CSV ---------------- */
  function csvPreview(worldId, text, o = {}) {
    const rows = CSV.parse(text, o.delimiter);
    if (!rows.length) throw new Error('That file has no rows.');
    const hasHeader = o.hasHeader != null ? !!o.hasHeader : CSV.looksLikeHeader(rows[0]);
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const headers = hasHeader ? rows[0].map((h, i) => h || 'Column ' + (i + 1)) : Array.from({ length: width }, (_, i) => 'Column ' + (i + 1));
    const mapping = o.mapping || (hasHeader ? CSV.guessMapping(rows[0]) : Object.fromEntries(CSV.FIELDS.map(([f]) => [f, -1])));
    const cache = new Map();
    const { drafts, problems, dayFirst } = CSV.toDrafts(rows, mapping, { hasHeader, dayFirst: o.dayFirst, channel: o.channel, currency: o.currency });
    const sample = drafts.slice(0, 8).map(d => Object.assign({}, d, { productId: findProduct(worldId, d.productName, cache) }));
    const names = [...new Set(drafts.map(d => d.productName).filter(Boolean))];
    return {
      delimiter: CSV.detectDelimiter(text), hasHeader, headers, rows: rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 6), total: rows.length - (hasHeader ? 1 : 0), mapping, dayFirst,
      sample, problems: problems.slice(0, 30), problemCount: problems.length, ok: drafts.length,
      products: { known: names.filter(n => findProduct(worldId, n, cache)), unknown: names.filter(n => !findProduct(worldId, n, cache)) },
      fields: CSV.FIELDS,
    };
  }
  function csvImport(worldId, text, o = {}) {
    C().world(worldId);
    const rows = CSV.parse(text, o.delimiter);
    const hasHeader = o.hasHeader != null ? !!o.hasHeader : CSV.looksLikeHeader(rows[0]);
    const mapping = o.mapping || (hasHeader ? CSV.guessMapping(rows[0]) : {});
    const { drafts, problems } = CSV.toDrafts(rows, mapping, { hasHeader, dayFirst: o.dayFirst, channel: o.channel, currency: o.currency });
    const cache = new Map(), created = [], ids = [];
    let added = 0, skipped = 0;
    db.tx(() => {
      for (const d of drafts) {
        let pid = findProduct(worldId, d.productName, cache);
        if (!pid && d.productName && o.createProducts !== false) {
          const e = C().createEntry({ worldId, typeKey: 'product', title: d.productName.slice(0, 200), fields: { status: 'Available' } });
          pid = e.id; created.push(e.id); cache.set(d.productName.trim().toLowerCase(), pid);
        }
        if (o.skipDuplicates !== false && db.get(`SELECT 1 FROM sales WHERE world_id = ? AND date = ? AND coalesce(product_id, '') = ? AND gross_cents = ? AND buyer = ? AND channel = ? AND qty = ?`,
          worldId, d.date, pid || '', d.gross, d.buyer, d.channel, d.qty)) { skipped++; continue; }
        const note = !pid && d.productName ? (d.note ? d.note + ' · ' : '') + 'Product: ' + d.productName : d.note;
        const id = uid();
        ids.push(id);
        db.run(`INSERT INTO sales (id, world_id, product_id, date, channel, qty, gross_cents, fees_cents, net_cents, currency, buyer, coupon_code, refund, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, worldId, pid, d.date, d.channel.slice(0, 80), d.qty, d.gross, d.fees, d.net, d.currency, d.buyer.slice(0, 200), d.coupon.toUpperCase().slice(0, 60), d.refund ? 1 : 0, note.slice(0, 2000), now());
        added++;
      }
    });
    ctx.changed(['sales'].concat(created.length ? ['entries'] : []), created);
    return { added, skipped, ids, createdProducts: created, problems: problems.slice(0, 50), problemCount: problems.length };
  }
  function csvExport(worldId, f = {}) {
    const list = listSales(worldId, Object.assign({}, f, { order: 'asc' }));
    const rows = [['Date', 'Product', 'Channel', 'Quantity', 'Gross', 'Fees', 'Net', 'Currency', 'Buyer', 'Coupon', 'Refunded', 'Note']];
    const wc = settingsOf(worldId).currency || 'USD';
    for (const s of list) rows.push([s.date, s.productTitle, s.channel, s.qty, CSV.plain(s.gross), CSV.plain(s.fees), CSV.plain(s.net), s.currency || wc, s.buyer, s.coupon, s.refund ? 'yes' : '', s.note]);
    return CSV.stringify(rows);
  }

  return {
    'business.summary': (worldId, o) => summary(worldId, o),
    'business.sales': (worldId, f) => listSales(worldId, f || {}),
    'business.totals': (worldId, f) => totalsOf(listSales(worldId, f || {})),
    'business.saveSale': s => saveSale(s),
    'business.refund': (id, on = true) => saveSale({ id, refund: !!on }),
    'business.removeSale': id => removeRow('sales', id),
    /** several at once (undoing an import); returns the rows for business.restoreMany */
    'business.removeSales': ids => { const out = []; db.tx(() => { for (const id of ids || []) { const r = removeRow('sales', id); if (r) out.push(r.row); } }); return { table: 'sales', rows: out }; },
    'business.restoreMany': (table, rows) => { db.tx(() => { for (const r of rows || []) restoreRow(table, r); }); return true; },
    'business.channels': worldId => db.all(`SELECT channel, count(*) AS n FROM (SELECT channel FROM sales WHERE world_id = ? UNION ALL SELECT channel FROM supporters WHERE world_id = ? UNION ALL SELECT channel FROM coupons WHERE world_id = ?)
      WHERE channel != '' GROUP BY channel ORDER BY n DESC, channel COLLATE NOCASE`, worldId, worldId, worldId).map(r => r.channel),
    'business.products': worldId => products(worldId),

    'business.tiers': worldId => db.all('SELECT * FROM tiers WHERE world_id = ? ORDER BY sort, price_cents', worldId).map(tierRow),
    'business.saveTier': t => saveTier(t),
    'business.removeTier': id => removeRow('tiers', id),
    'business.supporters': (worldId, o = {}) => {
      const where = ['world_id = ?'], vals = [worldId];
      if (o.status) { where.push('status = ?'); vals.push(o.status); }
      if (o.tierId) { where.push('tier_id = ?'); vals.push(o.tierId); }
      return db.all(`SELECT * FROM supporters WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, since DESC, name COLLATE NOCASE`, ...vals).map(supporterRow);
    },
    'business.saveSupporter': s => saveSupporter(s),
    'business.removeSupporter': id => removeRow('supporters', id),
    'business.recurring': worldId => recurring(worldId),

    'business.coupons': worldId => listCoupons(worldId),
    'business.saveCoupon': c => saveCoupon(c),
    'business.removeCoupon': id => removeRow('coupons', id),

    /** reviews for the screen and the published shop: o = { featured, productId } */
    'business.reviews': (worldId, o) => listReviews(worldId, o || {}),
    'business.saveReview': r => saveReview(r),
    'business.removeReview': id => removeRow('reviews', id),

    'business.restore': (table, row) => restoreRow(table, row),
    /** before two products merge: their sales, coupons and reviews follow the one that stays */
    'business.repointProduct': (fromId, intoId) => {
      let n = 0;
      db.tx(() => { for (const t of ['sales', 'coupons', 'reviews']) n += db.run(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`, intoId, fromId).changes || 0; });
      if (n) ctx.changed(['sales', 'coupons', 'reviews'], [intoId]);
      return { n };
    },
    'business.settings': (worldId, p = {}) => {
      const patch = {};
      if (p.currency !== undefined) { const c = cur(p.currency); if (c) patch.currency = c; }
      if (p.revenueGoal !== undefined) patch.revenueGoal = Math.max(0, cents(p.revenueGoal));
      if (p.revenueGoalPeriod !== undefined) patch.revenueGoalPeriod = p.revenueGoalPeriod === 'year' ? 'year' : 'month';
      if (p.revenueGoalRecurring !== undefined) patch.revenueGoalRecurring = !!p.revenueGoalRecurring;
      if (p.revenueGoalLabel !== undefined) patch.revenueGoalLabel = str(p.revenueGoalLabel, 120);
      return ctx.call('worlds.update', worldId, { settings: patch }).settings;
    },

    'business.csvPreview': (worldId, text, o) => csvPreview(worldId, text, o || {}),
    'business.csvImport': (worldId, text, o) => csvImport(worldId, text, o || {}),
    'business.csvExport': (worldId, f) => csvExport(worldId, f || {}),
    'business.openCsv': async () => {
      if (!ctx.dialog) throw new Error('Opening files needs the desktop app.');
      const r = await ctx.dialog.showOpenDialog(ctx.win(), { properties: ['openFile'], filters: [{ name: 'Spreadsheets (CSV, TSV, text)', extensions: ['csv', 'tsv', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = r.filePaths[0], st = fs.statSync(p);
      if (st.size > 40 * 1024 * 1024) throw new Error('That file is larger than 40 MB.');
      return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') };
    },
    'business.exportFile': async (worldId, f) => {
      const text = csvExport(worldId, f || {});
      if (!ctx.dialog) return { text };
      const w = C().world(worldId);
      const res = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: (w.name.replace(/[<>:"/\\|?*]+/g, '') || 'world') + ' sales ' + today() + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (res.canceled || !res.filePath) return null;
      fs.writeFileSync(res.filePath, '﻿' + text, 'utf8');
      return { file: res.filePath, rows: text.split('\r\n').length - 2 };
    },
  };
}

/* ---------------- the example world's shop ---------------- */
function sample(ctx, S) {
  const call = (n, ...a) => ctx.call(n, ...a);
  const W = S.worldId;
  // deterministic "random" so the example looks the same every time
  let seed = 1203;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const d0 = new Date();
  const ago = days => { const d = new Date(d0.getTime() - days * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  call('business.settings', W, { revenueGoal: 60000, revenueGoalPeriod: 'month', revenueGoalLabel: 'Pay for the next cover painting' });

  const tiers = [
    call('business.saveTier', { worldId: W, name: 'Deckhand', price: 300, perks: 'Monthly devlog post\nYour name in the ship\'s log (credits)' , color: '#6fa7d8' }),
    call('business.saveTier', { worldId: W, name: 'Navigator', price: 700, perks: 'Everything for Deckhands\nNew chapters a week early\nHigh-resolution maps', color: '#4fae7d' }),
    call('business.saveTier', { worldId: W, name: 'Harbourmaster', price: 1500, perks: 'Everything for Navigators\nName a tavern, ship or minor saint\nSigned print once a year', color: '#d2a35a' }),
  ];
  const people = [
    ['Ada Fenwick', 'ada@example.org', 2, 'active', 228], ['Bram Ostley', '', 1, 'active', 190], ['Cora Lind', 'cora.lind@example.net', 0, 'active', 160],
    ['Dov Marrin', '', 1, 'active', 140], ['Esme Tull', 'esme@example.com', 0, 'active', 121], ['Fitz Harrow', '', 1, 'paused', 110],
    ['Greta Vane', 'greta@example.org', 2, 'active', 95], ['Hollis Pike', '', 0, 'ended', 200], ['Ilse Moor', 'ilse@example.net', 1, 'active', 64],
    ['Jory Crane', '', 0, 'active', 41], ['Kestrel Ann', 'kes@example.com', 1, 'active', 22], ['Lowen Brack', '', 0, 'active', 9],
  ];
  for (const [name, email, t, status, days] of people) {
    call('business.saveSupporter', { worldId: W, name, email, tierId: tiers[t].id, status, since: ago(days), until: status === 'ended' ? ago(30) : null, channel: 'Membership page',
      note: name === 'Greta Vane' ? 'Named the tavern “The Gull & Grievance”.' : '' });
  }

  const novella = S.e('prodnovella'), maps = S.e('prodmaps');
  const priceOf = (id, d) => { try { const p = ctx.core.full(id).fields.price; return p > 0 ? Math.round(+p) : d; } catch { return d; } };
  const prods = [novella && { id: novella, price: priceOf(novella, 1299) }, maps && { id: maps, price: priceOf(maps, 899) }].filter(Boolean);
  const channels = [['Own shop', .05], ['Itch', .1], ['DriveThru', .3], ['Convention', 0], ['Bookshop', .4]];
  if (prods.length) {
    for (let i = 0; i < 25; i++) {
      const p = prods[i % 3 === 2 && prods[1] ? 1 : 0] || prods[0];
      const [channel, cut] = pick(channels);
      const qty = channel === 'Convention' || channel === 'Bookshop' ? 1 + Math.floor(rnd() * 3) : 1;
      const gross = p.price * qty, fees = Math.round(gross * cut) + (channel === 'Own shop' ? 30 : 0);
      const days = Math.round(240 * Math.pow(1 - i / 25, 1.15)) + Math.floor(rnd() * 6);
      call('business.saveSale', { worldId: W, productId: p.id, date: ago(days), channel, qty, gross, fees,
        buyer: channel === 'Own shop' || channel === 'Itch' ? pick(['m.okafor@example.org', 'reader.tom', 'Saltwife', 'J. Ostrander', 'tidewatcher', 'Penn']) : '',
        coupon: i === 7 || i === 18 ? 'STORMSEASON' : i === 21 ? 'LANTERN10' : '', refund: i === 11, note: i === 11 ? 'Wrong format ordered — refunded.' : '' });
    }
  }
  // the latest few, so this month's goal has something in it
  if (prods.length) {
    call('business.saveSale', { worldId: W, productId: prods[0].id, date: ago(1), channel: 'Own shop', qty: 1, gross: prods[0].price, fees: Math.round(prods[0].price * .05) + 30, buyer: 'harbourlights' });
    call('business.saveSale', { worldId: W, productId: (prods[1] || prods[0]).id, date: ago(3), channel: 'Itch', qty: 2, gross: (prods[1] || prods[0]).price * 2, fees: Math.round((prods[1] || prods[0]).price * .2), coupon: 'LANTERN10' });
  }
  call('business.saveCoupon', { worldId: W, code: 'STORMSEASON', percentOff: 20, productId: novella || null, expires: ago(-45), maxUses: 50, note: 'Autumn storm-season sale, posted in the devlog.' });
  call('business.saveCoupon', { worldId: W, code: 'LANTERN10', amountOff: 200, channel: 'Own shop', maxUses: 100, note: 'Newsletter readers.' });
  call('business.saveCoupon', { worldId: W, code: 'FLOODTIDE', percentOff: 35, productId: maps || null, expires: ago(20), maxUses: 25, uses: 9, note: 'Launch week for the map pack.' });

  const reviews = [
    [novella, 5, 'The Saltmarch feels damp in the hands. I could smell the brine on every page, and Mira is the best witch I have met in years.', 'Rowan B.', 'Own shop', 70, true],
    [novella, 4, 'A slow tide that turns into a flood. The last chapter left me wanting the sequel immediately.', 'Quill & Kettle reviews', 'Blog', 120, true],
    [maps, 5, 'Gorgeous, usable maps. The Gullhaven city sheet has carried three sessions of our campaign already.', 'D. Achterberg', 'DriveThru', 55, true],
    [maps, 4, 'Lovely art and handy keyed areas; I wish the region map came in a hex version too.', 'gm_nightjar', 'Itch', 34, false],
    [novella, 3, 'Beautiful prose, though the politics of the Houses took me a while to follow.', 'L. Marsh', 'Bookshop', 12, false],
  ];
  for (const [pid, rating, text, author, source, days, featured] of reviews) call('business.saveReview', { worldId: W, productId: pid || null, rating, text, author, source, date: ago(days), featured });
}

module.exports = { migrations, handlers, sample };
