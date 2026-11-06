'use strict';
const crypto = require('crypto');

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 10-character random id (lower-case letters and digits) */
function uid() {
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHA[b[i] % 36];
  return /^[0-9]/.test(s) ? 'x' + s.slice(1) : s;
}
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function J(s, d) { if (s == null || s === '') return d; try { const v = JSON.parse(s); return v == null ? d : v; } catch { return d; } }
const clampStr = (s, n) => String(s == null ? '' : s).slice(0, n);
/** a date value {day, min, prec} from columns, or null */
const dateOf = (day, min, prec) => (day == null ? null : { day, min: min == null ? null : min, prec: prec || 'day' });
const PRECS = ['year', 'month', 'day', 'time'];
function cleanDate(d) {
  if (!d || typeof d !== 'object' || !Number.isFinite(+d.day)) return null;
  return { day: Math.round(+d.day), min: d.min == null || !Number.isFinite(+d.min) ? null : Math.round(+d.min), prec: PRECS.includes(d.prec) ? d.prec : 'day' };
}
const placeholders = n => Array(n).fill('?').join(',');
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
const safeName = s => String(s || 'file').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

module.exports = { uid, now, today, J, clampStr, dateOf, cleanDate, placeholders, slugify, safeName, PRECS };
