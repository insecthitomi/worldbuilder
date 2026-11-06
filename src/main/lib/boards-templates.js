'use strict';
/* Starting layouts for new boards. A template is plain data: cards with a local `ref`, and connectors between refs.
   Coordinates are board units (CSS px at 100 % zoom). All text is original. */

const C = { sun: '#f2c94c', amber: '#f2994a', coral: '#eb5757', rose: '#e06aa8', violet: '#9b7bd8', sky: '#5b8def', teal: '#4fb6b2', moss: '#5fb38a', slate: '#9aa5b1' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** a note's text: a bold first line, then plain lines */
const note = (head, ...lines) => '<p><strong>' + esc(head) + '</strong></p>' + lines.map(l => '<p>' + esc(l) + '</p>').join('');

function plot() {
  const items = [
    { ref: 'title', kind: 'text', x: 0, y: -110, w: 900, h: 70, text: '<h2>Working title — the plot</h2>' },
    { ref: 'a1', kind: 'frame', x: 0, y: 0, w: 470, h: 620, color: C.moss, text: 'Act I · Setup' },
    { ref: 'a2', kind: 'frame', x: 510, y: 0, w: 720, h: 620, color: C.amber, text: 'Act II · Confrontation' },
    { ref: 'a3', kind: 'frame', x: 1270, y: 0, w: 470, h: 620, color: C.coral, text: 'Act III · Resolution' },
    { ref: 'b1', kind: 'note', x: 30, y: 60, w: 200, h: 150, color: C.sun, text: note('Opening image', 'The world before anything breaks. What does a normal day cost the hero?') },
    { ref: 'b2', kind: 'note', x: 240, y: 230, w: 200, h: 150, color: C.amber, text: note('Inciting incident', 'Something arrives that the hero cannot ignore.') },
    { ref: 'b3', kind: 'note', x: 30, y: 420, w: 200, h: 150, color: C.coral, text: note('First turning point', 'A choice that closes the door behind them.') },
    { ref: 'b4', kind: 'note', x: 540, y: 60, w: 200, h: 150, color: C.sun, text: note('Rising trouble', 'Try, fail, try harder. Allies and enemies show their faces.') },
    { ref: 'b5', kind: 'note', x: 770, y: 230, w: 200, h: 150, color: C.violet, text: note('Midpoint', 'A truth comes out and the goal changes shape.') },
    { ref: 'b6', kind: 'note', x: 1000, y: 60, w: 200, h: 150, color: C.sky, text: note('Things fall apart', 'The plan breaks. Somebody pays for it.') },
    { ref: 'b7', kind: 'note', x: 1000, y: 420, w: 200, h: 150, color: C.coral, text: note('Darkest moment', 'All seems lost. What does the hero finally understand?') },
    { ref: 'b8', kind: 'note', x: 1300, y: 60, w: 200, h: 150, color: C.rose, text: note('Climax', 'The final choice, made with everything learned.') },
    { ref: 'b9', kind: 'note', x: 1510, y: 420, w: 200, h: 150, color: C.moss, text: note('Resolution', 'The new normal. Echo the opening image.') },
    { ref: 'q', kind: 'checklist', x: 540, y: 420, w: 240, h: 170, color: C.teal, text: 'Before drafting', data: { items: [{ text: 'Whose story is it?', done: false }, { text: 'What do they want?', done: false }, { text: 'What stands in the way?', done: false }] } },
  ];
  const seq = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
  const links = seq.slice(1).map((r, i) => ({ from: seq[i], to: r, style: { dash: i === 2 || i === 6 ? 'dashed' : '' } }));
  return { items, links };
}

function mindmap() {
  const cx = 0, cy = 0, r = 360;
  const branches = [['Characters', C.coral, 'Who wants what?'], ['Places', C.moss, 'Where does it hurt to stand?'], ['Conflicts', C.amber, 'What cannot both be true?'],
    ['Themes', C.violet, 'What is it really about?'], ['Questions', C.sky, 'What don\'t you know yet?'], ['Images', C.rose, 'Pictures that stick.']];
  const items = [{ ref: 'c', kind: 'note', x: cx - 130, y: cy - 80, w: 260, h: 160, color: C.sun, text: note('Central idea', 'Write the one sentence everything else hangs from.') }];
  const links = [];
  branches.forEach(([label, color, q], i) => {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / branches.length);
    const x = Math.round(cx + Math.cos(a) * r * 1.25 - 100), y = Math.round(cy + Math.sin(a) * r * .8 - 60);
    items.push({ ref: 'b' + i, kind: 'note', x, y, w: 200, h: 120, color, text: note(label, q) });
    links.push({ from: 'c', to: 'b' + i, style: { arrow: 'none', curve: true } });
  });
  return { items, links };
}

