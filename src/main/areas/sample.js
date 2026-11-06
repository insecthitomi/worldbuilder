'use strict';
/* The example world, "The Saltmarch". Core content lives here; every other area adds its part with its own
   sample(ctx, S) hook (maps, lexicon, tables, boards, business…). All text is original. */

const CALENDAR = {
  name: 'Reckoning of Tides',
  months: ['Thaw', 'Brine', 'Gullsong', 'Highsun', 'Saltreap', 'Ember', 'Fogmoon', 'Gale', 'Frostmere', 'Deepwinter'].map(name => ({ name, days: 36 })),
  weekdays: ['Moonday', 'Tideday', 'Saltday', 'Windday', 'Stoneday', 'Restday'],
  weekdayOffset: 0,
  leap: { every: 4, month: 9, days: 1 },
  eras: [{ name: 'Age of Tides', abbr: 'AT', start: 1000 }],
  before: { name: 'Before the Flood', abbr: 'BF' },
  hoursPerDay: 24, minutesPerHour: 60,
  moons: [{ name: 'Pale Mother', cycle: 30, offset: 3 }, { name: 'Red Wanderer', cycle: 47.3, offset: 11, color: '#d0574e' }],
  seasons: [{ name: 'Thawtide', month: 0, day: 1 }, { name: 'High Summer', month: 3, day: 1 }, { name: 'Fogtide', month: 6, day: 1 }, { name: 'The Long Cold', month: 8, day: 1 }],
};
const MONTH = { thaw: 0, brine: 1, gullsong: 2, highsun: 3, saltreap: 4, ember: 5, fogmoon: 6, gale: 7, frostmere: 8, deepwinter: 9 };

