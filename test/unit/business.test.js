'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const CSV = require('../../src/main/lib/business-csv');
const business = require('../../src/main/areas/business');

const day = n => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function world(t) {
  const w = t.call('worlds.create', { name: 'Shopland' });
  const book = t.call('entries.create', { worldId: w.id, typeKey: 'product', title: 'The Salt Heir', fields: { price: 1299, format: 'Ebook' } });
  const maps = t.call('entries.create', { worldId: w.id, typeKey: 'product', title: 'Map Pack', aliases: ['Saltmarch Maps'] });
  return { w, book, maps };
}

test('csv: separators, quotes, money and dates in the spellings shops export', () => {
  assert.equal(CSV.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(CSV.detectDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(CSV.parse('a,b\n"x, y","say ""hi"""\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(CSV.parse('﻿name;note\r\n"two\nlines";ok'), [['name', 'note'], ['two\nlines', 'ok']]);
  assert.equal(CSV.money('19.99'), 1999);
  assert.equal(CSV.money('$1,299.00'), 129900);
  assert.equal(CSV.money('1.299,50 €'), 129950);
  assert.equal(CSV.money('12,5'), 1250);
  assert.equal(CSV.money('1,299'), 129900);
  assert.equal(CSV.money('(4.00)'), -400);
  assert.equal(CSV.money('-3'), -300);
  assert.equal(CSV.money('abc'), null);
  assert.equal(CSV.currencyOf('€12,00'), 'EUR');
  assert.equal(CSV.currencyOf('12.00 GBP'), 'GBP');
  assert.equal(CSV.date('2026-03-04T10:00:00Z'), '2026-03-04');
  assert.equal(CSV.date('04/03/2026', { dayFirst: true }), '2026-03-04');
  assert.equal(CSV.date('04/03/2026'), '2026-04-03');
  assert.equal(CSV.date('25/12/2025'), '2025-12-25');
  assert.equal(CSV.date('Mar 5, 2026'), '2026-03-05');
  assert.equal(CSV.date('5 March 2026'), '2026-03-05');
  assert.equal(CSV.date('45658'), '2025-01-01');
  assert.equal(CSV.date('31/02/2026'), null);
  assert.equal(CSV.detectDayFirst(['01/02/2026', '25/02/2026']), true);
  const m = CSV.guessMapping(['Order Date', 'Item Name', 'Quantity', 'Item Total', 'Processing Fee', 'Net Amount', 'Store', 'Buyer Email', 'Currency', 'Discount Code']);
  assert.deepEqual([m.date, m.product, m.qty, m.gross, m.fees, m.net, m.channel, m.buyer, m.currency, m.coupon], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(CSV.looksLikeHeader(['Date', 'Product', 'Gross']), true);
  assert.equal(CSV.looksLikeHeader(['2026-01-02', 'Book', '9.99']), false);
});

test('sales: net follows gross − fees, refunds stay out of totals, filters narrow', () => {
  const t = make();
  try {
    const { w, book, maps } = world(t);
    const a = t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(2), channel: 'Itch', qty: 1, gross: 1299, fees: 130 });
    assert.equal(a.net, 1169);
    assert.equal(a.productTitle, 'The Salt Heir');
    const b = t.call('business.saveSale', { worldId: w.id, productId: maps.id, date: day(40), channel: 'Convention', qty: 2, gross: 1800, fees: 0, buyer: 'Rowan', coupon: 'lantern10' });
    assert.equal(b.coupon, 'LANTERN10');
    const c = t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(5), channel: 'Itch', gross: 1299, fees: 130 });
    t.call('business.refund', c.id, true);
    const tot = t.call('business.totals', w.id, {});
    assert.equal(tot.count, 2);
    assert.equal(tot.gross, 3099);
    assert.equal(tot.net, 2969);
    assert.equal(tot.refunds.count, 1);
    assert.equal(t.call('business.sales', w.id, { productId: maps.id }).length, 1);
    assert.equal(t.call('business.sales', w.id, { channel: 'Itch' }).length, 2);
    assert.equal(t.call('business.sales', w.id, { from: day(10) }).length, 2);
    assert.equal(t.call('business.sales', w.id, { q: 'rowan' }).length, 1);
    assert.equal(t.call('business.sales', w.id, { refunds: false }).length, 2);
    // editing keeps what isn't given; editing gross recomputes net
    const e = t.call('business.saveSale', { id: a.id, note: 'Bundle' });
    assert.equal(e.net, 1169); assert.equal(e.gross, 1299); assert.equal(e.note, 'Bundle');
    assert.equal(t.call('business.saveSale', { id: a.id, gross: 1500 }).net, 1370);
    // delete → undo
    const gone = t.call('business.removeSale', b.id);
    assert.equal(t.call('business.sales', w.id, {}).length, 2);
    t.call('business.restore', gone.table, gone.row);
    assert.equal(t.call('business.sales', w.id, {}).length, 3);
    // channels for suggestions
    assert.deepEqual(t.call('business.channels', w.id).sort(), ['Convention', 'Itch']);
  } finally { t.done(); }
});

test('summary: months, products, channels, recurring revenue and the goal', () => {
  const t = make();
  try {
    const { w, book, maps } = world(t);
    t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(0), channel: 'Own shop', gross: 1000, fees: 100 });
    t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(1), channel: 'Itch', gross: 2000, fees: 200 });
    t.call('business.saveSale', { worldId: w.id, productId: maps.id, date: day(70), channel: 'Itch', gross: 500, fees: 0 });
    const tier = t.call('business.saveTier', { worldId: w.id, name: 'Navigator', price: 700 });
    const yearly = t.call('business.saveTier', { worldId: w.id, name: 'Patron', price: 12000, period: 'year' });
    t.call('business.saveSupporter', { worldId: w.id, name: 'Ada', tierId: tier.id });
    t.call('business.saveSupporter', { worldId: w.id, name: 'Bram', tierId: yearly.id });
    t.call('business.saveSupporter', { worldId: w.id, name: 'Cora', tierId: tier.id, pledge: 1000 });
    const ended = t.call('business.saveSupporter', { worldId: w.id, name: 'Dov', tierId: tier.id });
    const e2 = t.call('business.saveSupporter', { id: ended.id, status: 'ended' });
    assert.ok(e2.until, 'ending a membership dates it');
    t.call('business.settings', w.id, { revenueGoal: 10000, revenueGoalPeriod: 'month', currency: 'eur' });
    const s = t.call('business.summary', w.id, {});
    assert.equal(s.currency, 'EUR');
    assert.equal(s.totals.net, 900 + 1800 + 500);
    assert.equal(s.mrr, 700 + 1000 + 1000);
    assert.equal(s.recurring.counts.ended, 1);
    assert.ok(s.byMonth.length >= 3);
    assert.equal(s.byMonth.reduce((a, m) => a + m.net, 0), 3200);
    assert.equal(s.byProduct[0].productId, book.id);
    assert.equal(s.byChannel[0].channel, 'Itch');
    assert.equal(s.goal.cents, 10000);
    assert.equal(s.goal.recurring, 2700);
    assert.ok(s.goal.progress >= 2700 && s.goal.fraction > .27);
    // a range compares with the period before it
    const r = t.call('business.summary', w.id, { from: day(30), to: day(0) });
    assert.equal(r.totals.count, 2);
    assert.ok(r.prev && r.prev.count === 0);
    // products carry their ledger
    const p = t.call('business.products', w.id).find(x => x.id === book.id);
    assert.equal(p.sales.count, 2); assert.equal(p.price, 1299); assert.equal(p.format, 'Ebook'); assert.equal(p.trend.length, 12);
  } finally { t.done(); }
});