function mystery() {
  const items = [
    { ref: 'q', kind: 'note', x: 470, y: 260, w: 260, h: 170, color: C.coral, text: note('What happened?', 'Write the crime as the world believes it happened. Then doubt every word.') },
    { ref: 'fs', kind: 'frame', x: 0, y: 0, w: 420, h: 420, color: C.rose, text: 'Suspects' },
    { ref: 's1', kind: 'note', x: 25, y: 55, w: 175, h: 130, color: C.rose, text: note('Suspect one', 'Motive · means · opportunity') },
    { ref: 's2', kind: 'note', x: 220, y: 55, w: 175, h: 130, color: C.rose, text: note('Suspect two', 'Motive · means · opportunity') },
    { ref: 's3', kind: 'note', x: 25, y: 210, w: 175, h: 130, color: C.rose, text: note('Suspect three', 'Motive · means · opportunity') },
    { ref: 'fe', kind: 'frame', x: 780, y: 0, w: 420, h: 420, color: C.sky, text: 'Evidence' },
    { ref: 'e1', kind: 'note', x: 805, y: 55, w: 175, h: 130, color: C.sky, text: note('Clue', 'Where was it found? Who planted it?') },
    { ref: 'e2', kind: 'note', x: 1000, y: 55, w: 175, h: 130, color: C.sky, text: note('Red herring', 'What makes it convincing?') },
    { ref: 'e3', kind: 'image', x: 805, y: 210, w: 370, h: 180, text: 'Drop a picture of the scene here' },
    { ref: 'fl', kind: 'frame', x: 0, y: 470, w: 420, h: 300, color: C.moss, text: 'Locations' },
    { ref: 'l1', kind: 'note', x: 25, y: 525, w: 175, h: 120, color: C.moss, text: note('Scene of the crime') },
    { ref: 'ft', kind: 'frame', x: 470, y: 470, w: 730, h: 300, color: C.slate, text: 'Timeline' },
    { ref: 't1', kind: 'note', x: 495, y: 525, w: 160, h: 110, color: C.sun, text: note('Before', 'The last normal hour.') },
    { ref: 't2', kind: 'note', x: 710, y: 525, w: 160, h: 110, color: C.amber, text: note('During', 'Who heard what?') },
    { ref: 't3', kind: 'note', x: 925, y: 525, w: 160, h: 110, color: C.coral, text: note('After', 'Who moved first?') },
    { ref: 'open', kind: 'checklist', x: 470, y: 30, w: 260, h: 190, color: C.violet, text: 'Open questions', data: { items: [{ text: 'Who benefits?', done: false }, { text: 'Who is lying, and about what?', done: false }, { text: 'What did the victim know?', done: false }] } },
  ];
  const links = [
    { from: 's1', to: 'q', label: 'motive?', style: { dash: 'dashed' } }, { from: 's2', to: 'e1', label: 'seen with' }, { from: 'e1', to: 'q', label: 'points to' },
    { from: 'e2', to: 's3', label: 'misleads', style: { dash: 'dashed' } }, { from: 't1', to: 't2' }, { from: 't2', to: 't3' }, { from: 'l1', to: 'q', label: 'where' },
  ];
  return { items, links };
}