function handlers(ctx) {
  // building the sample is not writing: core keeps no revisions and logs no words while it runs (ctx.building),
  // so area hooks can add a believable past of their own
  function build() {
    ctx.building = true;
    try { return buildWorld(); } finally { ctx.building = false; }
  }
  function buildWorld() {
    const C = ctx.core, Cal = require('../../shared/calendar');
    const cal = Cal.create(CALENDAR);
    /** a world date from an Age-of-Tides year (negative = Before the Flood), month name and day */
    const at = (y, m, d) => {
      const abs = y > 0 ? 999 + y : 1000 + y;
      if (m == null) return { day: cal.fromYmd(abs, 0, 1), min: null, prec: 'year' };
      if (d == null) return { day: cal.fromYmd(abs, MONTH[m], 1), min: null, prec: 'month' };
      return { day: cal.fromYmd(abs, MONTH[m], d), min: null, prec: 'day' };
    };
    const created = ctx.call('worlds.create', {
      name: 'The Saltmarch', starter: 'fantasy', calendar: CALENDAR, now: at(1203, 'gale', 14),
      summary: 'A storm-wracked coast of salt flats and drowned towers, where a free port holds out against an inland crown — and something under the sea is waking.',
      settings: { currency: 'USD', mapUnit: 'miles', wordGoal: 600, nameStyle: 'sea', defaultAudience: 'shared' },
    });
    const W = created.id;
    ctx.db.run('UPDATE worlds SET icon = ?, color = ? WHERE id = ?', '≈', '#4fb6b2', W);
    const keys = {};
    const S = { worldId: W, e: k => keys[k] || null, type: k => (C.typeByKey(W, k) || {}).id || null, media: k => keys['media:' + k] || null, set: (k, id) => { keys[k] = id; }, at, cal };
    const add = (k, type, o) => { const e = C.createEntry(Object.assign({ worldId: W, typeKey: type }, o)); keys[k] = e.id; return e; };
    const m = (k, label) => keys[k] ? `<a class="wb-m" data-id="${keys[k]}">${label}</a>` : label;
    const P = (...ps) => ps.map(p => '<p>' + p + '</p>').join('');

    /* ---- places ---- */
    add('saltmarch', 'place', { title: 'The Saltmarch', aliases: ['the March'], summary: 'A hundred miles of grey coast: salt flats, fen and cliff, ground between the sea and the Inland Crown.', fields: { kind: 'Region', population: 48000, climate: 'Cold, wet, wind off the sea nine days in ten', danger: 3, features: ['The Grey Flats', 'Storm Spire', 'The Salt Road'] }, audience: 'public' });
    add('gullhaven', 'place', { title: 'Gullhaven', summary: 'The last free port on the Saltmarch, built on the bones of three older towns.', parentKey: 'saltmarch', fields: { kind: 'City', population: 12400, climate: 'Fog in the mornings, gales in the autumn', danger: 2, features: ['Vey Keep', 'The Sunken Market', 'The Harbour Chain'], rumours: ['The harbour chain was forged from a drowned king\'s anchor.'] }, start: at(5, 'brine', 12), audience: 'public' });
    add('harbour', 'place', { title: 'Gullhaven Harbour', summary: 'Three moles of black stone and a chain that can close the bay.', fields: { kind: 'District', features: ['The Chain House', 'Widow\'s Steps'] } });
    add('sunkenmarket', 'place', { title: 'The Sunken Market', summary: 'A half-flooded market where the Gulls sell what the customs house never sees.', fields: { kind: 'District', danger: 3 } });
    add('veykeep', 'place', { title: 'Vey Keep', summary: 'The seat of House Vey, a squat keep with a bell that rings for drowned sailors.', fields: { kind: 'Building' }, start: at(13, 'gullsong', 1) });
    add('tidewell', 'place', { title: 'Tidewell', summary: 'A drowned town. At low spring tide its bell tower still breaks the water.', fields: { kind: 'Town', population: 0, danger: 4, rumours: ['Its kings were buried with the Tide Crown.'] }, start: at(-212), end: at(102, 'gale', 14) });
    add('greyflats', 'place', { title: 'The Grey Flats', summary: 'Salt pans that run to the horizon and glitter like frost in summer.', fields: { kind: 'Wilderness', danger: 4, climate: 'Blinding in summer, flooded in spring' } });
    add('lanternrock', 'place', { title: 'Lantern Rock', summary: 'The lighthouse on the reef, kept by the Church of the Drowned King.', fields: { kind: 'Landmark' }, start: at(60, 'highsun', 3) });
    add('mirefen', 'place', { title: 'Mirefen', summary: 'A village of stilt houses in the marsh, where people still sing to the tide.', fields: { kind: 'Village', population: 310, danger: 2 } });
    add('stormspire', 'place', { title: 'Storm Spire', summary: 'A drowned tower off the point. Lights were seen in it the night of the great storm.', fields: { kind: 'Landmark', danger: 5 }, end: at(1) });
    add('inlandcrown', 'place', { title: 'Highreach', aliases: ['the Crown city'], summary: 'Capital of the Inland Crown, three hundred miles from any sea.', fields: { kind: 'City', population: 90000 } });

    /* ---- factions ---- */
    add('housevey', 'faction', { title: 'House Vey', summary: 'The harbour lords of Gullhaven, proud, broke and stubborn as their keep.', fields: { kind: 'House', motto: 'We hold the tide', goals: 'Keep Gullhaven free of the Inland Crown and its salt tax.', power: 45, resources: ['The harbour chain', 'Twelve warships (four seaworthy)', 'Old debts'] }, start: at(13), audience: 'public' });
    add('gulls', 'faction', { title: 'The Gulls', summary: 'The smugglers\' guild of Gullhaven. They own the night and half the day.', fields: { kind: 'Guild', motto: 'Every tide pays', goals: 'Keep the salt road open and the customs house blind.', power: 60, agenda: 'Tamsin wants the Tide Crown, to sell it to the Crown for a charter of her own.' }, start: at(1150) });
    add('saltwardens', 'faction', { title: 'The Saltwardens', summary: 'An old guild of salt cutters who know every pan and sinkhole of the flats.', fields: { kind: 'Guild', goals: 'Keep the salt rights their grandmothers bled for.', power: 30 }, start: at(340) });
    add('drownedchurch', 'faction', { title: 'Church of the Drowned King', summary: 'Priests who keep the lights and say the sea is a sleeping god.', fields: { kind: 'Church', goals: 'Keep the god asleep. Or wake him — depending on whom you ask.', power: 35, agenda: 'A faction inside the church believes the storm of 1203 was the first stirring.' }, start: at(2) });
    add('crown', 'faction', { title: 'The Inland Crown', summary: 'The kingdom of the dry interior, hungry for a sea port and the salt beneath the flats.', fields: { kind: 'Nation', goals: 'Annex the Saltmarch and its salt.', power: 85 }, start: at(-640) });

    /* ---- species, items, lore, cultures, language ---- */
    add('merrowfolk', 'species', { title: 'Merrowfolk', summary: 'Grey-skinned sea people who trade pearls for iron and never say their true names.', fields: { kind: 'People', lifespan: 300, size: 'Medium', diet: 'Fish, kelp, iron (as a delicacy)', traits: ['Breathe water and air', 'Cannot cross running fresh water'], danger: 2 } });
    add('saltwyrm', 'species', { title: 'Salt Wyrm', aliases: ['Brinejaw'], summary: 'A blind serpent of the flats that swims through salt crust as if it were water.', fields: { kind: 'Monster', size: 'Huge', diet: 'Anything that stops moving', traits: ['Senses footsteps', 'Breaks through salt crust'], danger: 5, stats: [{ label: 'hp', value: '84' }, { label: 'ac', value: '15' }, { label: 'init', value: '+1' }, { label: 'Bite', value: '2d10+5' }] } });
    add('tidecrown', 'item', { title: 'The Tide Crown', summary: 'The drowned crown of Tidewell\'s kings. Whoever wears it is said to command the tides.', fields: { kind: 'Relic', properties: ['Calms or raises the sea within sight', 'Cold as deep water'], value: 'Priceless', curse: 'It does not command the tide — it bargains with the Drowned King, who always collects. It drowned Tidewell.' }, start: at(-300), revealDay: at(1204, 'thaw', 1).day });
    add('lanternlens', 'item', { title: 'The Lantern Lens', summary: 'The great green glass lens of Lantern Rock. No one remembers who ground it.', fields: { kind: 'Relic', properties: ['Throws light forty miles', 'Shows drowned things in its beam'] }, start: at(60) });
    add('drownedking', 'lore', { title: 'The Drowned King', summary: 'The god asleep beneath the sea, who keeps every drowned soul as a subject.', fields: { category: 'Deity', origin: 'Older than the Flood', rules: ['The drowned belong to him', 'Bells keep him sleeping', 'A promise to the sea must be kept'], truth: 'He is not asleep. He is waiting for a crowned heir of Tidewell to come home.' }, audience: 'public' });
    add('tidemagic', 'lore', { title: 'Tide-singing', summary: 'Marsh magic: songs that ask the tide for favours. The tide always asks something back.', fields: { category: 'Magic', origin: 'Mirefen', rules: ['Only works within sound of the sea', 'Stronger at spring tides', 'Cannot raise the dead, only hear them'], cost: 'A memory, chosen by the sea' } });
    add('saltlaw', 'lore', { title: 'Salt Law', summary: 'The old law of the flats: salt belongs to whoever cut it, and the sea takes a tithe.', fields: { category: 'Law', origin: 'The Saltwardens\' charter' } });
    add('marchfolk', 'culture', { title: 'Marchfolk', summary: 'The people of the Saltmarch: blunt, superstitious, generous to strangers in a storm.', fields: { values: ['Hospitality in bad weather', 'Paying debts to the sea', 'Mockery of inland manners'], customs: 'Every house hangs a bell at the door to keep the drowned from wandering in. Children are named after the tide they were born on.', food: 'Smoked eel, salt bread, kelp beer', naming: 'A given name and a family or place name; nicknames from the sea are common.', names_given: ['Mira', 'Ysolde', 'Tamsin', 'Corwin', 'Brannoc', 'Wren', 'Fenn', 'Oskar', 'Elsabet', 'Aldous', 'Merrow', 'Halloran', 'Isolde', 'Kester', 'Morwen', 'Jory', 'Tressa', 'Gwen', 'Lowen', 'Pasco', 'Demelza', 'Bryok', 'Senara', 'Talan'], names_family: ['Vey', 'Saltborn', 'Reed', 'Marrow', 'Penhallow', 'Trevail', 'Kellow', 'Tresize', 'Gullsby', 'Tidewater', 'Brine', 'Polglaze'] }, audience: 'public' });
    add('inlanders', 'culture', { title: 'Inlanders', summary: 'People of the Crown: tidy, devout, and convinced the sea is a mistake.', fields: { values: ['Order', 'Lineage', 'Dry feet'], names_given: ['Aldric', 'Cedric', 'Edwyn', 'Godwin', 'Leofric', 'Osric', 'Aethelin', 'Hilde', 'Mildreth', 'Rowena', 'Wynne', 'Eadgyth'], names_family: ['of Highreach', 'Ashford', 'Dunmere', 'Holloway', 'Wainwright'] } });
    add('saltspeak', 'language', { title: 'Saltspeak', aliases: ['the old March tongue'], summary: 'The old language of the coast, now mostly songs, curses and place names.', fields: { family: 'Coastal', script: 'Notched tally-runes on driftwood', status: 'Dying', features: 'Verbs come last; the sea has its own grammatical gender.' } });

    /* ---- characters ---- */
    add('aldous', 'character', { title: 'Aldous Vey', summary: 'The lord who chained the harbour. Remembered fondly by people who never met him.', fields: { pronouns: 'he/him', occupation: 'Lord of Gullhaven', status: 'Dead', goals: 'Build walls the sea respected.' }, start: at(1110, 'brine', 2), end: at(1170, 'frostmere', 8) });
    add('brannoc', 'character', { title: 'Brannoc Vey', aliases: ['Lord Vey', 'the Old Lord'], summary: 'Lord of Gullhaven. Seventy winters, a cough, and no intention of dying before the Crown does.', fields: { pronouns: 'he/him', occupation: 'Lord of Gullhaven', status: 'Alive', personality: 'Proud, funny when he forgets to be proud, cruel when frightened.', goals: 'Hand his son a free city.', fears: 'That his son is not his son.', flaw: 'Pride', voice: 'Speaks in ledgers and tides.', secret: 'He has always known about Corwin. He chose to love him anyway — and has never said so.', stats: [{ label: 'hp', value: '9' }, { label: 'ac', value: '10' }, { label: 'init', value: '-1' }] }, start: at(1133, 'highsun', 20), audience: 'public' });
    add('elsabet', 'character', { title: 'Elsabet Vey', aliases: ['Elsabet Marrow'], summary: 'Late Lady of Gullhaven, who ran the harbour better than her husband and let him think otherwise.', fields: { pronouns: 'she/her', occupation: 'Lady of Gullhaven', status: 'Dead' }, start: at(1150, 'thaw', 30), end: at(1190, 'fogmoon', 3) });
    add('corwin', 'character', { title: 'Corwin Vey', summary: 'Heir to Gullhaven, charming, indebted to smugglers, and hiding the one thing he doesn\'t know.', fields: { pronouns: 'he/him', occupation: 'Heir of House Vey', status: 'Alive', goals: 'Pay off the Gulls before his father finds out.', fears: 'Being found ordinary.', flaw: 'Wants to be liked', secret: 'His father is Captain Halloran.', stats: [{ label: 'hp', value: '18' }, { label: 'ac', value: '13' }, { label: 'init', value: '+2' }] }, start: at(1176, 'gale', 1) });
    add('ysolde', 'character', { title: 'Ysolde Vey', summary: 'Captain of the Gull\'s Wake and the only Vey the sailors trust.', fields: { pronouns: 'she/her', occupation: 'Ship\'s captain', status: 'Alive', goals: 'Find what drowned her mother\'s brother off Storm Spire.', fears: 'Deep water at night.', flaw: 'Stubborn', voice: 'Short sentences, long silences.', stats: [{ label: 'hp', value: '24' }, { label: 'ac', value: '14' }, { label: 'init', value: '+3' }] }, start: at(1179, 'gullsong', 17) });
    add('wren', 'character', { title: 'Wren Vey', summary: 'Ysolde\'s daughter, four years old, who talks to the bells.', fields: { pronouns: 'she/her', status: 'Alive' }, start: at(1199, 'thaw', 5) });
    add('mira', 'character', { title: 'Mira Saltborn', aliases: ['the Witch of Mirefen'], summary: 'A tide-witch who can hear the drowned — and lately they have been calling her by a title.', fields: { pronouns: 'she/her', occupation: 'Tide-witch', status: 'Alive', personality: 'Warm, dry, frighteningly honest.', goals: 'Learn why the drowned call her "Highness".', fears: 'Forgetting her mother — the tide has taken three memories already.', flaw: 'Trusts the sea more than people', secret: 'She is the last of Tidewell\'s royal line.', stats: [{ label: 'hp', value: '16' }, { label: 'ac', value: '11' }, { label: 'init', value: '+1' }] }, start: at(1171, 'thaw', 9) });
    add('tamsin', 'character', { title: 'Tamsin Reed', aliases: ['Queen of Gulls'], summary: 'Leader of the Gulls. She smiles like a knife and keeps every promise she makes.', fields: { pronouns: 'she/her', occupation: 'Smuggler queen', status: 'Alive', goals: 'A royal charter — and the Tide Crown to buy it with.', flaw: 'Ambition', stats: [{ label: 'hp', value: '22' }, { label: 'ac', value: '15' }, { label: 'init', value: '+4' }] }, start: at(1168, 'ember', 22) });
    add('tamsin2', 'character', { title: 'Tamsin Reede', summary: 'Smuggler? (written down from a tavern rumour)', fields: {} });
    add('oskar', 'character', { title: 'Brother Oskar', summary: 'Keeper of Lantern Rock for forty years. He heard the god turn over in his sleep.', fields: { pronouns: 'he/him', occupation: 'Priest of the Drowned King', status: 'Dead' }, start: at(1150, 'deepwinter', 2), end: at(1201, 'brine', 20) });
    add('fenn', 'character', { title: 'Fenn', summary: 'A street child who runs messages for the Gulls and knows every drain in Gullhaven.', fields: { pronouns: 'they/them', occupation: 'Runner', status: 'Alive' }, start: at(1191) });
    add('halloran', 'character', { title: 'Captain Halloran', summary: 'Captain of the harbour guard, loyal to House Vey past the point of sense.', fields: { pronouns: 'he/him', occupation: 'Captain of the guard', status: 'Alive', secret: 'Corwin is his son. He promised Elsabet he would never tell.', stats: [{ label: 'hp', value: '30' }, { label: 'ac', value: '16' }, { label: 'init', value: '+1' }] }, start: at(1150, 'saltreap', 4) });
    add('merrow', 'character', { title: 'Old Merrow', summary: 'The eldest Saltwarden, who has buried two husbands and three Crown tax collectors.', fields: { pronouns: 'she/her', occupation: 'Saltwarden elder', status: 'Alive' }, start: at(1131) });

    /* ---- events ---- */
    add('flood', 'event', { title: 'The Great Flood', summary: 'The sea rose in a night and drowned the old coast. The Age of Tides began.', fields: { kind: 'Disaster', outcome: 'The old coast drowned; Storm Spire and a dozen towns were lost.', significance: 5, truth: 'Tidewell\'s queen bargained with the Drowned King to save her city. The sea took everything else.' }, start: at(1, 'thaw', 1), audience: 'public' });
    add('foundinggull', 'event', { title: 'The Founding of Gullhaven', summary: 'Survivors from three drowned towns raised a harbour on the new shore.', fields: { kind: 'Founding', significance: 4 }, start: at(5, 'brine', 12) });
    add('drowningtidewell', 'event', { title: 'The Drowning of Tidewell', summary: 'A storm surge took Tidewell, its kings and its crown in a single night.', fields: { kind: 'Disaster', significance: 5 }, start: at(102, 'gale', 14) });
    add('wedding', 'event', { title: 'The Wedding of Brannoc and Elsabet', summary: 'The last great feast in Vey Keep, remembered for a gale that blew the roof off the hall.', fields: { kind: 'Festival', significance: 2 }, start: at(1174, 'highsun', 20) });
    add('saltwar', 'event', { title: 'The Salt War', summary: 'Two years of raids when the Crown tried to tax the flats. Gullhaven held; the eastern pans were lost.', fields: { kind: 'War', outcome: 'House Vey kept Gullhaven and the harbour; the Crown took the eastern flats.', significance: 4 }, start: at(1186, 'saltreap', 2), end: at(1188, 'ember', 30), audience: 'public' });
    add('storm1203', 'event', { title: 'The Storm of 1203', summary: 'Four days of gale. On the third night, lights burned inside Storm Spire.', fields: { kind: 'Disaster', significance: 4 }, start: at(1203, 'fogmoon', 30), end: at(1203, 'gale', 2) });

    /* ---- stories ---- */
    add('novella', 'story', { title: 'The Salt Heir', summary: 'A drowned tower lights up, and the heir of a free city learns that everything he owes is owed to the sea.', fields: { genre: 'Coastal fantasy', logline: 'When lights burn inside a drowned tower, a smuggling heir, his sea-captain sister and a tide-witch race the Inland Crown to the crown that drowned a kingdom.', target: 40000, stage: 'Drafting', themes: ['Debt', 'Inheritance', 'What we owe the dead'] } });
    add('ch1', 'chapter', { title: 'Lights on Storm Spire', fields: { status: 'Revised', target: 6000 } });
    add('ch2', 'chapter', { title: 'The Ledger of Gulls', fields: { status: 'Draft', target: 6000 } });
    add('ch3', 'chapter', { title: 'What the Tide Owes', fields: { status: 'Idea', target: 6000 } });
    add('s1', 'scene', { title: 'Lights at Sea', fields: { status: 'Revised', target: 1500, goal: 'Ysolde wants to sail out to the lights.', conflict: 'Halloran orders the harbour chain closed.', outcome: 'She goes anyway.' }, start: at(1203, 'gale', 1) });
    add('s2', 'scene', { title: 'The Witch of Mirefen', fields: { status: 'Draft', target: 1500, goal: 'Mira wants to quiet the voices.', conflict: 'Fenn arrives with a message from the Gulls.', outcome: 'Mira agrees to meet Tamsin.' }, start: at(1203, 'gale', 3) });
    add('s3', 'scene', { title: 'Under the Sunken Market', fields: { status: 'Draft', target: 1800, goal: 'Corwin wants more time to pay.', conflict: 'Tamsin wants a map to Tidewell instead.', outcome: 'He promises a map he does not have.' }, start: at(1203, 'gale', 6) });
    add('s4', 'scene', { title: 'The Lord\'s Ledger', fields: { status: 'Draft', target: 1500 }, start: at(1203, 'gale', 7) });
    add('s5', 'scene', { title: 'Prayers at Lantern Rock', fields: { status: 'Idea', target: 1500 }, start: at(1203, 'gale', 10) });
    add('s6', 'scene', { title: 'The Door in the Spire', fields: { status: 'Idea', target: 2000 }, start: at(1203, 'gale', 13) });
    add('plotheir', 'plot', { title: 'The Heir\'s Secret', summary: 'Corwin is not Brannoc\'s son. Who knows, and what happens when he finds out?', fields: { status: 'Active', stakes: 'If the Crown learns it, House Vey has no lawful heir and Gullhaven falls to the Crown.', clues: ['Halloran\'s ring on Corwin\'s chain', 'Elsabet\'s unsent letter', 'Brannoc\'s ledger entry for the midwife'], resolution: 'Brannoc names Corwin heir in public, knowing everything — then dies the same night.' }, audience: 'private' });
    add('plotcrown', 'plot', { title: 'Whoever Wears the Tide Crown', summary: 'Everyone wants the crown. Nobody knows what it costs.', fields: { status: 'Seed', stakes: 'The sea rises again.' } });

    /* ---- maps, boards, campaign, notes, posts, products ---- */
    add('mapsaltmarch', 'map', { title: 'The Saltmarch', summary: 'The region map: coast, flats, fen and the Salt Road.', fields: { kind: 'Region' } });
    add('mapgullhaven', 'map', { title: 'Gullhaven', summary: 'The city: harbour, keep, market and walls.', fields: { kind: 'City' } });
    add('boardplot', 'board', { title: 'Plotting The Salt Heir', fields: { purpose: 'Plotting' } });
    add('encwyrm', 'encounter', { title: 'Salt Wyrm on the Flats', summary: 'The crust cracks under the cart. Something blind is listening.', fields: { difficulty: 'Hard', treasure: ['A Crown tax-seal in the wyrm\'s gullet', '40 silver gulls'], tactics: 'It surfaces under the heaviest creature and drags it down; it flees from bells.' } });
    add('session1', 'session', { title: 'Session 1 — The Lights at Sea', summary: 'The party arrives in Gullhaven the night of the storm.', fields: { number: 1, played: '2026-10-03', players: ['Sam (Ysolde)', 'Priya (Mira)', 'Jonah (Fenn)'], loot: ['A wet map of the Spire'], xp: 300 }, start: at(1203, 'gale', 1) });
    add('session2', 'session', { title: 'Session 2 — The Ledger of Gulls', summary: 'Debts, smugglers and a deal under the market.', fields: { number: 2, played: '2026-10-17', players: ['Sam (Ysolde)', 'Priya (Mira)', 'Jonah (Fenn)'], xp: 450, prep: 'Tamsin offers the job; Halloran tails them.' }, start: at(1203, 'gale', 5), end: at(1203, 'gale', 6) });
    add('idea1', 'note', { title: 'What if the lighthouse lens is a shard of the Tide Crown?', body: P('It would explain why the lens shows drowned things. Maybe the first keeper stole it.'), inbox: true });
    add('idea2', 'note', { title: 'Salt Wyrm nickname: “Brinejaw”?', body: P('Heard it in my head in Saltspeak. Check the lexicon for a better word.'), inbox: true });
    add('post1', 'post', { title: 'Welcome to the Saltmarch', summary: 'Why I\'m building a coast that drowns.', fields: { publish: '2026-09-20', status: 'Published', audience_tier: 'Everyone', excerpt: 'Every world I build starts with a place I would not want to live. This time it\'s a coast.' }, audience: 'public' });
    add('post2', 'post', { title: 'Mapping Gullhaven', summary: 'How the city map came together, mole by mole.', fields: { publish: '2026-11-12', status: 'Scheduled', audience_tier: 'Supporters' }, audience: 'public' });
    add('prodnovella', 'product', { title: 'The Salt Heir (ebook)', summary: 'The first Saltmarch novella.', fields: { price: 499, format: 'Ebook', link: 'https://example.com/the-salt-heir', status: 'Available', released: '2026-10-01', blurb: 'A drowned tower lights up. An heir owes smugglers. The sea remembers.' }, audience: 'public' });
    add('prodmaps', 'product', { title: 'Saltmarch Map Pack', summary: 'Region and city maps, print-ready, with a GM key.', fields: { price: 1200, format: 'Map pack', link: 'https://example.com/saltmarch-maps', status: 'Available', released: '2026-09-28' }, audience: 'public' });

    /* ---- hierarchy ---- */
    const parent = (k, p) => { if (keys[k] && keys[p]) ctx.db.run('UPDATE entries SET parent_id = ? WHERE id = ?', keys[p], keys[k]); };
    for (const k of ['gullhaven', 'tidewell', 'greyflats', 'lanternrock', 'mirefen', 'stormspire']) parent(k, 'saltmarch');
    for (const k of ['harbour', 'sunkenmarket', 'veykeep']) parent(k, 'gullhaven');
    for (const k of ['ch1', 'ch2', 'ch3']) parent(k, 'novella');
    parent('s1', 'ch1'); parent('s2', 'ch1'); parent('s3', 'ch2'); parent('s4', 'ch2'); parent('s5', 'ch3'); parent('s6', 'ch3');
    parent('mapgullhaven', 'mapsaltmarch');
    ['ch1', 'ch2', 'ch3'].forEach((k, i) => ctx.db.run('UPDATE entries SET position = ? WHERE id = ?', i + 1, keys[k]));
    ['s1', 's2', 's3', 's4', 's5', 's6'].forEach((k, i) => ctx.db.run('UPDATE entries SET position = ? WHERE id = ?', (i % 2) + 1, keys[k]));

    /* ---- reference fields (second pass, now that everything exists) ---- */
    const F = (k, f) => C.updateEntry(keys[k], { fieldsPatch: f });
    F('gullhaven', { ruler: keys.brannoc });
    F('housevey', { leader: keys.brannoc, seat: keys.veykeep });
    F('gulls', { leader: keys.tamsin, seat: keys.sunkenmarket });
    F('saltwardens', { leader: keys.merrow, seat: keys.greyflats });
    F('drownedchurch', { leader: keys.oskar, seat: keys.lanternrock });
    F('crown', { seat: keys.inlandcrown });
    F('merrowfolk', { habitat: [keys.saltmarch] });
    F('saltwyrm', { habitat: [keys.greyflats] });
    F('tidecrown', { origin: keys.tidewell });
    F('lanternlens', { origin: keys.lanternrock, owner: keys.drownedchurch });
    F('drownedking', { believers: [keys.marchfolk, keys.drownedchurch] });
    F('marchfolk', { language: keys.saltspeak, homeland: [keys.saltmarch] });
    F('inlanders', { homeland: [keys.inlandcrown] });
    F('saltspeak', { speakers: [keys.marchfolk] });
    for (const k of ['brannoc', 'elsabet', 'corwin', 'ysolde', 'wren', 'aldous']) F(k, { culture: keys.marchfolk, allegiance: [keys.housevey], home: keys.veykeep });
    F('mira', { culture: keys.marchfolk, home: keys.mirefen });
    F('tamsin', { culture: keys.marchfolk, allegiance: [keys.gulls], home: keys.sunkenmarket });
    F('fenn', { culture: keys.marchfolk, allegiance: [keys.gulls], home: keys.gullhaven });
    F('oskar', { culture: keys.marchfolk, allegiance: [keys.drownedchurch], home: keys.lanternrock });
    F('halloran', { culture: keys.marchfolk, allegiance: [keys.housevey], home: keys.harbour });
    F('merrow', { culture: keys.marchfolk, allegiance: [keys.saltwardens], home: keys.greyflats });
    F('flood', { participants: [], location: keys.saltmarch });
    F('foundinggull', { location: keys.gullhaven });
    F('drowningtidewell', { location: keys.tidewell });
    F('wedding', { location: keys.veykeep, participants: [keys.brannoc, keys.elsabet] });
    F('saltwar', { location: keys.greyflats, participants: [keys.housevey, keys.crown, keys.saltwardens, keys.brannoc] });
    F('storm1203', { location: keys.stormspire });
    F('novella', { pov: keys.corwin });
    F('s1', { pov: keys.ysolde, location: keys.harbour, cast: [keys.ysolde, keys.halloran], threads: [keys.plotcrown] });
    F('s2', { pov: keys.mira, location: keys.mirefen, cast: [keys.mira, keys.fenn] });
    F('s3', { pov: keys.corwin, location: keys.sunkenmarket, cast: [keys.corwin, keys.tamsin, keys.fenn], threads: [keys.plotheir, keys.plotcrown] });
    F('s4', { pov: keys.brannoc, location: keys.veykeep, cast: [keys.brannoc, keys.corwin, keys.halloran], threads: [keys.plotheir] });
    // a deliberate continuity mistake: Brother Oskar died in 1201 but is in this 1203 scene
    F('s5', { pov: keys.mira, location: keys.lanternrock, cast: [keys.mira, keys.oskar, keys.ysolde] });
    F('s6', { pov: keys.ysolde, location: keys.stormspire, cast: [keys.ysolde, keys.mira, keys.corwin], threads: [keys.plotcrown] });
    F('plotheir', { giver: keys.halloran });
    F('encwyrm', { location: keys.greyflats, foes: [keys.saltwyrm] });
    F('session1', { npcs: [keys.halloran, keys.brannoc], places: [keys.gullhaven, keys.harbour] });
    F('session2', { npcs: [keys.tamsin, keys.fenn], places: [keys.sunkenmarket] });
    F('prodnovella', { work: keys.novella });
    F('prodmaps', { work: keys.mapsaltmarch });

    /* ---- bodies with mentions ---- */
    const B = (k, html) => C.updateEntry(keys[k], { body: html });
    B('saltmarch', P(`The Saltmarch is the grey edge of the world: salt flats that run to the horizon, fens where the houses stand on stilts, and a coast of black cliffs that the sea has been eating since ${m('flood', 'the Great Flood')}.`,
      `Its one city is ${m('gullhaven', 'Gullhaven')}, a free port that has kept ${m('crown', 'the Inland Crown')} out for two hundred years by being too stubborn and too poor to conquer. Out on ${m('greyflats', 'the Grey Flats')}, ${m('saltwardens', 'the Saltwardens')} cut salt by the old ${m('saltlaw', 'Salt Law')} and listen for the ${m('saltwyrm', 'Salt Wyrm')}.`,
      `<span class="wb-s">The March is sinking — a hand's breadth a generation. Only the Church knows, and it is not telling.</span>`));
    B('gullhaven', '<h2>The free port</h2>' + P(`Gullhaven was founded by survivors of three drowned towns after ${m('flood', 'the Flood')}. ${m('aldous', 'Aldous Vey')} chained its harbour; his son ${m('brannoc', 'Brannoc')} keeps it shut against the Crown's tax ships.`,
      `The city climbs from ${m('harbour', 'the harbour')} to ${m('veykeep', 'Vey Keep')}. Under the old fish hall lies ${m('sunkenmarket', 'the Sunken Market')}, where ${m('gulls', 'the Gulls')} trade at low tide.`) +
      '<h3>Customs</h3><ul><li>Every door has a bell for the drowned.</li><li>Debts are paid on the spring tide or not at all.</li><li>No one whistles on the moles.</li></ul>' +
      '<h3>Harbour fees</h3><table><thead><tr><th>Vessel</th><th>Fee</th><th>Notes</th></tr></thead><tbody><tr><td>Fishing boat</td><td>1 gull a week</td><td>Free in a gale</td></tr><tr><td>Coaster</td><td>6 gulls a day</td><td>Inspected at the Chain House</td></tr><tr><td>Crown ship</td><td>40 gulls a day</td><td>Rarely paid. Never refused.</td></tr></tbody></table>' +
      `<aside class="wb-note">The harbour chain closes at dusk in a gale. Ships caught outside take their chances at ${m('lanternrock', 'Lantern Rock')}.</aside>`);
    B('housevey', P(`House Vey has held ${m('gullhaven', 'Gullhaven')} since the founding. Its lords are buried at sea, its ladies in the keep's bell tower.`,
      `Today the house is ${m('brannoc', 'Brannoc')}, old and ill; his heir ${m('corwin', 'Corwin')}; his daughter ${m('ysolde', 'Ysolde')}, who actually commands the fleet; and little ${m('wren', 'Wren')}.`,
      `<span class="wb-s">The house is three years from bankruptcy and Corwin owes the Gulls more than the keep is worth.</span>`));
    B('mira', P(`Mira grew up in ${m('mirefen', 'Mirefen')} among tide-singers and learned ${m('tidemagic', 'tide-singing')} before she could read. Since ${m('storm1203', 'the storm')} the drowned have been speaking to her in ${m('saltspeak', 'Saltspeak')}, and they call her "Highness".`,
      `She does not want a crown. She wants her memories back.`));
    B('tidecrown', P(`The crown of ${m('tidewell', 'Tidewell')}'s kings: a circlet of green bronze set with pearls the size of eyes. It went down with the city in ${m('drowningtidewell', 'the Drowning')}.`,
      `${m('tamsin', 'Tamsin Reed')} wants it. ${m('crown', 'The Crown')} wants it. ${m('drownedking', 'The Drowned King')} wants it worn.`));
    B('drownedking', P(`The Marchfolk say the sea is a king who drowned and kept the throne. Every drowned soul is his subject; every bell keeps him dreaming.`,
      `${m('drownedchurch', 'His church')} keeps the light at ${m('lanternrock', 'Lantern Rock')} so that ships — and he — know where the land is.`));
    B('saltwar', P(`When the Crown taxed the salt, ${m('saltwardens', 'the Saltwardens')} refused and ${m('housevey', 'House Vey')} backed them. Two years of raids followed across ${m('greyflats', 'the flats')}.`,
      `The peace left Gullhaven free and the eastern pans in Crown hands. ${m('brannoc', 'Brannoc')} has called it a victory every day since.`));
    B('flood', P(`In one night the sea rose forty feet. Whole towns went under, ${m('stormspire', 'Storm Spire')} among them. The calendar begins again on that morning: year one of the Age of Tides.`));
    B('corwin', P(`Corwin is everybody's favourite and nobody's choice. He owes ${m('gulls', 'the Gulls')} for a ship that sank, a house that burned and a debt he took to cover the first two.`,
      `<span class="wb-s">He wears a ring on a chain that ${m('halloran', 'Halloran')} gave his mother.</span>`));
    B('s1', P(`The lights came on at the second bell. ${m('ysolde', 'Ysolde')} saw them from the mole: green, low, steady, burning in the windows of a tower that had been underwater for twelve hundred years.`,
      `"Chain's closing," said ${m('halloran', 'Halloran')} behind her. He did not ask her not to go. He had known her too long.`,
      `She went down the Widow's Steps two at a time.`));
    B('s2', P(`The voices were worse at high water. ${m('mira', 'Mira')} sang them quiet the way her grandmother had taught her, low and tuneless, and the drowned listened, mostly.`,
      `Then the door bell rang, though the wind had dropped, and ${m('fenn', 'Fenn')} stood dripping on the stilt-walk with a gull feather in their hat.`,
      `"Queen of Gulls wants a word," they said. "Says it's about a crown."`));
    B('s3', P(`Under the fish hall the water came up to the second step. ${m('tamsin', 'Tamsin')} sat on a crate of Crown salt with her boots dry and a ledger open on her knee.`,
      `"I don't want your money, ${m('corwin', 'Corwin')}," she said. "I want a map of ${m('tidewell', 'Tidewell')}."`,
      `He had never seen one. He said, "Done," because it was what she wanted to hear.`));
    B('s4', P(`${m('brannoc', 'Brannoc')} kept his own ledger, in a hand that shook now. He showed ${m('corwin', 'Corwin')} the page for the year he was born.`,
      `<span class="wb-s">The midwife's fee was paid twice: once by the house, once by ${m('halloran', 'Halloran')}.</span>`));
    B('s5', P(`The lens turned. In its green light ${m('mira', 'Mira')} saw the drowned standing on the water in rows, like a congregation.`,
      `${m('oskar', 'Brother Oskar')} lit the second lamp and said the old prayer, and the rows bowed to her.`));
    B('plotheir', P(`Seed it in ${m('s3', 'Under the Sunken Market')}; pay it off in chapter three. ${m('halloran', 'Halloran')} must choose between his oath to Elsabet and the city.`));
    B('session1', '<h3>Recap</h3>' + P(`The party arrived on the night of ${m('storm1203', 'the storm')}. ${m('halloran', 'Halloran')} tried to keep them in harbour; they rowed out anyway and found the door of ${m('stormspire', 'Storm Spire')} open — from the inside.`));
    B('post1', P('Every world I build starts with a place I would not want to live. This time it is a coast that loses a little more of itself every winter, and a free city that refuses to be saved.'));

    /* ---- relations ---- */
    const rels = Object.fromEntries(ctx.call('rels.list', W).map(r => [r.name, r.id]));
    const R = (a, rel, b, o = {}) => { if (keys[a] && keys[b] && rels[rel]) C.relate(Object.assign({ src: keys[a], dst: keys[b], relId: rels[rel] }, o)); };
    R('aldous', 'parent of', 'brannoc');
    R('brannoc', 'spouse of', 'elsabet', { start: at(1174, 'highsun', 20), end: at(1190, 'fogmoon', 3) });
    for (const p of ['brannoc', 'elsabet']) for (const c of ['corwin', 'ysolde']) R(p, 'parent of', c);
    R('ysolde', 'parent of', 'wren');
    R('corwin', 'sibling of', 'ysolde');
    R('aldous', 'rules', 'gullhaven', { start: at(1140), end: at(1170, 'frostmere', 8) });
    R('brannoc', 'rules', 'gullhaven', { start: at(1170, 'frostmere', 9) });
    R('brannoc', 'leader of', 'housevey', { start: at(1170, 'frostmere', 9) });
    R('tamsin', 'leader of', 'gulls', { start: at(1194) });
    R('fenn', 'member of', 'gulls');
    R('corwin', 'owes a debt to', 'gulls', { note: '3,400 silver gulls and rising' });
    R('merrow', 'leader of', 'saltwardens');
    R('oskar', 'leader of', 'drownedchurch', { start: at(1180), end: at(1201, 'brine', 20) });
    R('mira', 'lives in', 'mirefen');
    R('halloran', 'serves', 'brannoc', { start: at(1168) });
    R('housevey', 'at war with', 'crown', { start: at(1186, 'saltreap', 2), end: at(1188, 'ember', 30) });
    R('housevey', 'ally of', 'saltwardens');
    R('tamsin', 'rival of', 'brannoc');
    R('tamsin', 'enemy of', 'halloran');
    R('mira', 'worships', 'drownedking');
    R('oskar', 'worships', 'drownedking');
    R('ysolde', 'friend of', 'mira');
    R('crown', 'rules', 'inlandcrown');
    R('drowningtidewell', 'caused by', 'tidecrown');
    R('mira', 'born in', 'mirefen');
    R('elsabet', 'buried in', 'veykeep');

    /* ---- tags, collections, tasks, writing history ---- */
    const tag = (name, color, ks) => { const id = C.ensureTag(W, name, color); for (const k of ks) if (keys[k]) ctx.db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)', keys[k], id); return id; };
    tag('house vey', '#c49a3c', ['brannoc', 'elsabet', 'corwin', 'ysolde', 'wren', 'aldous', 'housevey', 'veykeep']);
    tag('mystery', '#8f7ad8', ['tidecrown', 'stormspire', 'storm1203', 'lanternlens', 'plotcrown']);
    tag('unresolved', '#e08b4f', ['plotheir', 'plotcrown', 'idea1', 'tamsin2']);
    tag('drowned', '#4fb6b2', ['tidewell', 'stormspire', 'drownedking', 'flood', 'drowningtidewell']);
    tag('act one', '#5fb38a', ['s1', 's2', 'ch1']);
    ctx.call('collections.save', { worldId: W, name: 'The Vey family', icon: '⚑', query: { tagNames: ['house vey'] } });
    ctx.call('collections.save', { worldId: W, name: 'Open threads', icon: '⟿', query: { typeKeys: ['plot'] } });
    const day = n => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    if (ctx.has('tasks.save')) {
      ctx.call('tasks.save', { worldId: W, title: 'Decide which chapter reveals Corwin\'s father', entryId: keys.plotheir, due: day(2), priority: 2 });
      ctx.call('tasks.save', { worldId: W, title: 'Give the Salt Wyrm a lair on the flats', entryId: keys.saltwyrm, due: day(5) });
      ctx.call('tasks.save', { worldId: W, title: 'Fix: Brother Oskar can\'t be in scene 5', entryId: keys.s5, due: day(-1), priority: 3 });
      ctx.call('tasks.save', { worldId: W, title: 'Draw a better map of the Sunken Market', entryId: keys.sunkenmarket });
      const t = ctx.call('tasks.save', { worldId: W, title: 'Name the two moons', entryId: null });
      ctx.call('tasks.toggle', t.id, true);
    }
    /* ---- every other area adds its part ---- */
    for (const mod of ctx.modules) {
      if (!mod.mod.sample || mod.name === 'sample') continue;
      try { ctx.db.tx(() => mod.mod.sample(ctx, S)); } catch (e) { console.error('sample: ' + mod.name + ': ' + (e && e.stack || e)); }
    }

    // a believable writing past, unless an area (Write) already gave the world one
    if (!ctx.db.value('SELECT count(*) FROM writing_log WHERE world_id = ?', W)) {
      const words = [420, 0, 780, 610, 350, 900, 0, 0, 1200, 640, 300, 560, 710, 820];
      words.forEach((n, i) => { if (n) ctx.db.run('INSERT OR REPLACE INTO writing_log (world_id, day, entry_id, words, seconds) VALUES (?,?,?,?,?)', W, day(-(words.length - i)), keys['s' + ((i % 4) + 1)], n, n * 2); });
    }
    ctx.changed(['worlds', 'entries', 'links', 'tags', 'tasks', 'media']);
    return C.world(W);
  }
  return { 'worlds.sample': () => build() };
}

module.exports = { handlers, CALENDAR };