test('csv import maps columns, matches and creates products, skips re-imports; export reads back', () => {
  const t = make();
  try {
    const { w, book, maps } = world(t);
    const text = [
      'Sale date;Item;Qty;Price;Fee;Platform;Customer;Refunded',
      '03/02/2026;The Salt Heir;1;12,99;1,30;Itch;ann@example.org;',
      '15/02/2026;saltmarch maps;2;17,98;0;Convention;;',
      '16/02/2026;Lantern Charms;1;5,00;0,50;Own shop;;yes',
      'not a date;The Salt Heir;1;12,99;;;;',
    ].join('\n');
    const pv = t.call('business.csvPreview', w.id, text, {});
    assert.equal(pv.delimiter, ';');
    assert.equal(pv.hasHeader, true);
    assert.equal(pv.mapping.date, 0); assert.equal(pv.mapping.product, 1); assert.equal(pv.mapping.gross, 3); assert.equal(pv.mapping.fees, 4); assert.equal(pv.mapping.channel, 5);
    assert.equal(pv.dayFirst, true);
    assert.equal(pv.ok, 3); assert.equal(pv.problemCount, 1);
    assert.deepEqual(pv.products.unknown, ['Lantern Charms']);
    assert.equal(pv.sample[1].productId, maps.id, 'aliases match');
    const r = t.call('business.csvImport', w.id, text, { mapping: pv.mapping });
    assert.equal(r.added, 3); assert.equal(r.createdProducts.length, 1); assert.equal(r.problemCount, 1);
    const list = t.call('business.sales', w.id, { order: 'asc' });
    assert.equal(list[0].date, '2026-02-03'); assert.equal(list[0].gross, 1299); assert.equal(list[0].net, 1169); assert.equal(list[0].productId, book.id);
    assert.equal(list[2].refund, true);
    assert.equal(t.call('business.csvImport', w.id, text, { mapping: pv.mapping }).skipped, 3, 'the same file twice adds nothing');
    const out = t.call('business.csvExport', w.id, {});
    const rows = CSV.parse(out);
    assert.deepEqual(rows[0].slice(0, 7), ['Date', 'Product', 'Channel', 'Quantity', 'Gross', 'Fees', 'Net']);
    assert.equal(rows.length, 4);
    assert.equal(rows[1][4], '12.99');
    // the export imports cleanly into another world
    const w2 = t.call('worlds.create', { name: 'Copy' });
    const r2 = t.call('business.csvImport', w2.id, out, {});
    assert.equal(r2.added, 3);
    assert.equal(t.call('business.totals', w2.id, {}).gross, t.call('business.totals', w.id, {}).gross);
  } finally { t.done(); }
});

