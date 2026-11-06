/* Who may see what: one rule for Share view, exports and the published site.
   Audience ladder private < shared < public; a reveal date hides an entry until the world reaches it;
   secret fields and inline secrets are for the author only. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./richtext.js') : root.WBText);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBKnow = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const RANK = { private: 0, shared: 1, public: 2 };
  const LEVELS = [['private', 'Private', 'Only you'], ['shared', 'Shared', 'Players and readers in Share view and shared exports'], ['public', 'Public', 'Also on your published site']];
  const rank = a => (a in RANK ? RANK[a] : 1);

  /** level: 'author' | 'shared' | 'public'; asOf: world day or null */
  function visible(entry, level, asOf) {
    if (!entry || entry.deletedAt) return false;
    if (level === 'author') return true;
    if (rank(entry.audience) < rank(level)) return false;
    if (entry.revealDay != null && asOf != null && entry.revealDay > asOf) return false;
    return true;
  }
  function fields(type, values, level) {
    if (level === 'author' || !type) return Object.assign({}, values || {});
    const out = {};
    for (const def of type.fields || []) if (!def.secret && values && values[def.key] !== undefined) out[def.key] = values[def.key];
    return out;
  }
  const body = (html, level) => (level === 'author' ? html || '' : T.stripSecrets(html || ''));
  return { RANK, LEVELS, rank, visible, fields, body };
});
