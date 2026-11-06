/* More generators: NPC, names, tavern, shop & inventory, landmark, dungeon room, quest hook, rumour, plot twist,
   weather, treasure hoard, artifact, ship, deity, religion and faction. Original tables; prices in the world's currencies. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./gen-words.js') : root.WBGen;
  factory(G, node ? require('./names.js') : root.WBNames);
  if (node) module.exports = G;
})(typeof self !== 'undefined' ? self : this, function (G, N) {
  'use strict';
  const cap = G.cap, esc = G.esc, title = G.title;
  const RANDOM = ['', 'Any (random)'];

  /* ---------------- money ---------------- */
  const DEFAULT_COINS = [{ name: 'gold', abbr: 'g', value: 100 }, { name: 'silver', abbr: 's', value: 10 }, { name: 'copper', abbr: 'c', value: 1 }];
  /** coins sorted largest first, from the world's currencies (value = how many of the smallest coin) */
  const coins = o => { const c = (o && o.currencies || []).filter(x => x && x.name && +x.value > 0).map(x => ({ name: x.name, abbr: x.abbr || x.name.slice(0, 2).toLowerCase(), value: +x.value })); return (c.length ? c : DEFAULT_COINS).slice().sort((a, b) => b.value - a.value); };
  /** a price in the smallest coin → "2 g 4 s" (at most two coins) */
  function money(n, o) {
    const cs = coins(o);
    n = Math.max(1, Math.round(n * (cs[cs.length - 1].value || 1)));
    const parts = [];
    for (const c of cs) { if (parts.length === 2) break; const k = Math.floor(n / c.value); if (k > 0 || (c === cs[cs.length - 1] && !parts.length)) { parts.push(k + ' ' + c.abbr); n -= k * c.value; } }
    return parts.join(' ');
  }
  G.money = money; G.coins = coins;
  /** "name:lo-hi" price items → [{ name, lo, hi }] */
  const items = s => G.split(s).map(x => { const m = /^(.*?):\s*([\d.]+)(?:-([\d.]+))?$/.exec(x); return m ? { name: m[1].trim(), lo: +m[2], hi: +(m[3] || m[2]) } : { name: x, lo: 1, hi: 1 }; });
  const plural = w => (/[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's');
  const priceOf = (t, it, factor) => { const v = it.lo + (it.hi - it.lo) * t.f(); return v * (factor || 1); };
  const wealthFactor = w => ({ destitute: 0.6, poor: 0.8, modest: 1, comfortable: 1.2, wealthy: 1.6, opulent: 2.2 })[w] || 1;
  const magicLvl = m => ({ none: 0, rare: 1, common: 2, high: 3 })[m] || 0;
  const magicInput = { key: 'magic', label: 'Magic', kind: 'choice', def: 'rare', options: [['none', 'No magic'], ['rare', 'Rare'], ['common', 'Common'], ['high', 'Everywhere']] };
  const wealthInput = { key: 'wealth', label: 'Wealth', kind: 'choice', def: 'modest', options: [['poor', 'Poor'], ['modest', 'Modest'], ['comfortable', 'Comfortable'], ['wealthy', 'Wealthy']] };
  const H = { p: s => '<p>' + esc(s) + '</p>', ul: arr => '<ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>', s: s => '<span class="wb-s">' + esc(s) + '</span>' };
  const peopleOf = (t, o) => (o.peoples && o.peoples.length ? t.pick(o.peoples) : '');
  const castOr = (t, o, list) => (o.cast && o.cast.length && t.chance(0.6) ? t.pick(o.cast) : G.fill(t, t.pick(list)));
  const placeOr = (t, o, list) => (o.places && o.places.length && t.chance(0.6) ? t.pick(o.places) : G.fill(t, t.pick(list)));

  G.words({
    role: 'commoner|merchant|noble|soldier|criminal|priest|scholar|sailor|mage|wanderer|artisan|farmer',
    export: 'salt|wine|silk|grain|timber|spices|wool|amber|iron|dyes|furs|glass',
    patron: 'a frightened widow|the harbourmaster|a dying knight|a merchant with too many guards|a temple acolyte|a child with a coin purse too heavy for them|a retired adventurer|the local lord\'s steward|a scholar who will not explain why|a smuggler who wants out|an innkeeper with a problem in the cellar|a talking raven|a stranger in a grey hood|the guild of {jobCommon}s|a ghost who needs a favour|a rival who is out of options',
    verb: 'recover|deliver|find|escort|rescue|destroy|steal back|guard|investigate|map|hunt|bury|return|smuggle|negotiate for|break the curse on',
    target: 'a stolen reliquary|a missing apprentice|the deed to the old mill|a crate that must not be opened|a {beast} egg|the lord\'s runaway heir|a shipment of {export}|a sealed letter|a cursed {metal} bell|the bones of a saint|a map drawn on skin|a caged {animal} that speaks|the town charter|a merchant\'s lost daughter|a forger\'s tools|the ashes of a hero',
    place: 'the old lighthouse|a sunken chapel|the salt flats|the {colour} caves|the abandoned mine|a smugglers\' cove|the duke\'s summer house|the hanging bridge|a witch\'s hut on stilts|the drowned village|the barrow on the ridge|a wrecked ship on the shoals|the monastery above the clouds|the plague pits|the toll fort on the river',
    complication: 'someone else has been hired for the same job|the patron is lying about why|the target does not want to be found|a storm cuts off the only road|the local watch is in on it|it is a trap set for the patron, not the heroes|the payment is counterfeit|an old enemy of the heroes is involved|the thing they seek is alive, and afraid|it must be done before the next full moon|the law forbids exactly what they must do|a rival faction offers more to fail',
    reward: 'a purse of coin|a favour from the {jobUrban}|a deed to a small house|passage on the next ship|an heirloom blade|a map to something better|membership of a guild|the patron\'s silence|a {gem} the size of a thumb|a pardon|a horse and saddle|a book of secrets',
    rumourLine: '{cast} was seen leaving {place} before dawn|there is gold in {place}, and nobody who went for it came back|{cast} owes money to the wrong people|a {beast} has been sighted near {place}|the well water tastes of {metal} since the earthquake|someone has been buying up all the {material} in town|{cast} is not who they say they are|lights move inside {place} at night|the next ship will bring plague, or a prince|{cast} has hired sellswords, and nobody knows why|the old temple bell rang by itself last night|a child found a {metal} coin with a stranger\'s face on it|the {jobCommon} saw a body pulled from the water and covered up|{cast} was promised the crown by a dying man|the roads north are watched by riders without banners',
    rumourSource: 'a drunk at the bar|the washerwomen at the well|a sailor just off the boat|a beggar who sees everything|a nervous clerk|a gossiping priest|children playing in the street|a travelling pedlar|the town crier, off the record|a letter left on a table',
    twist: '{cast} has been working for the villain all along|the villain is trying to prevent something worse|the treasure is the bait in someone else\'s trap|the patron is already dead, and someone wears their face|the prophecy was written by the people it condemns|{cast} is the lost heir everyone is searching for|the monster is a cursed member of {cast}\'s family|the war was started on purpose, by both sides|the heroes\' map was drawn backwards|the town has been reliving the same week for a year|the true enemy is the institution the heroes serve|the victim staged their own disappearance|{place} is not a ruin; it is still occupied|the cure and the plague come from the same source|{cast} is two people sharing one identity|the oracle has been guessing all along|the stolen item was stolen first from the person who hired them|the dragon is the last of its kind and the heroes were paid to end it|the rebel leader and the tyrant are siblings with a shared plan|the gods are not watching; the priests know',
    inviteAtm: 'low beams hung with dried herbs|a roaring hearth and too few chairs|candles stuck in wine bottles|lanterns of coloured glass|a ship\'s figurehead over the bar|walls covered in carved initials|a fiddler in the corner who never stops|a stuffed {beast} head missing an eye|smoke so thick it stings the eyes|a long table where strangers share bread',
    crowd: 'rowdy dock workers|quiet card players|off-duty guards|a wedding party|pilgrims on the road|students arguing philosophy|farmers in from market|a travelling theatre troupe|tired caravan hands|nobody at all, suspiciously',
    patronNpc: 'a one-eyed {jobSea} arguing about the weather|an old woman winning at dice|a nervous young clerk nursing one drink|a mercenary with a fresh scar|a bard who knows only sad songs|a merchant counting coins twice|a priest drinking in disguise|two lovers pretending not to be|a child selling flowers too late at night|a giant of a {jobCommon} with a gentle laugh|a hooded stranger watching the door|a retired soldier telling the same war story|a twitchy alchemist with singed eyebrows|a pair of twins finishing each other\'s sentences|a grieving widow buying rounds for everyone',
    trouble: 'a brawl breaks out over a card game|the watch arrives looking for someone in the room|a stranger collapses with a strange wound|the owner is threatened by debt collectors|a famous duellist demands a worthy opponent|the ale has run out and a riot brews|a fire starts in the kitchen|a wanted poster on the wall shows one of the heroes|someone slips a note under a hero\'s tankard|a dog runs in carrying a severed hand',
  });

  /* ---------------- NPC ---------------- */
  const ROLE_STATS = { commoner: [4, 10, 0], merchant: [6, 10, 0], noble: [9, 12, 1], soldier: [16, 15, 1], criminal: [10, 13, 3], priest: [12, 11, 0], scholar: [6, 10, 1], sailor: [11, 12, 2], mage: [10, 11, 2], wanderer: [12, 12, 2], artisan: [8, 10, 0], farmer: [9, 10, 0] };
  const ROLE_JOBS = {
    commoner: 'jobCommon', merchant: 'merchant|trader|shopkeeper|moneylender|spice dealer|wine merchant|cloth merchant', noble: 'baron\'s heir|courtier|landed knight|dowager|ambassador|minor lord|lady-in-waiting', soldier: 'guard sergeant|mercenary|veteran pikeman|scout|watch captain|deserter|bodyguard',
    criminal: 'jobShady', priest: 'village priest|temple acolyte|wandering friar|oracle|exorcist|abbess|cult preacher', scholar: 'archivist|tutor|cartographer|herbalist|physician|astronomer|historian', sailor: 'jobSea', mage: 'jobMagic', wanderer: 'pilgrim|tinker|minstrel|exile|bounty hunter|pedlar|hermit', artisan: 'jobUrban', farmer: 'jobPlain',
  };
  G.define({
    id: 'npc', name: 'NPC', icon: '☺', group: 'People', creates: 'character', desc: 'A person to meet: looks, manner, voice, wants, fears, a secret and quick stats.',
    inputs: [{ key: 'role', label: 'Kind of person', kind: 'choice', def: '', options: [RANDOM].concat(Object.keys(ROLE_STATS).map(k => [k, cap(k)])) }, { key: 'culture', label: 'Culture', kind: 'culture' }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      const st = g.rng('setup');
      d.role = ROLE_STATS[o.role] ? o.role : st.pick(Object.keys(ROLE_STATS));
      d.name = g.section('name', 'Name', 'title', t => g.person(t, { style: o.nameStyle || 'common' }));
      g.section('who', 'Who', 'kv', t => {
        d.people = peopleOf(t, o); d.age = t.pick('age'); d.job = t.pick(ROLE_JOBS[d.role] && G.W[ROLE_JOBS[d.role]] ? ROLE_JOBS[d.role] : G.split(ROLE_JOBS[d.role] || 'jobCommon'));
        return [['Role', cap(d.job)], ['Age', cap(d.age)], d.people ? ['People', d.people] : null].filter(Boolean);
      });
      g.section('looks', 'Looks & manner', 'kv', t => { d.build = t.pick('build'); d.look = t.pick('look'); d.voice = t.pick('voice'); d.trait = t.pick('trait'); return [['Build', cap(d.build)], ['Detail', cap(d.look)], ['Voice', cap(d.voice)], ['Manner', cap(d.trait)]]; });
      g.section('drives', 'Drives', 'kv', t => { d.want = t.pick('want'); d.fear = t.pick('fear'); return [['Wants', cap(d.want)], ['Fears', cap(d.fear)]]; });
      g.section('secret', 'Secret', 'text', t => { d.secret = cap(t.pick('secret')) + '.'; return d.secret; }, { secret: true });
      g.section('hook', 'Hook', 'text', t => { d.hook = cap(G.fill(t, t.pick(['will pay well for {target}', 'needs someone to {verb} {target}', 'knows the way into {place}', 'is being followed by {patron}', 'has a message for whoever asks about {place}', 'wants to sell {target}, cheap']))) + '.'; return d.hook; });
      g.section('stats', 'Quick stats', 'kv', t => { const [hp, ac, init] = ROLE_STATS[d.role]; d.stats = { hp: Math.max(2, hp + t.int(-2, 3)), ac: ac + t.int(-1, 1), init: init + t.int(-1, 1) }; return [['hp', String(d.stats.hp)], ['ac', String(d.stats.ac)], ['init', (d.stats.init >= 0 ? '+' : '') + d.stats.init]]; });
      g.res.summary = cap(G.article('a ' + d.age + ' ' + d.job)) + ' who ' + d.trait + '.';
    },
    plan(res, env) {
      const d = res.data;
      return { entries: [{ ref: 'main', type: 'character', title: d.name, summary: res.summary,
        fields: { occupation: cap(d.job), culture: env.cultureId || '', appearance: cap(d.build) + ', ' + d.look + '.', personality: cap(d.trait) + '.', voice: cap(d.voice), goals: cap(d.want) + '.', fears: cap(d.fear) + '.', secret: d.secret, status: 'Alive',
          stats: [{ label: 'hp', value: String(d.stats.hp) }, { label: 'ac', value: String(d.stats.ac) }, { label: 'init', value: (d.stats.init >= 0 ? '+' : '') + d.stats.init }] },
        body: H.p(cap(G.article('a ' + d.age + ' ' + d.job)) + (d.people ? ' (' + d.people + ')' : '') + '. ' + cap(d.trait) + '.') + H.p('Hook: ' + d.hook) }], open: 'main' };
    },
  });

  /* ---------------- names ---------------- */
  G.define({
    id: 'names', name: 'Names', icon: 'Aa', group: 'People', creates: 'character', desc: 'Lists of names in a sound style or from a culture\'s sample names.',
    inputs: [{ key: 'kind', label: 'Names for', kind: 'choice', def: 'person', options: [['person', 'People'], ['place', 'Places'], ['family', 'Families'], ['word', 'Words']] },
      { key: 'style', label: 'Sound', kind: 'choice', def: '', options: [['', 'World style']].concat(Object.entries(N.STYLES).map(([k, s]) => [k, s.label])) },
      { key: 'culture', label: 'Culture', kind: 'culture' }, { key: 'count', label: 'How many', kind: 'number', def: 12, min: 3, max: 40 }],
    generate(g) {
      const o = g.opts, n = Math.max(3, Math.min(40, +o.count || 12)), style = o.style || o.nameStyle || 'common';
      g.section('names', 'Names', 'list', t => {
        if (o.kind === 'person') { const out = []; for (let i = 0; i < n; i++) out.push(g.person(t, { style })); return out; }
        const samples = o.kind === 'family' ? o.names && o.names.family : o.kind === 'place' ? o.placeSamples : o.names && o.names.given;
        return N.generate({ style, kind: o.kind === 'word' ? 'person' : o.kind, count: n, samples: samples && samples.length >= 3 ? samples : null, rng: t.rng, avoid: o.avoidNames || [] });
      });
      const list = g.res.sections[0].value;
      g.res.title = list[0] || 'Names';
      g.res.summary = list.length + ' names in the ' + ((N.STYLES[style] || {}).label || style) + ' style.';
    },
    plan(res, env) {
      const kind = res.opts.kind === 'place' ? 'place' : 'character', name = env.pick || res.sections[0].value[0];
      return { entries: [{ ref: 'main', type: kind, title: name, summary: '' }], open: 'main' };
    },
  });

  /* ---------------- tavern ---------------- */
  const DRINKS = items('small beer:0.5-1|house ale:1-2|dark stout:2-3|cider:1-2|mead:3-5|watered wine:2-3|good wine (bottle):12-30|spiced wine:3-5|grain spirit:3-6|sea-buckthorn brandy:6-10|herbal tea:0.5-1|goat milk:0.5|honey liqueur:5-9|black rum:4-7|plum brandy:5-8');
  const FOOD = items('bread and dripping:1|pease pottage:1-2|meat pie:3-5|roast fowl:8-12|fish stew:3-5|cheese and pickles:2-3|mutton chops:6-9|eel pie:4-6|boiled eggs (pair):1|sausages and onions:3-4|venison stew:6-10|honey cake:2-3|oysters (dozen):4-8|mushroom tart:3-5|whole roast for the table:40-70');
  G.define({
    id: 'tavern', name: 'Tavern', icon: '☕', group: 'Places', creates: 'place', desc: 'An inn or tavern: owner, mood, menu with prices, rooms, patrons, a rumour and tonight\'s trouble.',
    inputs: [{ key: 'kind', label: 'Kind', kind: 'choice', def: '', options: [RANDOM, ['inn', 'Inn with rooms'], ['tavern', 'Tavern'], ['alehouse', 'Alehouse'], ['winehouse', 'Wine house'], ['roadhouse', 'Roadhouse']] }, wealthInput],
    generate(g) {
      const o = g.opts, d = g.res.data, wf = wealthFactor(o.wealth);
      d.kind = o.kind || g.rng('setup').pick(['inn', 'tavern', 'alehouse', 'winehouse', 'roadhouse']);
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, '{innName}')));
      g.section('owner', 'Owner', 'kv', t => { d.owner = { name: g.person(t, { style: o.nameStyle || 'common' }), trait: t.pick('trait'), secret: t.pick('secret') }; return [['Keeper', d.owner.name], ['Manner', cap(d.owner.trait)], ['Secret', cap(d.owner.secret)]]; });
      g.section('mood', 'Atmosphere', 'kv', t => { d.atm = t.pick('inviteAtm'); d.crowd = t.pick('crowd'); d.smell = t.pick(['woodsmoke and spilled ale', 'roasting meat', 'wet dog and pipe smoke', 'fresh bread', 'brine and tar', 'cheap perfume', 'herbs hung to dry']); return [['Inside', cap(G.fill(t, d.atm))], ['Tonight', cap(d.crowd)], ['Smells of', d.smell], ['Known for', cap(G.fill(t, t.pick(['its {food}', 'a house brew called the {adjInn} {nounInn}', 'a famous fight twenty years ago', 'the best view of the harbour', 'never asking questions', 'a ghost who orders a drink every midnight', 'songs that go on till dawn']), { food: t.pick(FOOD).name }))]]; });
      g.section('menu', 'Menu', 'items', t => {
        const drinks = t.sample(DRINKS, 4), food = t.sample(FOOD, 4), out = [];
        for (const it of drinks) out.push({ title: cap(it.name), sub: 'drink', price: money(priceOf(t, it, wf), o) });
        for (const it of food) out.push({ title: cap(it.name), sub: 'food', price: money(priceOf(t, it, wf), o) });
        if (d.kind === 'inn' || d.kind === 'roadhouse') { out.push({ title: 'Bed in the common room', sub: 'night', price: money(priceOf(t, { lo: 2, hi: 4 }, wf), o) }, { title: 'Private room', sub: 'night', price: money(priceOf(t, { lo: 8, hi: 20 }, wf), o) }, { title: 'Stabling and feed', sub: 'night', price: money(priceOf(t, { lo: 2, hi: 5 }, wf), o) }); }
        d.menu = out;
        return out;
      });
      g.section('patrons', 'Patrons', 'list', t => (d.patrons = t.fills('patronNpc', 4).map(cap)));
      g.section('rumour', 'Rumour', 'text', t => (d.rumour = '“' + cap(G.fill(t, '@rumourLine', { cast: () => castOr(t, o, ['the innkeeper\'s cousin', 'a sailor called {nounInn}', 'the miller']), place: () => placeOr(t, o, G.W.place) })) + '.”'));
      g.section('trouble', 'Tonight\'s trouble', 'text', t => (d.trouble = cap(t.pick('trouble')) + '.'));
      g.res.summary = cap(G.article('a ' + ({ inn: 'inn', tavern: 'tavern', alehouse: 'alehouse', winehouse: 'wine house', roadhouse: 'roadhouse' })[d.kind])) + ' kept by ' + d.owner.name + ', with ' + G.fill(G.tools(N.rng(g.res.seed)), d.atm) + '.';
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'place', title: res.data.name, summary: res.summary, fields: { kind: 'Building', features: res.data.menu.map(m => m.title + ' (' + m.price + ')') }, body: G.html(res), parentId: env.parentId || null }], open: 'main' }; },
  });

  /* ---------------- shop ---------------- */
  const SHOPS = {
    general: { label: 'General store', names: '{owner}\'s Goods|The Odds & Ends|The Provisioner|The {colour} Barrel|Everything Under One Roof', stock: 'rope (50 ft):8-12|lamp oil (flask):1-2|candles (dozen):2-4|wool blanket:5-8|waterskin:2-3|tinderbox:3-5|salt (pound):1-2|soap:1|sack:1|iron pot:8-12|fishing line and hooks:3-5|lantern:20-35|chalk:0.5|whetstone:2-3|travel rations (day):4-6|needle and thread:1-2' },
    smith: { label: 'Blacksmith', names: '{owner}\'s Forge|The Black Anvil|Hammer & Tongs|The Glowing Coal', stock: 'horseshoes (set):8-14|nails (100):3-5|hand axe:25-40|sickle:12-20|hammer:10-15|iron chain (10 ft):30-50|lock and key:40-80|shears:10-18|dagger:20-40|spearhead:15-25|crowbar:12-20|grappling hook:25-40|cooking spit:6-10|shovel:12-18' },
    arms: { label: 'Armourer', names: 'The Steel Wall|{owner}\'s Arms|The Iron Shirt|Edge & Point', stock: 'short sword:100-160|longsword:150-250|spear:30-50|shield:60-100|padded jacket:50-80|leather armour:100-150|chain shirt:500-800|helm:80-140|crossbow:250-350|bolts (20):10-15|war axe:120-200|mace:50-90|gauntlets:40-70' },
    apothecary: { label: 'Apothecary', names: 'The Mortar & Pestle|{owner}\'s Remedies|The Green Bottle|The Healing Hand', stock: 'willow-bark tea:2-4|poultice of comfrey:3-6|sleeping draught:8-15|smelling salts:4-6|bandages (roll):1-2|tooth powder:2|cough syrup:5-8|antidote (common poisons):40-80|love philtre (probably fake):15-30|rat poison:3-5|mosquito oil:3-5|eye drops of belladonna:10-20' },
    books: { label: 'Bookseller', names: 'The Inky Quill|{owner}\'s Books|The Turning Page|The Chained Shelf', stock: 'almanac for the year:5-10|blank journal:8-15|ink and quills:3-5|a bawdy romance:6-12|a book of sermons:10-20|a bestiary, half invented:40-80|regional map:25-50|a cookbook from far away:12-20|a history of the founding:30-50|a primer for children:4-8|a ledger book:10-15|a sealed diary, owner unknown:20-60' },
    tailor: { label: 'Tailor', names: 'The Golden Needle|{owner}\'s Cloth|Thread & Thimble|The Velvet Loom', stock: 'wool cloak:15-30|linen shirt:4-8|leather boots:20-40|silk scarf:15-30|felt hat:5-10|fine doublet:60-120|work apron:3-5|mourning veil:10-20|gloves:5-12|travelling dress:40-80|alterations:2-5' },
    jeweller: { label: 'Jeweller', names: 'The {gem} Case|{owner}\'s Gems|The Glittering Eye|The Gilded Loupe', stock: '{metal} ring:20-80|{gem} pendant:80-300|pearl earrings:60-150|silver brooch:30-60|gold chain:200-400|signet ring (engraved):100-200|amber beads:20-50|locket with a painted portrait:40-90|filigree comb:30-70|a single loose {gem}:50-500' },
    curio: { label: 'Curio shop', names: 'The Odd Corner|{owner}\'s Curiosities|The Dusty Cabinet|Things Found', stock: 'a stuffed {animal}:10-40|a ship in a bottle:15-30|a music box that plays backwards:30-60|a mummified hand:20-50|a mask from a forgotten festival:15-40|a compass that points somewhere else:40-90|a jar of buttons from the drowned:5-10|a deck of fortune cards:10-20|a {beast} tooth:30-80|a broken clockwork bird:25-60|an urn of unknown ashes:8-15|a portrait whose eyes follow you:40-100' },
    provisioner: { label: 'Provisioner', names: 'The Full Pack|{owner}\'s Supplies|The Last Stop|The Road Provisioner', stock: 'trail rations (week):25-35|hardtack (pound):2-3|dried fish:3-5|tent (two-person):20-40|bedroll:8-12|climbing pitons (10):8-12|torch (5):1-2|snowshoes:10-18|mule:600-900|saddlebags:12-20|map of the local roads:15-30|signal whistle:1-2' },
    magic: { label: 'Magic shop', magic: 2, names: 'The {colour} Phial|{owner}\'s Wonders|The Wizard\'s Pantry|The Glimmer', stock: 'a candle that burns without light:30-60|chalk that draws doors:200-400|a potion of mending:50-90|ink that only the reader can see:40-80|a stone that is always warm:20-40|a rope that ties itself:150-300|a minor healing draught:50-100|a bottled breeze:30-60|a mirror that shows yesterday:300-700|a charm against fevers:25-50|a scroll of light:60-100|a ring of easy sleep:120-240' },
    alchemist: { label: 'Alchemist', magic: 1, names: 'The Gilded Retort|The Smoking Flask|{owner}\'s Elixirs|The Philosopher\'s Kettle', stock: 'alchemist\'s fire (flask):50-80|acid (vial):25-40|smoke pellet:10-20|everburning tinder:15-25|glue that never fails:20-35|tanglefoot bag:40-60|flash powder:15-30|preserving salts:5-10|ink of invisibility:30-50|a tonic of courage (mostly brandy):10-20' },
  };
  G.define({
    id: 'shop', name: 'Shop & inventory', icon: '⚖', group: 'Places', creates: 'place', desc: 'A shop with its keeper, a quirk, how they haggle, and an inventory with prices.',
    inputs: [{ key: 'kind', label: 'Shop', kind: 'choice', def: '', options: [RANDOM].concat(Object.entries(SHOPS).map(([k, s]) => [k, s.label])) }, wealthInput, magicInput],
    generate(g) {
      const o = g.opts, d = g.res.data, wf = wealthFactor(o.wealth);
      const kinds = Object.keys(SHOPS).filter(k => !SHOPS[k].magic || magicLvl(o.magic) >= SHOPS[k].magic);
      d.kind = SHOPS[o.kind] ? o.kind : g.rng('setup').pick(kinds);
      const S = SHOPS[d.kind];
      g.section('owner', 'Keeper', 'kv', t => { d.owner = { name: g.person(t, { style: o.nameStyle || 'common' }), trait: t.pick('trait') }; d.haggle = t.pick(['haggles for the joy of it', 'never moves on price', 'gives a discount to anyone who makes them laugh', 'charges strangers double', 'takes trades instead of coin', 'will sell on credit to locals only']); return [['Keeper', d.owner.name], ['Manner', cap(d.owner.trait)], ['Haggling', cap(d.haggle)]]; });
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick(S.names), { owner: d.owner.name.split(' ')[0] })));
      g.section('quirk', 'Quirk', 'text', t => (d.quirk = cap(t.pick(['a cat sleeps on the most expensive item', 'the shop is in a converted chapel', 'everything is labelled in a language nobody here reads', 'the keeper\'s grandmother watches from a rocking chair and comments on every sale', 'half the stock is hidden behind a curtain for trusted buyers', 'a bell rings when a liar enters', 'the shop opens only after dark', 'prices are written in chalk and change with the keeper\'s mood'])) + '.'));
      g.section('stock', 'Inventory', 'items', t => {
        const all = items(S.stock), n = Math.min(all.length, t.int(7, 11));
        d.stock = t.sample(all, n).map(it => ({ title: cap(G.fill(t, it.name)), price: money(priceOf(t, it, wf), o), sub: t.chance(0.2) ? t.pick(['last one', 'second-hand', 'fine work', 'slightly damaged', 'imported']) : '' }));
        return d.stock;
      });
      g.section('special', 'Something special', 'text', t => (d.special = cap(G.fill(t, t.pick(['under the counter: {target}, if you know to ask', 'a {metal} {beast} figurine said to bring luck at sea', 'a sealed crate the keeper will not open or sell', 'an heirloom sword with a name nobody can pronounce', 'a map that was not here yesterday']))) + '.'));
      g.res.summary = S.label + ' kept by ' + d.owner.name + ', who ' + d.owner.trait + '.';
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'place', title: res.data.name, summary: res.summary, fields: { kind: 'Building', features: res.data.stock.map(s => s.title + ' (' + s.price + ')') }, body: G.html(res), parentId: env.parentId || null }], open: 'main' }; },
  });

  /* ---------------- landmark ---------------- */
  const LANDMARKS = {
    natural: { label: 'Natural wonder', names: 'The {colour} Falls|{animal} Rock|The Weeping Cliffs|The Sleeping Giant|The Singing Sands|The Drowned Forest|The Needle|The Glass Lake|The {colour} Spring', what: 'a waterfall that freezes into stairs each winter|a stone arch the wind plays like a flute|a lake so clear the drowned town beneath is visible|a forest of petrified trees|a hill that hums before storms|a gorge where every echo answers wrongly|a hot spring the colour of rust|a sea stack shaped like a kneeling woman' },
    ruin: { label: 'Ruin', names: 'The Broken Crown|Old {holy}|The Fallen Bridge|The Last Tower|The Empty Throne|The Sunken Keep', what: 'a tower snapped in half, the top lying in the river|a great hall open to the sky|columns of a temple to a forgotten god|a city gate with no city|a sunken palace visible at low tide|a fortress overgrown with roses' },
    monument: { label: 'Monument', names: 'The Kneeling King|The {colour} Obelisk|The Thousand Names|The Lantern Stone|The Victory Arch|The Weeping Mother', what: 'a statue of a queen with her face chiselled off|an obelisk carved with the names of a lost army|a giant bronze hand rising from the ground|a ring of standing stones that cast too many shadows|a triumphal arch for a war nobody remembers winning|a stair cut into a cliff leading nowhere' },
    uncanny: { label: 'Uncanny place', names: 'The Quiet Field|The Hollow|Nobody\'s Crossing|The Turning Wood|The Mirror Pool|The Place Without Birds', what: 'a field where no sound carries|a crossroads that sometimes has a fifth road|a pool that reflects a different sky|a wood where paths rearrange at night|a house that is always just over the next hill|a meadow where time runs slow' },
  };
  G.define({
    id: 'landmark', name: 'Landmark', icon: '⛰', group: 'Places', creates: 'place', desc: 'A wonder, ruin, monument or uncanny place with its legend and a secret.',
    inputs: [{ key: 'kind', label: 'Kind', kind: 'choice', def: '', options: [RANDOM].concat(Object.entries(LANDMARKS).map(([k, s]) => [k, s.label])) }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      d.kind = LANDMARKS[o.kind] ? o.kind : g.rng('setup').pick(Object.keys(LANDMARKS));
      const L = LANDMARKS[d.kind];
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick(L.names))));
      g.section('what', 'What it is', 'text', t => (d.what = cap(t.pick(L.what)) + '.'));
      g.section('legend', 'Legend', 'text', t => (d.legend = cap(G.fill(t, t.pick(['they say {holy} wept here, and the ground remembers', 'a hero fell here holding back {creature}s for a night and a day', 'two lovers from feuding families met here, and only one walked away', 'it marks the border of a kingdom that drowned', 'anyone who sleeps here dreams of the same door', 'the first settlers bargained here with something old', 'a king buried his crown here so no heir could wear it']))) + '.'));
      g.section('visit', 'Visiting', 'kv', t => { d.feature = cap(G.fill(t, t.pick(['pilgrims leave {material} tokens', 'a hermit tends it and charges a toll in stories', 'smugglers use it as a meeting point', 'scholars camp here every summer', 'nobody goes near it after dark', 'a shrine stands at its foot']))); d.danger = cap(G.fill(t, t.pick(['{creature}s nest nearby', 'the ground is unstable', 'bandits watch the approaches', 'the place drives the impatient slowly mad', 'nothing, apparently, which is what worries people', 'the tide comes in faster than a horse can run']))); return [['Today', d.feature], ['Danger', d.danger]]; });
      g.section('secret', 'Secret', 'text', t => (d.secret = cap(G.fill(t, t.pick(['a sealed chamber lies beneath, untouched', 'the legend is false; the truth is worse', '{target} is hidden here', 'it is slowly moving, a few inches a year', 'it was built by the people who now fear it']))) + '.'), { secret: true });
      g.res.summary = LANDMARKS[d.kind].label + ': ' + g.lower(d.what);
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'place', title: res.data.name, summary: res.summary, fields: { kind: 'Landmark' }, body: G.html(res), parentId: env.parentId || null }], open: 'main' }; },
  });

  /* ---------------- dungeon room ---------------- */
  const DUNGEONS = { crypt: 'Crypt', cave: 'Caves', ruin: 'Ruined keep', temple: 'Sunken temple', mine: 'Old mine', lair: 'Monster lair', sewer: 'Sewers', tower: 'Wizard\'s tower' };
  const ROOMS = {
    crypt: 'ossuary|embalming room|family vault|chapel of rest|sealed tomb|hall of effigies|bone-lined corridor',
    cave: 'flooded grotto|crystal chamber|bat roost|underground river crossing|fungus garden|collapsed tunnel|echoing cavern',
    ruin: 'great hall|guard room|collapsed kitchen|armoury|lord\'s bedchamber|dungeon cells|chapel open to the sky',
    temple: 'flooded nave|vestry|reliquary|sacrificial altar|choir loft|baptistery|priests\' cells',
    mine: 'ore chamber|collapsed shaft|miners\' rest|cart junction|flooded gallery|foreman\'s office|deep vein',
    lair: 'feeding chamber|nest|trophy room|bone pit|sleeping den|watch post|hoard chamber',
    sewer: 'junction pool|smugglers\' storeroom|collapsed culvert|old cistern|rat warren|outflow grate|forgotten crypt',
    tower: 'library|summoning circle|laboratory|observatory|guest room for something|stairwell that loops|vault of failures',
  };
  G.define({
    id: 'room', name: 'Dungeon room', icon: '▥', group: 'Places', creates: 'place', desc: 'A room for a dungeon: size, features, smell and sound, an occupant, a hazard, treasure and exits.',
    inputs: [{ key: 'dungeon', label: 'Dungeon', kind: 'choice', def: '', options: [RANDOM].concat(Object.entries(DUNGEONS)) }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      d.dungeon = DUNGEONS[o.dungeon] ? o.dungeon : g.rng('setup').pick(Object.keys(DUNGEONS));
      d.name = g.section('name', 'Room', 'title', t => cap(t.pick(ROOMS[d.dungeon])));
      g.section('shape', 'Shape & size', 'kv', t => { const w = t.int(2, 8) * 5, l = t.int(2, 10) * 5; d.size = w + ' × ' + l + ' ft'; d.shape = t.pick(['rectangular', 'square', 'round', 'irregular', 'octagonal', 'long and narrow', 'L-shaped']); d.ceiling = t.pick(['low, you must stoop', 'arched, about 12 ft', 'lost in darkness', 'collapsed in one corner', 'painted with stars', 'dripping with roots']); return [['Size', d.size + ', ' + d.shape], ['Ceiling', cap(d.ceiling)], ['Light', cap(t.pick(['none', 'a guttering torch', 'phosphorescent moss', 'a shaft of daylight', 'a green glow with no source']))]]; });
      g.section('senses', 'Senses', 'kv', t => [['Smell', cap(t.pick('smell'))], ['Sound', cap(t.pick('sound'))]]);
      g.section('features', 'Features', 'list', t => (d.features = t.fills('a toppled statue|a pool of black water|rusted chains on the walls|a mosaic floor, half missing|an altar stained dark|shelves of clay jars|a collapsed staircase|a skeleton still holding a lantern|scratch marks counting days|a mural of a {beast}|a well with a rope going down|a door painted on solid stone|a cold draught from a crack|bones arranged in a spiral', 3).map(cap)));
      g.section('occupant', 'Occupant', 'text', t => (d.occupant = t.chance(0.6) ? cap(G.fill(t, t.pick(['{1d4+1} {creature}s, {doing}', 'a lone {creature}, {doing}', 'a lost {jobCommon}, terrified', 'nothing living, but something watches', 'a {beast} hatchling, hungry']), { doing: () => t.pick(['asleep', 'arguing', 'eating', 'on guard', 'wounded', 'performing a rite']) })) + '.' : 'Empty, for now.'));
      g.section('hazard', 'Hazard', 'text', t => (d.hazard = t.chance(0.55) ? cap(t.pick(['a pressure plate releases darts from the walls', 'the floor is rotten over a pit', 'a swinging blade hidden in the doorframe', 'poison gas seeps when the door opens', 'the water is deeper than it looks', 'a rune that burns the first to cross it', 'loose stones above, ready to fall'])) + '.' : 'None obvious.'));
      g.section('treasure', 'Treasure', 'text', t => (d.treasure = t.chance(0.45) ? cap(G.fill(t, t.pick(['a purse of {2d20} old coins', 'a {gem} hidden in a skull', 'a {metal} ring on a skeletal finger', 'a sealed scroll case', 'a fine dagger under the altar cloth']))) + '.' : 'Nothing of value.'));
      g.section('exits', 'Exits', 'list', t => (d.exits = t.sample(['north', 'east', 'south', 'west', 'down', 'up'], t.int(1, 3)).map(dir => cap(dir) + ': ' + t.pick(['an open arch', 'a stout wooden door', 'a locked iron door', 'a secret panel', 'a narrow crawlway', 'a collapsed passage (needs clearing)', 'stairs']))));
      g.res.summary = cap(G.article('a ' + d.shape + ' ' + d.name)) + ' (' + d.size + ') in the ' + DUNGEONS[d.dungeon].toLowerCase() + '.';
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'place', title: cap(res.data.name), summary: res.summary, fields: { kind: 'Dungeon', features: res.data.features }, body: G.html(res), parentId: env.parentId || null }], open: 'main' }; },
  });

  /* ---------------- quest hook ---------------- */
  G.define({
    id: 'quest', name: 'Quest hook', icon: '⟿', group: 'Story', creates: 'plot', desc: 'Who asks, what for, where, what goes wrong, the reward — and a twist.',
    inputs: [{ key: 'tone', label: 'Tone', kind: 'choice', def: '', options: [RANDOM, ['heroic', 'Heroic'], ['grim', 'Grim'], ['mystery', 'Mystery'], ['light', 'Light-hearted']] }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      g.section('patron', 'Who asks', 'text', t => (d.patron = cap(castOr(t, o, G.W.patron))));
      g.section('task', 'The task', 'text', t => (d.task = cap(G.fill(t, '{verb} {target}', { export: () => t.pick(['salt', 'wine', 'silk', 'grain']) }))));
      g.section('where', 'Where', 'text', t => (d.where = cap(placeOr(t, o, G.W.place))));
      g.section('complication', 'Complication', 'text', t => (d.complication = cap(t.pick('complication')) + '.'));
      g.section('reward', 'Reward', 'text', t => (d.reward = cap(G.fill(t, '@reward'))));
      g.section('twist', 'Twist', 'text', t => (d.twist = cap(G.fill(t, '@twist', { cast: () => castOr(t, o, ['the patron', 'their closest ally']), place: () => placeOr(t, o, G.W.place) })) + '.'), { secret: true });
      d.name = cap(d.task.replace(/^(\w+)/, m => m)) + ' at ' + d.where.replace(/^the /i, 'the ');
      g.res.title = d.name.length > 70 ? d.task : d.name;
      g.res.summary = d.patron + ' asks the heroes to ' + g.lower(d.task) + ' at ' + g.lower(d.where) + '.';
    },
    plan(res, env) { const d = res.data; return { entries: [{ ref: 'main', type: 'plot', title: res.title, summary: res.summary, fields: { status: 'Seed', stakes: d.complication, reward: d.reward, resolution: d.twist }, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- rumour ---------------- */
  G.define({
    id: 'rumour', name: 'Rumours', icon: '❝', group: 'Story', creates: 'note', desc: 'Whispers for the tavern: who says it, and whether it is true. Uses your own characters and places.',
    inputs: [{ key: 'count', label: 'How many', kind: 'number', def: 4, min: 1, max: 12 }],
    generate(g) {
      const o = g.opts, n = Math.max(1, Math.min(12, +o.count || 4));
      g.section('rumours', 'Rumours', 'items', t => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const text = cap(G.fill(t, '@rumourLine', { cast: () => castOr(t, o, ['the miller', 'the priest', 'the harbourmaster\'s wife', 'a travelling bard']), place: () => placeOr(t, o, G.W.place) })) + '.';
          out.push({ title: '“' + text + '”', sub: 'heard from ' + t.pick('rumourSource'), secret: t.pick(['True.', 'True.', 'False.', 'Partly true.', 'True, but not how they think.']) });
        }
        return out;
      });
      g.res.title = 'Rumours';
      g.res.summary = n + ' rumours to spread.';
    },
    plan(res) { return { entries: [{ ref: 'main', type: 'note', title: 'Rumours', summary: res.summary, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- plot twist ---------------- */
  G.define({
    id: 'twist', name: 'Plot twist', icon: '↯', group: 'Story', creates: 'note', desc: 'Turns for a story that has gone too smoothly — using your own cast when it can.',
    inputs: [{ key: 'count', label: 'How many', kind: 'number', def: 3, min: 1, max: 8 }],
    generate(g) {
      const o = g.opts, n = Math.max(1, Math.min(8, +o.count || 3));
      g.section('twists', 'Twists', 'list', t => t.sample('twist', n).map(x => cap(G.fill(t, x, { cast: () => castOr(t, o, ['the mentor', 'the patron', 'the hero\'s oldest friend', 'the innkeeper']), place: () => placeOr(t, o, G.W.place) })) + '.'));
      g.res.title = 'Plot twists';
      g.res.summary = g.res.sections[0].value[0];
    },
    plan(res) { return { entries: [{ ref: 'main', type: 'note', title: 'Plot twists', summary: res.summary, body: '<ol>' + res.sections[0].value.map(x => '<li><span class="wb-s">' + esc(x) + '</span></li>').join('') + '</ol>' }], open: 'main' }; },
  });

  /* ---------------- weather ---------------- */
  const CLIMATES = {
    temperate: { label: 'Temperate', t: { spring: [6, 16], summer: [14, 26], autumn: [5, 15], winter: [-4, 6] }, wet: 0.4, snow: 0.3 },
    coastal: { label: 'Coastal', t: { spring: [7, 14], summer: [14, 22], autumn: [8, 15], winter: [1, 8] }, wet: 0.55, snow: 0.12, fog: 0.3, windy: 0.5 },
    arctic: { label: 'Arctic', t: { spring: [-15, 0], summer: [0, 12], autumn: [-12, 2], winter: [-35, -15] }, wet: 0.3, snow: 0.95, windy: 0.45 },
    desert: { label: 'Desert', t: { spring: [16, 32], summer: [26, 45], autumn: [15, 30], winter: [4, 20] }, wet: 0.05, snow: 0, windy: 0.3, dust: 0.2 },
    tropical: { label: 'Tropical', t: { spring: [23, 32], summer: [25, 34], autumn: [23, 31], winter: [20, 29] }, wet: 0.65, snow: 0, storm: 0.25 },
    highland: { label: 'Highland', t: { spring: [0, 10], summer: [8, 18], autumn: [-1, 9], winter: [-14, -2] }, wet: 0.45, snow: 0.6, windy: 0.55, fog: 0.2 },
    swamp: { label: 'Marsh', t: { spring: [10, 20], summer: [20, 31], autumn: [10, 21], winter: [0, 9] }, wet: 0.5, snow: 0.08, fog: 0.4 },
  };
  G.define({
    id: 'weather', name: 'Weather', icon: '☁', group: 'World', creates: 'note', desc: 'A few days of weather for the season of your world\'s calendar, with travel effects.',
    inputs: [{ key: 'climate', label: 'Climate', kind: 'choice', def: 'temperate', options: Object.entries(CLIMATES).map(([k, c]) => [k, c.label]) },
      { key: 'season', label: 'Season', kind: 'choice', def: 'auto', options: [['auto', 'From the world date'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']] },
      { key: 'days', label: 'Days', kind: 'number', def: 3, min: 1, max: 7 }],
    generate(g) {
      const o = g.opts, d = g.res.data, C = CLIMATES[o.climate] || CLIMATES.temperate;
      d.season = o.season && o.season !== 'auto' ? o.season : o.worldSeason || 'spring';
      const n = Math.max(1, Math.min(7, +o.days || 3)), [lo, hi] = C.t[d.season] || C.t.spring;
      g.section('days', 'Forecast', 'items', t => {
        let temp = lo + (hi - lo) * (0.3 + t.f() * 0.4), wet = t.f() < C.wet;
        const out = [];
        for (let i = 0; i < n; i++) {
          temp = Math.max(lo - 4, Math.min(hi + 4, temp + t.int(-4, 4)));
          if (t.chance(0.35)) wet = !wet && t.f() < C.wet * 1.4;
          const cold = temp <= 0, hot = temp >= 30, storm = wet && t.chance(C.storm || 0.12), fog = !wet && t.chance(C.fog || 0.08), dust = !wet && t.chance(C.dust || 0);
          const wind = t.weighted([['still', 2], ['a light breeze', 4], ['a steady wind', 3 + (C.windy || 0) * 4], ['gusts that tug at cloaks', 1 + (C.windy || 0) * 4], ['a gale', 0.3 + (C.windy || 0)]]);
          const sky = storm ? (cold ? 'a blizzard' : 'a storm with thunder') : wet ? (cold ? t.pick(['steady snow', 'sleet', 'snow showers']) : t.pick(['steady rain', 'showers', 'drizzle', 'a downpour by afternoon'])) : fog ? 'thick fog until noon' : dust ? 'a dust haze' : t.pick(['clear skies', 'scattered clouds', 'high grey cloud', 'a bright, cold sky', 'broken cloud and sun']);
          const feel = cold ? (temp < -15 ? 'bitterly cold' : 'freezing') : hot ? (temp > 38 ? 'scorching' : 'hot') : temp < 8 ? 'chilly' : temp < 16 ? 'mild' : temp < 24 ? 'warm' : 'very warm';
          const effect = storm ? 'Travel is dangerous; shelter is worth paying for.' : fog ? 'Visibility a few yards; easy to get lost or ambushed.' : cold && wet ? 'Slow going; risk of frostbite without warm gear.' : hot ? 'Travellers need double water; rest at midday.' : wind === 'a gale' ? 'Ships stay in harbour; ranged attacks suffer.' : wet ? 'Muddy roads slow carts; tracks are easy to follow.' : 'Good travelling weather.';
          out.push({ title: 'Day ' + (i + 1) + ': ' + cap(sky), sub: cap(feel) + ', about ' + Math.round(temp) + '°C (' + Math.round(temp * 9 / 5 + 32) + '°F), ' + wind, text: effect });
        }
        d.days = out;
        return out;
      });
      g.section('omen', 'Something in the sky', 'text', t => (d.omen = t.chance(0.5) ? cap(t.pick(['a ring around the moon', 'a red dawn', 'swallows flying low', 'a comet faint in the west', 'the aurora, unusually far south', 'a rainbow at midnight', 'birds silent all morning', 'hail the size of hazelnuts, once, and then nothing'])) + '.' : 'Nothing out of the ordinary.'));
      g.res.title = 'Weather' + (o.dateText ? ', ' + o.dateText : '');
      g.res.summary = cap(d.season) + ' in a ' + C.label.toLowerCase() + ' climate: ' + g.lower(d.days[0].title.replace(/^Day 1: /, '')) + '.';
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'note', title: res.title, summary: res.summary, body: G.html(res), start: env.now || null }], open: 'main' }; },
  });

  /* ---------------- treasure ---------------- */
  const HOARDS = { pocket: ['Pocket', 30, 0, 0], purse: ['Purse', 200, 1, 0], chest: ['Chest', 1500, 3, 1], hoard: ['Hoard', 9000, 6, 3], dragon: ['Dragon\'s hoard', 60000, 12, 6] };
  const ART = 'a {metal} goblet set with {gem}s|an embroidered tapestry of a hunt|a carved {material} chess set|a painted icon of {holy}|a silver mirror with a cracked frame|a jewelled dagger never meant for fighting|a crown of {metal} leaves|a music box with a dancing {animal}|a ceremonial mask of {material}|a pair of {metal} candlesticks|a portrait of a forgotten queen|an astrolabe of brass and {material}';
  const WONDROUS = 'a cloak that drinks the rain|boots that leave no tracks|a lantern that shows hidden writing|a ring that warms near danger|a bottomless wine flask (mostly bottomless)|a key that opens one door, once|a compass that points to the owner\'s heart\'s desire|a quill that writes what is dictated|a bag larger inside than out|a whistle only animals hear|a shield that remembers every blow|a stone that floats above water';
  G.define({
    id: 'treasure', name: 'Treasure', icon: '⚱', group: 'Things', creates: 'item', desc: 'Coins in your world\'s currencies, gems, art, curiosities and (with magic) wonders.',
    inputs: [{ key: 'size', label: 'Size', kind: 'choice', def: 'chest', options: Object.entries(HOARDS).map(([k, v]) => [k, v[0]]) }, magicInput],
    generate(g) {
      const o = g.opts, d = g.res.data, [label, base, gems, art] = HOARDS[o.size] || HOARDS.chest, cs = coins(o);
      d.total = 0;
      g.section('coins', 'Coins', 'list', t => {
        let budget = base * (0.6 + t.f() * 0.8);
        d.total += budget;
        const out = [];
        cs.forEach((c, i) => { const share = i === cs.length - 1 ? budget : budget * (i === cs.length - 2 ? 0.8 + t.f() * 0.15 : 0.35 + t.f() * 0.4); const k = Math.floor(share / c.value); if (k > 0) { out.push(G.num(k) + ' ' + (k === 1 ? c.name : plural(c.name)) + ' (' + c.abbr + ')'); budget -= k * c.value; } });
        return out.length ? out : ['A handful of ' + cs[cs.length - 1].name];
      });
      g.section('gems', 'Gems', 'items', t => { const n = gems ? t.int(Math.max(1, gems - 2), gems + 2) : 0, out = []; for (let i = 0; i < n; i++) { const v = t.pick([10, 25, 50, 50, 100, 100, 250, 500, 1000]) * cs[cs.length - 1].value * 10 / 10; d.total += v; out.push({ title: cap(t.pick('gem')), sub: t.pick(['rough', 'cut', 'polished', 'flawed', 'flawless', 'set in a ring']), price: money(v, o) }); } return out; });
      g.section('art', 'Art & valuables', 'items', t => { const n = art ? t.int(Math.max(1, art - 1), art + 1) : t.chance(0.4) ? 1 : 0, out = []; const arts = t.sample(G.split(ART), n); for (const a of arts) { const v = t.int(4, 40) * 25; d.total += v; out.push({ title: cap(G.fill(t, a)), price: money(v, o) }); } return out; });
      g.section('curious', 'Curiosity', 'text', t => cap(G.fill(t, t.pick(['a letter sealed with a royal seal, unopened', 'a child\'s wooden toy, lovingly repaired', 'a map with one island circled in blood', 'a tooth from something enormous', 'a diary that ends mid-sentence', 'a {metal} key to an unknown lock']))) + '.');
      if (magicLvl(o.magic) >= 1) g.section('wonders', 'Wondrous', 'list', t => t.sample(G.split(WONDROUS), Math.max(0, Math.min(4, (magicLvl(o.magic) - 1) + (HOARDS[o.size] ? Object.keys(HOARDS).indexOf(o.size) - 1 : 1)))).map(cap));
      g.res.title = label;
      g.res.summary = label + ' worth about ' + money(d.total, o) + ' in all.';
    },
    plan(res) { return { entries: [{ ref: 'main', type: 'item', title: res.title, summary: res.summary, fields: { kind: 'Treasure', value: res.summary.replace(/^.* worth about /, '').replace(/ in all\.$/, ''), properties: [].concat(...res.sections.filter(s => s.kind === 'list').map(s => s.value)) }, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- artifact ---------------- */
  G.define({
    id: 'artifact', name: 'Artifact', icon: '✧', group: 'Things', creates: 'item', desc: 'A legendary object: form, look, legend, powers, the price of using it and where it is now.',
    inputs: [magicInput],
    generate(g) {
      const o = g.opts, d = g.res.data;
      g.section('form', 'Form', 'kv', t => { d.form = t.pick(['blade', 'crown', 'ring', 'mirror', 'book', 'lantern', 'bell', 'cup', 'mask', 'staff', 'key', 'map', 'cloak', 'compass', 'harp', 'seed', 'spear', 'shield', 'circlet', 'chalice', 'locket', 'horn']); d.material = t.pick('material'); d.metal = t.pick('metal'); return [['Form', cap(d.form)], ['Made of', cap(d.metal) + ' and ' + d.material], ['Looks like', cap(G.fill(t, t.pick(['it is always slightly wet', 'it hums when held', 'it was broken and mended with gold', 'it is plain, almost ugly', 'it shows a {beast} coiled around it', 'its surface reflects a different room', 'it is warm as skin'])))]]; });
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick(['the {adjInn} {form}', 'the {form} of {holy}', '{owner}\'s {form}', 'the {colour} {form}', 'the {form} of Tides', 'the Last {form}']), { form: cap(d.form), owner: g.person(t, { noFamily: true, style: o.nameStyle || 'common' }) })));
      g.section('legend', 'Legend', 'text', t => (d.legend = cap(G.fill(t, t.pick(['forged to end a war, it started three more', 'made by {holy} for a mortal lover', 'it was found in the belly of a {beast}', 'every ruler who held it died at sea', 'it was the price of a city\'s surrender', 'a smith gave their life to quench it']))) + '.'));
      g.section('powers', 'Powers', 'list', t => (d.powers = magicLvl(o.magic) === 0 ? t.sample(['its bearer is always believed', 'it is worth a kingdom to the right buyer', 'the faithful will follow whoever holds it', 'it unlocks a vault no one else can open'], 2).map(cap) : t.sample(['calls fog from the sea', 'lets the bearer speak with the drowned', 'turns blades that strike in anger', 'shows the true face of whoever looks into it', 'stops time for a single breath, once a day', 'makes any lock forget it was locked', 'lets the bearer walk on water', 'heals a wound by moving it elsewhere', 'reveals the way home from anywhere', 'commands the obedience of beasts', 'makes the bearer unseen while they hold their breath', 'answers one question each new moon'], magicLvl(o.magic) >= 2 ? 3 : 2).map(cap)));
      g.section('cost', 'Cost', 'text', t => (d.cost = cap(t.pick(['each use takes a memory', 'it whispers to the bearer at night', 'the bearer\'s shadow grows longer every day', 'it must be fed blood once a month', 'animals flee from the bearer', 'it slowly turns the bearer\'s hair white', 'it will betray its bearer to a worthier one'])) + '.'));
      g.section('where', 'Where it is now', 'text', t => (d.where = cap(placeOr(t, o, ['in a merchant\'s private collection', 'buried with a forgotten king', 'on the altar of a cult', 'at the bottom of the harbour', 'in a museum, mislabelled', 'carried by someone who does not know what it is'])) + '.'));
      g.section('truth', 'True nature', 'text', t => (d.truth = cap(t.pick(['it is one of a pair, and the other is hunting it', 'it is a prison, and the prisoner is waking', 'it is a fake; the real one was destroyed', 'it is alive, and patient', 'whoever made it is still alive and wants it back'])) + '.'), { secret: true });
      g.res.summary = cap(G.article('a ' + d.form)) + ' of ' + d.metal + ' and ' + d.material + '. ' + d.legend;
    },
    plan(res) { const d = res.data; return { entries: [{ ref: 'main', type: 'item', title: d.name, summary: res.summary, fields: { kind: 'Relic', properties: d.powers, curse: d.cost + ' ' + d.truth, value: 'Priceless' }, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- ship ---------------- */
  const SHIPS = { cog: ['Cog', [6, 20], 'one square sail and a high stern'], caravel: ['Caravel', [12, 30], 'fast, lateen-rigged and nimble'], carrack: ['Carrack', [40, 120], 'tall castles fore and aft'], galley: ['Galley', [60, 200], 'oars and a ram at the prow'], longship: ['Longship', [20, 60], 'shallow-drafted with a dragon prow'], junk: ['Junk', [15, 50], 'battened sails like folding fans'], sloop: ['Sloop', [6, 18], 'small, quick and easy to hide'], barge: ['River barge', [3, 10], 'flat, broad and slow'], skyship: ['Sky-ship', [10, 40], 'held aloft by a bound storm', 2] };
  G.define({
    id: 'ship', name: 'Ship', icon: '⛵', group: 'Things', creates: 'place', desc: 'A vessel with a captain, crew, cargo, a quirk and a secret in the hold.',
    inputs: [{ key: 'purpose', label: 'Purpose', kind: 'choice', def: '', options: [RANDOM, ['merchant', 'Merchant'], ['fishing', 'Fishing'], ['war', 'Warship'], ['pirate', 'Pirate'], ['pilgrim', 'Pilgrim or passenger']] }, magicInput],
    generate(g) {
      const o = g.opts, d = g.res.data, st = g.rng('setup');
      d.purpose = o.purpose || st.pick(['merchant', 'merchant', 'fishing', 'war', 'pirate', 'pilgrim']);
      d.type = st.pick(Object.keys(SHIPS).filter(k => !SHIPS[k][3] || magicLvl(o.magic) >= SHIPS[k][3]));
      const S = SHIPS[d.type];
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick(['the {adjInn} {nounInn}', 'the {colour} {animal}', '{holy}\'s Mercy', 'the {nounInn} of {town}', 'Widow\'s {nounInn}', 'the Second Chance', 'the {adjInn} Maid', 'the Salt {animal}']), { town: g.place(t, {}) })).replace(/^The The /, 'The '));
      g.section('vessel', 'Vessel', 'kv', t => { d.crew = t.between(S[1]); d.condition = t.pick(['newly built', 'well kept', 'patched but sound', 'leaking slowly', 'scarred from battle', 'freshly painted over old damage']); return [['Type', S[0] + ', ' + S[2]], ['Crew', d.crew + ' hands'], ['Condition', cap(d.condition)], ['Flies', cap(G.fill(t, t.pick(['the colours of {town}', 'no flag at all', 'a black flag with a {animal}', 'the banner of a merchant house', 'a temple pennant']), { town: g.place(t, {}) }))]]; });
      g.section('captain', 'Captain', 'kv', t => { d.captain = { name: g.person(t, { style: o.nameStyle || 'common' }), trait: t.pick('trait'), want: t.pick('want') }; return [['Captain', d.captain.name], ['Manner', cap(d.captain.trait)], ['Wants', cap(d.captain.want)]]; });
      g.section('cargo', 'Cargo', 'list', t => (d.cargo = t.sample(d.purpose === 'fishing' ? ['salted herring', 'live crabs', 'nets and floats', 'a catch of eels'] : d.purpose === 'war' ? ['powder and shot', 'marines', 'a captured enemy officer', 'dispatches for the admiral'] : d.purpose === 'pilgrim' ? ['forty pilgrims', 'holy relics', 'a sick noble', 'a choir'] : ['wine casks', 'bolts of silk', 'salt', 'timber', 'spices', 'iron ingots', 'wool bales', 'passengers', 'a caged {beast}', 'barrels marked "fish" that are not fish'], 2).map(x => cap(G.fill(t, x)))));
      g.section('quirk', 'Quirk', 'text', t => (d.quirk = cap(t.pick(['the ship\'s cat is treated as an officer', 'the crew sings to the sea every dusk', 'the figurehead was carved from a saint\'s door', 'nobody may whistle aboard', 'the cook is the real power on board', 'the ship has sunk twice and been raised twice'])) + '.'));
      g.section('secret', 'In the hold', 'text', t => (d.secret = cap(G.fill(t, t.pick(['a stowaway with a price on their head', 'a second set of papers under another name', '{target}', 'a cargo of weapons for rebels', 'the real captain, locked away', 'a map of the navy\'s winter anchorage']))) + '.'), { secret: true });
      g.res.summary = cap(G.article('a ' + d.condition + ' ' + S[0].toLowerCase())) + ' (' + d.purpose + '), captained by ' + d.captain.name + '.';
    },
    plan(res, env) { return { entries: [{ ref: 'main', type: 'place', title: res.data.name, summary: res.summary, fields: { kind: 'Vessel', features: res.data.cargo }, body: G.html(res), parentId: env.parentId || null }], open: 'main' }; },
  });

  /* ---------------- deity ---------------- */
  const DOMAINS = 'the sea|storms|the harvest|death|the moon|the sun|fire|the forge|healing|war|trickery|love|the hunt|knowledge|the dead|travel|luck|justice|secrets|dreams|beasts|wine|thresholds|debts|childbirth|salt|lost things|mountains|plague|music';
  G.define({
    id: 'deity', name: 'Deity', icon: '☉', group: 'Beliefs', creates: 'lore', desc: 'A god with domains, titles, symbol, temperament, worship, taboos and a myth.',
    inputs: [{ key: 'culture', label: 'Culture', kind: 'culture' }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      g.section('domains', 'Domains', 'list', t => (d.domains = t.sample(G.split(DOMAINS), t.int(2, 3)).map(cap)));
      d.name = g.section('name', 'Name', 'title', t => N.generate({ style: o.nameStyle || t.pick(['flowing', 'regal', 'arcane', 'sea', 'harsh']), kind: 'person', count: 1, rng: t.rng, samples: o.names && o.names.given && o.names.given.length >= 3 ? o.names.given : null })[0] || 'Ora');
      g.section('titles', 'Titles', 'list', t => (d.titles = t.sample(['the ' + t.pick(['Drowned', 'Patient', 'Hollow', 'Burning', 'Grey', 'Silent', 'Laughing', 'Weeping', 'Twice-born', 'Unsleeping']) + ' ' + t.pick(['King', 'Queen', 'Mother', 'Father', 'Judge', 'Shepherd', 'Stranger', 'Smith', 'Keeper']), 'Keeper of ' + d.domains[0], 'the One Who ' + t.pick(['Waits', 'Answers', 'Remembers', 'Counts the Dead', 'Walks the Tide', 'Lights the Way']), 'Lord of ' + (d.domains[1] || d.domains[0]), 'Mother of ' + t.pick(['Gulls', 'Wolves', 'Ships', 'Kings', 'Orphans'])], 2)));
      g.section('nature', 'Nature', 'kv', t => { d.symbol = cap(G.fill(t, t.pick(['a {metal} {animal}', 'an open hand holding {material}', 'a broken wheel', 'two crossed oars', 'a closed eye', 'a lantern with no flame', 'a spiral of seven stars']))); d.temper = t.pick(['jealous and generous', 'distant and just', 'playful and cruel', 'gentle but implacable', 'proud and easily slighted', 'sorrowful and kind']); return [['Symbol', d.symbol], ['Temper', cap(d.temper)], ['Depicted as', cap(G.fill(t, t.pick(['a veiled figure walking on water', 'a giant with a {animal}\'s head', 'a child holding a candle', 'an old woman with salt in her hair', 'a warrior with a broken sword', 'a shape of smoke and stars'])))], ['Sacred animal', cap(t.pick('animal'))]]; });
      g.section('worship', 'Worship', 'kv', t => [['Worshippers', cap(t.pick(['sailors and their families', 'farmers and herders', 'soldiers and widows', 'thieves and gamblers', 'scholars and scribes', 'midwives and healers', 'the poor', 'rulers, in public']))], ['Offerings', cap(G.fill(t, t.pick(['salt thrown into the sea', 'bread left at crossroads', 'a lock of hair', 'songs at dusk', 'the first cup of every barrel', '{metal} coins dropped into wells'])))], ['Holy day', o.months && o.months.length ? 'The ' + t.pick(['first', 'last', 'ninth', 'thirteenth']) + ' day of ' + t.pick(o.months) : cap(t.pick(['midwinter', 'the spring tide', 'the harvest moon', 'the longest day']))], ['Taboo', cap(t.pick(['never speak their name over water', 'never refuse a stranger shelter', 'never eat the flesh of their sacred animal', 'never break a promise sworn in their name', 'never let a fire die in their shrine']))]]);
      g.section('myth', 'A myth', 'text', t => (d.myth = cap(G.fill(t, t.pick(['{name} once lost a wager to death and has paid in tides ever since', '{name} wept for a drowned city, and the sea became salt', '{name} stole fire from the sun and hid it in the forge of the first smith', '{name} was born from the last breath of a dying {beast}', '{name} and their twin divided the world; one took the day, and lied about it']), { name: d.name })) + '.'));
      g.res.summary = d.name + ', ' + d.titles[0] + ': god of ' + G.joinAnd(d.domains.map(G.lower)) + '.';
    },
    plan(res) { return { entries: [{ ref: 'main', type: 'lore', title: res.data.name, aliases: res.data.titles, summary: res.summary, fields: { category: 'Deity' }, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- religion ---------------- */
  G.define({
    id: 'religion', name: 'Religion', icon: '✚', group: 'Beliefs', creates: 'lore', desc: 'A faith: what it believes, how it worships, its clergy, holy places and its schism.',
    inputs: [{ key: 'kind', label: 'Kind', kind: 'choice', def: '', options: [RANDOM, ['pantheon', 'Many gods'], ['one', 'One god'], ['two', 'Two powers'], ['ancestors', 'Ancestors'], ['spirits', 'Spirits of places'], ['philosophy', 'A philosophy'], ['mystery', 'Mystery cult']] }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      d.kind = o.kind || g.rng('setup').pick(['pantheon', 'one', 'two', 'ancestors', 'spirits', 'philosophy', 'mystery']);
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick(['the Church of {holy}', 'the Way of {thing}', 'the {colour} Covenant', 'the Faith of the {num} {plural}', 'the Order of {holy}', 'the Old Rite', 'the {thing} Path']), { thing: () => t.pick(['Salt', 'Tides', 'Embers', 'Stars', 'Roots', 'Lanterns', 'Silence', 'Bones']), num: () => t.pick(['Seven', 'Nine', 'Three', 'Twelve']), plural: () => t.pick(['Winds', 'Saints', 'Moons', 'Gates', 'Sisters']) })));
      g.section('beliefs', 'Core beliefs', 'list', t => (d.tenets = t.sample(['the dead are owed a debt by the living', 'every soul is weighed against salt', 'suffering in this life is paid back in the next', 'the gods sleep, and must not be woken', 'all things return to the sea', 'kindness to strangers is the highest duty', 'the world will end in fire, and begin again', 'the body is borrowed and must be returned clean', 'names hold power and must be guarded', 'the first-born belong to the faith', 'truth is spoken only in song', 'every place has a spirit that must be thanked'], 3).map(cap)));
      g.section('practice', 'Practice', 'list', t => t.sample(['prayer at the turning of each tide', 'fasting on the new moon', 'pilgrimage once in a lifetime', 'confession to a masked priest', 'burial at sea', 'offerings of bread and salt', 'silent meditation at dawn', 'a yearly procession with lanterns', 'tattoos marking each vow', 'the dead are burned and their ashes scattered on fields'], 3).map(cap));
      g.section('clergy', 'Clergy', 'kv', t => [['Led by', cap(t.pick(['a high priest elected for life', 'a council of nine elders', 'whoever survives the trial of the waters', 'a child chosen by omens', 'no one; every believer is a priest']))], ['Priests', cap(t.pick(['shave their heads and wear grey', 'go masked in public', 'may never marry', 'must have survived drowning', 'are drawn from one family', 'wander and own nothing']))], ['Holy text', cap(G.fill(t, t.pick(['the Book of {holy}', 'a song cycle never written down', 'the Salt Scrolls', 'carvings on a cliff face', 'the Testament of the First Tide'])))]]);
      g.section('places', 'Holy places', 'list', t => t.sample(['a cathedral built over a sea cave', 'a mountain monastery', 'a ring of stones on a moor', 'a sunken temple visible at low tide', 'a hermit\'s spring', 'the tomb of the founder', 'a forest grove where nothing is cut'], 2).map(cap));
      g.section('schism', 'Schism', 'text', t => (d.schism = cap(t.pick(['a reformer says the priests have hidden the true scripture', 'a sect believes the god has died and must be reborn', 'the faithful are split over whether outsiders may convert', 'a heretic order keeps the old, bloodier rites', 'two high priests each claim the office'])) + '.'));
      g.res.summary = { pantheon: 'A faith of many gods', one: 'A faith in one god', two: 'A faith of two opposed powers', ancestors: 'An ancestor faith', spirits: 'A faith of spirits and places', philosophy: 'A philosophy lived as faith', mystery: 'A mystery cult' }[d.kind] + ': ' + g.lower(d.tenets[0]) + '.';
    },
    plan(res) { return { entries: [{ ref: 'main', type: 'lore', title: res.data.name, summary: res.summary, fields: { category: 'Religion', rules: res.data.tenets }, body: G.html(res) }], open: 'main' }; },
  });

  /* ---------------- faction ---------------- */
  const FACTIONS = { guild: 'Guild', cult: 'Cult', gang: 'Gang', order: 'Order', house: 'House', company: 'Company', council: 'Council', church: 'Church', army: 'Army' };
  G.define({
    id: 'faction', name: 'Faction', icon: '⚑', group: 'People', creates: 'faction', desc: 'A group with a name, motto, goals, methods, leader, resources, rivals and a hidden agenda.',
    inputs: [{ key: 'kind', label: 'Kind', kind: 'choice', def: '', options: [RANDOM].concat(Object.entries(FACTIONS)) }],
    generate(g) {
      const o = g.opts, d = g.res.data;
      d.kind = FACTIONS[o.kind] ? o.kind : g.rng('setup').pick(Object.keys(FACTIONS));
      d.name = g.section('name', 'Name', 'title', t => title(G.fill(t, t.pick({ guild: ['the Guild of {jobCommon}s', 'the {colour} Hand', 'the Honest Measure'], cult: ['the Children of {holy}', 'the Drowned Choir', 'the {colour} Veil'], gang: ['the {animal}s', 'the Rope Street Knives', 'the {colour} Caps'], order: ['the Order of {holy}', 'the Knights of the {nounInn}', 'the Grey Wardens'], house: ['House {family}', 'the House of the {animal}'], company: ['the {colour} Company', 'the {nounInn} Trading Company', 'the Free Lances'], council: ['the Council of {num}', 'the Quiet Chamber'], church: ['the Church of {holy}', 'the Lantern Faith'], army: ['the {colour} Legion', 'the Army of {holy}', 'the Old Guard'] }[d.kind]), { family: () => g.person(t, { noFamily: true, style: o.nameStyle || 'common' }), num: () => t.pick(['Nine', 'Five', 'Twelve', 'Three']) })));
      g.section('identity', 'Identity', 'kv', t => { d.motto = '“' + cap(t.pick(['salt keeps', 'we remember', 'the tide returns', 'no debt unpaid', 'from the deep, strength', 'quiet hands, full purses', 'one voice', 'light in the dark', 'we do not kneel'])) + '.”'; d.symbol = cap(G.fill(t, t.pick(['a {metal} {animal} on {colour}', 'a closed fist holding a key', 'a burning ship', 'three {colour} stars', 'a broken chain'])));
        return [['Kind', FACTIONS[d.kind]], ['Motto', d.motto], ['Symbol', d.symbol], ['Members', G.num(t.pick([12, 30, 80, 200, 500, 2000]) * (0.8 + t.f() * 0.5))]]; });
      g.section('goals', 'Goals & methods', 'kv', t => { d.goal = cap(t.pick(['control the harbour trade', 'restore a fallen dynasty', 'wake a sleeping god', 'protect the town from what lies beneath', 'buy the town council', 'find the lost founder\'s treasure', 'drive out the foreigners', 'end the old feud by any means'])); d.methods = cap(t.pick(['bribes and favours', 'quiet murder', 'charity and sermons', 'smuggling', 'blackmail', 'open force', 'marriage alliances', 'patient legal manoeuvres'])); return [['Wants', d.goal], ['Methods', d.methods], ['Resources', cap(G.joinAnd(t.sample(['money', 'informants', 'a fortified hall', 'sellswords', 'a fleet of small boats', 'friends on the council', 'forbidden lore', 'the loyalty of the poor'], 2)))]]; });
      g.section('leader', 'Leader', 'kv', t => { d.leader = { name: g.person(t, { style: o.nameStyle || 'common' }), title: t.pick(['Master', 'Mother', 'Captain', 'Prior', 'Speaker', 'Head', 'Chancellor', 'the Elder']), trait: t.pick('trait') }; return [['Leader', d.leader.title + ' ' + d.leader.name], ['Manner', cap(d.leader.trait)]]; });
      g.section('relations', 'Friends & foes', 'kv', t => [['Allies', cap(castOr(t, o, ['the merchant guilds', 'a noble house', 'the temple', 'a smugglers\' ring']))], ['Rivals', cap(castOr(t, o, ['the town watch', 'a rival guild', 'the crown\'s tax collectors', 'a heretic order']))]]);
      g.section('agenda', 'Hidden agenda', 'text', t => (d.agenda = cap(t.pick(['the leader is a puppet for someone outside the faction', 'they plan to betray their allies at the next festival', 'they are bankrupt and hiding it', 'their founder never died', 'they serve the very thing they claim to fight'])) + '.'), { secret: true });
      g.res.summary = FACTIONS[d.kind] + ' that wants to ' + g.lower(d.goal) + ', by ' + g.lower(d.methods) + '.';
    },
    plan(res) { const d = res.data; return { entries: [{ ref: 'main', type: 'faction', title: d.name, summary: res.summary, fields: { kind: FACTIONS[d.kind] === 'Army' ? 'Army' : FACTIONS[d.kind], motto: d.motto, goals: d.goal + '. Methods: ' + G.lower(d.methods) + '.', agenda: d.agenda }, body: G.html(res) }], open: 'main' }; },
  });
  return G;
});