test('coupons count their uses from the ledger; reviews filter by featured; deleted products leave sales', () => {
  const t = make();
  try {
    const { w, book } = world(t);
    const c = t.call('business.saveCoupon', { worldId: w.id, code: 'storm season', percentOff: 20, maxUses: 2, productId: book.id });
    assert.equal(c.code, 'STORMSEASON'); assert.equal(c.status, 'live');
    assert.throws(() => t.call('business.saveCoupon', { worldId: w.id, code: 'StormSeason' }), /already/);
    t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(1), gross: 1000, coupon: 'stormseason' });
    t.call('business.saveSale', { worldId: w.id, productId: book.id, date: day(2), gross: 1000, coupon: 'STORMSEASON' });
    const c2 = t.call('business.coupons', w.id)[0];
    assert.equal(c2.used, 2); assert.equal(c2.status, 'used');
    assert.equal(t.call('business.saveCoupon', { id: c.id, maxUses: null, expires: day(3) }).status, 'expired');
    assert.equal(t.call('business.saveCoupon', { id: c.id, expires: null, active: false }).status, 'off');
    t.call('business.saveReview', { worldId: w.id, productId: book.id, rating: 5, text: 'Briny.', author: 'R', featured: true });
    t.call('business.saveReview', { worldId: w.id, productId: book.id, rating: 3, text: 'Slow.' });
    assert.equal(t.call('business.reviews', w.id, {}).length, 2);
    const f = t.call('business.reviews', w.id, { featured: true });
    assert.equal(f.length, 1); assert.equal(f[0].productTitle, 'The Salt Heir');
    assert.equal(t.call('business.products', w.id).find(p => p.id === book.id).rating.avg, 4);
    // merging products (from Checks) keeps the ledger on the survivor
    const twin = t.call('entries.create', { worldId: w.id, typeKey: 'product', title: 'The Salt Heir.' });
    const tsale = t.call('business.saveSale', { worldId: w.id, productId: twin.id, date: day(4), gross: 500 });
    t.call('checks.fix', w.id, { kind: 'merge', into: book.id, from: twin.id });
    assert.equal(t.call('business.sales', w.id, {}).find(x => x.id === tsale.id).productId, book.id);
    t.call('business.removeSale', tsale.id);
    // purging the product keeps the sales without it
    t.call('entries.trash', book.id);
    t.call('entries.purge', book.id);
    const s = t.call('business.sales', w.id, {});
    assert.equal(s.length, 2); assert.equal(s[0].productId, null);
    // world packages carry the ledger
    const copy = t.call('worlds.duplicate', w.id);
    assert.equal(t.call('business.sales', copy.id, {}).length, 2);
    assert.equal(t.call('business.coupons', copy.id).length, 1);
  } finally { t.done(); }
});

test('sample adds a shop, and skips products that are missing', () => {
  const t = make();
  try {
    const { w, book } = world(t);
    const keys = { prodnovella: book.id };
    business.sample(t.ctx, { worldId: w.id, e: k => keys[k] || null, type: () => null, media: () => null, set: () => {} });
    const s = t.call('business.summary', w.id, {});
    assert.equal(t.call('business.tiers', w.id).length, 3);
    assert.equal(t.call('business.supporters', w.id).length, 12);
    assert.equal(t.call('business.coupons', w.id).length, 3);
    assert.equal(t.call('business.reviews', w.id).length, 5);
    assert.ok(s.allTime.count >= 20);
    assert.ok(s.mrr > 0);
    assert.ok(s.goal && s.goal.cents > 0);
    assert.ok(t.call('business.sales', w.id, {}).every(x => x.productId === book.id));
  } finally { t.done(); }
});
