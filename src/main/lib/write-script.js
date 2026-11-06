/* Screenplay elements from plain paragraphs (a Fountain-like convention), for stories written in the "script" style.
   UMD: the main process compiles with it and the Write screen loads it to style the page while you type.
   Elements: heading (INT./EXT./EST. or a leading "."), character (a line in capitals, or a leading "@"),
   paren ("(quietly)" after a character or dialogue), dialogue (after a character or paren), transition
   ("CUT TO:" or a leading ">"), centered (">text<"), action (everything else). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBScript = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ELEMENTS = [
    ['heading', 'Scene heading', 'INT. HARBOUR – NIGHT'],
    ['action', 'Action', 'What we see and hear'],
    ['character', 'Character', 'A name in capitals'],
    ['paren', 'Parenthetical', '(quietly)'],
    ['dialogue', 'Dialogue', 'What they say'],
    ['transition', 'Transition', 'CUT TO:'],
  ];
  const HEADING = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
  const TRANSITION = /^(?:[A-Z0-9 '’.-]+ TO:|FADE (?:IN|OUT)[.:]?|FADE TO BLACK\.?|CUT TO BLACK\.?)$/;
  const hasLower = s => /\p{Ll}/u.test(s);
  const hasLetter = s => /\p{L}/u.test(s);

  /** element of one paragraph given the previous paragraph's element */
  function classify(text, prev) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'empty';
    if (/^\.[^.]/.test(t) || HEADING.test(t)) return 'heading';
    if (/^>.*<$/.test(t)) return 'centered';
    if (/^>/.test(t) || TRANSITION.test(t)) return 'transition';
    if (/^@/.test(t)) return 'character';
    if ((prev === 'character' || prev === 'dialogue') && /^\(.*\)$/.test(t)) return 'paren';
    if (prev === 'character' || prev === 'paren') return 'dialogue';
    // a cue: capitals, short, maybe with an extension like (V.O.) or (CONT'D)
    const name = t.replace(/\s*\([^)]*\)\s*$/, '').replace(/\^$/, '').trim();
    if (name && hasLetter(name) && !hasLower(name) && name.length <= 38 && !/[.!?:]$/.test(name)) return 'character';
    return 'action';
  }
  /** classifies a list of paragraph texts in order */
  function classifyAll(texts) {
    let prev = null;
    return texts.map(t => { const k = classify(t, prev); if (k !== 'empty') prev = k; else prev = null; return k; });
  }
  /** the text shown for an element (forcing marks removed, cues and headings in capitals) */
  function display(text, kind) {
    let t = String(text || '');
    if (kind === 'heading') t = t.replace(/^\.(?=[^.])/, '').toUpperCase();
    else if (kind === 'character') t = t.replace(/^@/, '').toUpperCase();
    else if (kind === 'transition') t = t.replace(/^>\s*/, '').toUpperCase();
    else if (kind === 'centered') t = t.replace(/^>\s*/, '').replace(/\s*<$/, '');
    return t;
  }
  /** turns a paragraph's text into the given element (used by the element buttons) */
  function convert(text, kind) {
    let t = String(text || '').replace(/^[.@>]\s*/, '').replace(/\s*<$/, '').trim();
    switch (kind) {
      case 'heading': return HEADING.test(t) ? t.toUpperCase() : 'INT. ' + (t ? t.toUpperCase() : '');
      case 'character': return t.toUpperCase();
      case 'paren': return '(' + t.replace(/^\(|\)$/g, '') + ')';
      case 'transition': return t ? (/TO:$/i.test(t) ? t.toUpperCase() : t.toUpperCase() + ' TO:') : 'CUT TO:';
      case 'dialogue': case 'action': default: return t.replace(/^\(|\)$/g, '');
    }
  }
  return { ELEMENTS, classify, classifyAll, display, convert };
});