function mood() {
  const items = [
    { ref: 't', kind: 'text', x: 0, y: -100, w: 760, h: 70, text: '<h2>The feel of it</h2>' },
    { ref: 'f', kind: 'frame', x: 0, y: 0, w: 800, h: 560, color: C.violet, text: 'Pictures' },
  ];
  for (let i = 0; i < 6; i++) items.push({ ref: 'i' + i, kind: 'image', x: 25 + (i % 3) * 255, y: 55 + Math.floor(i / 3) * 245, w: 240, h: 225, text: '' });
  items.push(
    { ref: 'c', kind: 'note', x: 840, y: 0, w: 230, h: 150, color: C.sun, text: note('Colours', 'Three colours that belong here, and one that doesn\'t.') },
    { ref: 'x', kind: 'note', x: 840, y: 175, w: 230, h: 150, color: C.amber, text: note('Textures', 'Rough, wet, salt-cracked, polished…') },
    { ref: 's', kind: 'note', x: 840, y: 350, w: 230, h: 150, color: C.sky, text: note('Sounds & smells', 'What would you notice with your eyes closed?') },
    { ref: 'w', kind: 'text', x: 0, y: 590, w: 800, h: 60, text: '<p><em>Words:</em> list the adjectives you keep reaching for.</p>' },
  );
  return { items, links: [] };
}

function kanban() {
  const cols = [['Ideas', C.slate], ['To do', C.sky], ['Doing', C.amber], ['Done', C.moss]];
  const items = [], links = [];
  cols.forEach(([label, color], i) => items.push({ ref: 'c' + i, kind: 'frame', x: i * 320, y: 0, w: 300, h: 700, color, text: label }));
  items.push(
    { ref: 'n1', kind: 'note', x: 20, y: 55, w: 260, h: 110, color: C.sun, text: note('A loose idea', 'Drag it right when it becomes work.') },
    { ref: 'n2', kind: 'note', x: 340, y: 55, w: 260, h: 110, color: C.sky, text: note('Next thing to write') },
    { ref: 'n3', kind: 'checklist', x: 660, y: 55, w: 260, h: 160, color: C.amber, text: 'In progress', data: { items: [{ text: 'First pass', done: true }, { text: 'Second pass', done: false }] } },
    { ref: 'n4', kind: 'note', x: 980, y: 55, w: 260, h: 110, color: C.moss, text: note('Finished!', 'Celebrate, then archive.') },
  );
  return { items, links };
}

const TEMPLATES = [
  { key: 'blank', label: 'Blank', icon: '▢', purpose: '', desc: 'An empty canvas. Double-click anywhere to start.', build: () => ({ items: [], links: [] }) },
  { key: 'plot', label: 'Three-act plot', icon: '⟿', purpose: 'Plotting', desc: 'Setup, confrontation and resolution with the classic beats.', build: plot },
  { key: 'mindmap', label: 'Mind map', icon: '✺', purpose: 'Mind map', desc: 'One idea in the middle, branches all around.', build: mindmap },
  { key: 'mystery', label: 'Mystery investigation', icon: '⌕', purpose: 'Investigation', desc: 'Suspects, evidence, locations and a timeline, wired together.', build: mystery },
  { key: 'mood', label: 'Mood board', icon: '❖', purpose: 'Mood board', desc: 'Pictures, colours, textures and words for the feel of a place.', build: mood },
  { key: 'kanban', label: 'Kanban', icon: '☰', purpose: 'Planning', desc: 'Ideas → to do → doing → done.', build: kanban },
];

const get = key => TEMPLATES.find(t => t.key === key) || TEMPLATES[0];
const list = () => TEMPLATES.map(t => { const b = t.build(); return { key: t.key, label: t.label, icon: t.icon, purpose: t.purpose, desc: t.desc, preview: { items: b.items.map(i => ({ ref: i.ref, kind: i.kind, x: i.x, y: i.y, w: i.w, h: i.h, color: i.color || '' })), links: b.links.map(l => [l.from, l.to]) } }; });

module.exports = { TEMPLATES, COLORS: C, get, list, note };
