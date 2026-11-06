/* Town generator: a whole settlement from a seed — name, population and peoples, districts, economy, defences,
   government, notable locations with owners, residents, problems and rumours, festivals, laws, an overview, and the
   plan that turns it into entries (the town, districts, locations, residents, a town map and pins). Original tables. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./gen-words.js') : root.WBGen;
  factory(G);
  if (node) module.exports = G;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const T = {};
  G.town = T;

  /* ---------------- sizes ---------------- */
  T.SIZES = {
    thorp: { label: 'Thorp', pop: [12, 80], districts: [1, 1], locations: [2, 3], residents: 3, kind: 'Village', walls: 0, idx: 0 },
    hamlet: { label: 'Hamlet', pop: [81, 400], districts: [1, 2], locations: [3, 5], residents: 4, kind: 'Village', walls: 0.1, idx: 1 },
    village: { label: 'Village', pop: [401, 1200], districts: [2, 3], locations: [5, 7], residents: 5, kind: 'Village', walls: 0.3, idx: 2 },
    town: { label: 'Town', pop: [1201, 8000], districts: [3, 5], locations: [7, 10], residents: 6, kind: 'Town', walls: 0.75, idx: 3 },
    city: { label: 'City', pop: [8001, 60000], districts: [5, 8], locations: [10, 14], residents: 8, kind: 'City', walls: 0.95, idx: 4 },
    metropolis: { label: 'Metropolis', pop: [60001, 450000], districts: [8, 11], locations: [13, 18], residents: 10, kind: 'City', walls: 1, idx: 5 },
  };
  const SIZE_KEYS = Object.keys(T.SIZES);
  /** Atlas pin icons for the kinds of location */
  T.PIN_ICON = { inn: 'inn', tavern: 'inn', temple: 'temple', shrine: 'temple', almshouse: 'temple', graveyard: 'temple', market: 'market', store: 'market', apothecary: 'market', jeweller: 'market', countinghouse: 'market', alchemist: 'market', smithy: 'market', brewery: 'market', stables: 'market', mill: 'market', printer: 'market',
    keep: 'castle', watch: 'castle', gaol: 'castle', docks: 'port', shipwright: 'port', lighthouse: 'lighthouse', tower: 'tower', minehead: 'mine', caravanserai: 'camp', arena: 'battle', lodge: 'forest', library: 'landmark', theatre: 'landmark', bathhouse: 'landmark', guildhall: 'landmark', clocktower: 'landmark' };

  /* ---------------- terrains ---------------- */
  const t = (o) => o;
  T.TERRAINS = {
    coast: t({ label: 'Coast', adj: 'coastal', climate: 'Mild, wet and salt-winded', water: 'sea',
      exports: 'salted fish|dried kelp|sea salt|river pearls|oyster-shell lime|whale oil|smoked eel|ship rope|sailcloth|amber from the tideline',
      industry: 'fishing|salt-panning|boatbuilding|net-making|fish-smoking|rope-walking|wrecking (quietly)',
      imports: 'timber|grain|iron|wool|wine', danger: 'winter storms|wreckers|sea raiders|a sea serpent sighted off the point|sudden fogs|press gangs from the navy',
      feature: 'a lighthouse on the point|tidal caves under the cliffs|a wrecked hull on the shoals|white chalk cliffs|a long shingle beach|a tide-bell that rings itself in storms|salt pans glittering in rows',
      prefix: 'Salt|Gull|Brine|Kelp|Wrack|Shell|Tide|Gale|Spray|Cockle|Herring|Seal|Foam|Ness|Storm|Sand', suffix: 'haven|mouth|wick|holm|strand|port|cove|ness|by|mere|hithe|sound',
      food: 'smoked herring|oyster stew|kelp bread|salt cod pie|grilled mackerel|crab boiled in ale', style: 'sea' }),
    river: t({ label: 'River', adj: 'riverside', climate: 'Temperate, foggy at dawn', water: 'river',
      exports: 'milled flour|eels|river-clay pottery|barley ale|fulled cloth|reed thatch|freshwater pearls|dyed wool',
      industry: 'milling|ferrying|tanning|dyeing|pottery|brewing|barge-building',
      imports: 'salt|iron|stone|spices', danger: 'spring floods|river pirates|toll disputes upstream|a drowned mill that still turns|something in the deep pool|fever from the low meadows',
      feature: 'an old stone bridge of nine arches|a weir and a roaring mill-race|willow islands|a ford marked with standing stones|a ferry chain across the water|water meadows that flood each spring',
      prefix: 'Ford|Mill|Weir|Brook|Willow|Eel|Alder|Reed|Bridge|Otter|Wade|Swan', suffix: 'ford|bridge|wick|ham|bury|mill|ey|stow|mouth|leat',
      food: 'jellied eels|river trout|barley bread|mill-cake|watercress soup|pike in green sauce', style: 'common' }),
    hills: t({ label: 'Hills', adj: 'hill', climate: 'Cool and windy, with soft rain', water: null,
      exports: 'wool|mutton|hard cheese|slate|copper|heather honey|woven blankets|cider',
      industry: 'herding|weaving|quarrying|cheesemaking|copper mining|cider pressing',
      imports: 'grain|salt|timber|cloth dyes', danger: 'restless barrows|landslips after rain|cattle raiders|old feuds between clans|sinkholes|wolves in hard winters',
      feature: 'barrow mounds along the ridge|a chalk figure cut into the hillside|the ring of an old hill fort|dry-stone sheepfolds|a holy spring under an ash tree',
      prefix: 'Barrow|High|Brack|Combe|Knoll|Heather|Ridge|Fell|Down|Tor|Lark|Ewe', suffix: 'combe|ridge|down|ley|ton|hope|low|crest|stead|cleugh',
      food: 'mutton stew|oatcakes|sheep\'s cheese|heather-honey cake|blood pudding|cider', style: 'rustic' }),
    mountains: t({ label: 'Mountains', adj: 'mountain', climate: 'Cold, thin-aired and sudden', water: null,
      exports: 'iron ore|silver|cut stone|gemstones|goat cheese|mountain herbs|furs|ice for the lowlands',
      industry: 'mining|smelting|stonecutting|goat-herding|guiding travellers|gem-cutting',
      imports: 'grain|cloth|wine|salt|timber', danger: 'avalanches|rockfalls|cave-ins|bandits in the passes|early winters|the thing in the deepest mine',
      feature: 'a switchback road with forty bends|rope bridges over the gorge|a mine head with ore carts|a glacier-fed lake|steaming hot springs|a monastery on a ledge',
      prefix: 'Iron|Stone|Crag|Spire|Eagle|Cold|Grey|Pike|Shale|Silver|Frost|Anvil', suffix: 'hold|crag|peak|gate|fell|scar|delve|horn|hame|pass',
      food: 'goat stew|black rye bread|roasted chestnuts|smoked goat|barley porridge|pine-needle tea', style: 'harsh' }),
    forest: t({ label: 'Forest', adj: 'forest', climate: 'Green, damp and sheltered', water: null,
      exports: 'timber|charcoal|furs|honey and wax|pine resin|dried mushrooms|carved bowls|yew bows',
      industry: 'logging|charcoal-burning|trapping|woodcarving|beekeeping|hunting',
      imports: 'salt|iron tools|grain|cloth', danger: 'wolves|poachers|outlaws in the deep wood|the wood itself, when angered|bears|spirits of felled trees',
      feature: 'an ancient oak at the crossroads|a sawmill on the stream|a forest shrine hung with ribbons|a clearing ringed by stones|charcoal mounds smoking day and night',
      prefix: 'Oak|Ash|Elm|Holly|Thorn|Fern|Moss|Hart|Briar|Wild|Rowan|Owl', suffix: 'wood|hurst|holt|den|field|ley|shaw|grove|wold|glade',
      food: 'venison pie|mushroom broth|acorn bread|wild-berry tart|roast boar|honey mead', style: 'flowing' }),
    plains: t({ label: 'Plains', adj: 'plains', climate: 'Open, dry summers and bitter winds', water: null,
      exports: 'grain|horses|cattle|leather|beer|linen|wool|cheese',
      industry: 'farming|horse-breeding|tanning|milling|brewing|cattle droving',
      imports: 'timber|stone|iron|salt', danger: 'drought|locusts|horse thieves|grass fires|raiding riders|crop blight',
      feature: 'a great tithe barn|a windmill on the only rise|a crossroads gibbet|a lone standing stone|endless golden fields|a burial mound everyone ploughs around',
      prefix: 'Wheat|Barley|Long|Wide|Green|Wind|Hay|Horse|Corn|Mead|Lark|Fair', suffix: 'field|ton|stead|ham|by|thorpe|acre|ley|well|cross',
      food: 'beef and barley stew|fresh bread|harvest pie|roast goose|dumplings|brown ale', style: 'common' }),
    desert: t({ label: 'Desert', adj: 'desert', climate: 'Scorching days, freezing nights', water: 'oasis',
      exports: 'glass|spices|dates|salt blocks|dyed cloth|incense|camels|copper',
      industry: 'caravan trade|glassblowing|well-digging|weaving|date farming|incense making',
      imports: 'timber|grain|iron|water skins', danger: 'sandstorms|thirst|scorpions|raiders|mirages that lead travellers astray|a buried city stirring',
      feature: 'a deep well with a spiral stair|a palm-shaded oasis|wind towers that cool the houses|a colossus half-buried in sand|a great caravanserai',
      prefix: 'Sand|Sun|Dune|Palm|Amber|Red|Dry|Mirage|Ochre|Ember|Scorch|Gold', suffix: 'well|wadi|spring|gate|rest|stone|rock|dune|haven|ara',
      food: 'spiced lamb|flatbread|dates and goat cheese|lentil stew|mint tea|honeyed figs', style: 'desert' }),
    tundra: t({ label: 'Tundra', adj: 'northern', climate: 'Frozen half the year, light all summer', water: 'lake',
      exports: 'furs|ivory|whale oil|reindeer hides|smoked fish|amber|walrus tusk',
      industry: 'hunting|reindeer herding|ice-fishing|tanning|bone carving',
      imports: 'grain|timber|iron|wool', danger: 'blizzards|white bears|thin ice|starvation winters|the long dark|wolves that hunt in daylight',
      feature: 'great arches of whalebone|ice-fishing huts on the frozen lake|a steaming vent in the rocks|turf-roofed longhouses|aurora that seems to sing',
      prefix: 'Frost|Snow|Ice|White|Rime|Bear|Elk|Winter|Hoar|North|Sleet|Cold', suffix: 'vik|hold|fell|stead|by|garth|holm|mark|haven|shield',
      food: 'smoked reindeer|fermented fish|blood sausage|cloudberry jam|fish-head soup|hot spiced milk', style: 'nordic' }),
    swamp: t({ label: 'Swamp', adj: 'marsh', climate: 'Humid, misty and buzzing', water: 'pools',
      exports: 'peat|eels|reeds|medicinal leeches|rare herbs|bog iron|dyes|frog leather',
      industry: 'peat-cutting|eel-trapping|herb-gathering|reed-weaving|bog-iron smelting',
      imports: 'grain|stone|timber|salt', danger: 'marsh fever|sucking mud|lights that lead travellers astray|giant leeches|the drowned dead|paths that move',
      feature: 'houses raised on stilts|a maze of boardwalks|a half-sunken temple|lantern posts marking safe paths|a heron rookery|a black pool that never freezes',
      prefix: 'Mire|Bog|Fen|Marsh|Moss|Reed|Heron|Murk|Sedge|Mud|Wet|Still', suffix: 'fen|mire|moor|marsh|pool|wash|ey|sedge|wick|water',
      food: 'eel pie|frog-leg stew|reed-root bread|smoked duck|peat-roasted roots|bitter marsh tea', style: 'common' }),
    island: t({ label: 'Island', adj: 'island', climate: 'Warm, windy, ruled by the sea', water: 'sea',
      exports: 'fish|coral|rum|spices|dyes|pearls|turtle shell|sea salt',
      industry: 'fishing|trade|shipwrighting|pearl-diving|smuggling|rum distilling',
      imports: 'timber|iron|grain|cloth', danger: 'pirates|storms|reefs|isolation when the seas close|a volcano that rumbles|sickness off the ships',
      feature: 'a harbour cut into the cliffs|a watchtower on the summit|palm-lined coves|a great sea arch|a volcano smoking on the horizon',
      prefix: 'Coral|Gull|Reef|Pearl|Turtle|Spray|Blue|Shell|Wind|Sun|Cliff|Palm', suffix: 'isle|holm|ey|cay|port|haven|key|rock|skerry|bay',
      food: 'grilled fish with lime|coconut stew|fried plantain|turtle soup|crab cakes|spiced rum', style: 'sea' }),
  };
  const TERRAIN_KEYS = Object.keys(T.TERRAINS);
  const watery = k => ['coast', 'river', 'island', 'swamp'].includes(k);

  /* ---------------- wealth, magic, technology ---------------- */
  T.WEALTH = {
    destitute: { label: 'Destitute', adj: 'hungry', price: 0.6, classes: [0, 2, 12, 46, 40], look: 'sagging roofs and boarded windows' },
    poor: { label: 'Poor', adj: 'threadbare', price: 0.8, classes: [1, 4, 20, 50, 25], look: 'patched thatch and muddy lanes' },
    modest: { label: 'Modest', adj: 'hard-working', price: 1, classes: [1, 7, 28, 50, 14], look: 'whitewashed walls and tidy yards' },
    comfortable: { label: 'Comfortable', adj: 'prosperous', price: 1.2, classes: [2, 12, 34, 44, 8], look: 'painted shutters and swept streets' },
    wealthy: { label: 'Wealthy', adj: 'rich', price: 1.6, classes: [4, 18, 36, 37, 5], look: 'tiled roofs, glass windows and paved squares' },
    opulent: { label: 'Opulent', adj: 'gilded', price: 2.2, classes: [7, 24, 34, 32, 3], look: 'marble fronts, fountains and gilt weathervanes' },
  };
  const WEALTH_KEYS = Object.keys(T.WEALTH);
  T.CLASSES = ['Nobility & gentry', 'Merchants & masters', 'Artisans & tradesfolk', 'Labourers & servants', 'The destitute'];
  T.MAGIC = { none: 'No magic', rare: 'Rare', common: 'Common', high: 'Everywhere' };
  T.TECH = { ancient: 'Bronze age', medieval: 'Medieval', renaissance: 'Renaissance', industrial: 'Early industrial' };
  const magicLvl = m => ({ none: 0, rare: 1, common: 2, high: 3 })[m] || 0;
  const techLvl = x => ({ ancient: 0, medieval: 1, renaissance: 2, industrial: 3 })[x] || 1;

  /* ---------------- government ---------------- */
  T.GOVERNMENTS = {
    council: { label: 'Council of elders', title: 'Eldest|First Elder|Speaker of Elders', chosen: 'by age and standing', tension: 'the young want a voice the elders will not give|two elders have not spoken to each other in a decade|the eldest is failing and everyone is choosing sides' },
    lord: { label: 'Hereditary lord', title: 'Lord|Baron|Thane|Margrave|High Steward', chosen: 'by birth', tension: 'the heir is a fool and everyone knows it|taxes have doubled to pay for a distant war|the lord\'s bastard is more popular than the heir|the lord has not been seen in public for months' },
    mayor: { label: 'Elected mayor', title: 'Mayor|Burgomaster|Provost|Reeve', chosen: 'by a vote of householders', tension: 'the last election was bought, and everyone knows by whom|the mayor promised a new well and delivered a statue|a challenger is gathering votes with free ale' },
    guilds: { label: 'Merchant guilds', title: 'Guildmaster|Master of the Exchange|Warden of the Guilds', chosen: 'by the richest guilds', tension: 'the smaller guilds are plotting to unseat the great ones|a new guild is refused a charter and turning violent|the guildhall vault is emptier than the ledgers say' },
    theocracy: { label: 'Temple rule', title: 'Hierarch|High Priest|Abbot|Keeper of the Flame', chosen: 'by the temple\'s inner circle', tension: 'a heretic preacher draws bigger crowds every week|the tithe falls hardest on the poorest|a miracle is suspected to be a fraud' },
    military: { label: 'Military governor', title: 'Commander|Castellan|Marshal|Captain-Governor', chosen: 'by appointment from the crown', tension: 'soldiers billeted in homes are wearing out their welcome|curfew is enforced with the lash|the garrison has not been paid in three months' },
    magocracy: { label: 'Council of mages', title: 'Archmage|First Magister|Warden of the Tower', chosen: 'by a duel of skill', magic: 2, tension: 'unlicensed magic is punished harshly|an apprentice vanished during a working|the commonfolk are not allowed in the tower district after dark' },
    commune: { label: 'Folk-moot', title: 'Speaker|Moot-reeve|Lawspeaker', chosen: 'by every adult at the moot stone', tension: 'decisions take forever and the harvest will not wait|a powerful family packs every moot|outsiders want the moot dissolved' },
    syndicate: { label: 'Puppet council', title: 'Mayor|Alderman|Provost', chosen: 'officially by vote; truly by a criminal syndicate', tension: 'honest officials keep having accidents|the syndicate\'s two bosses are drifting toward war|a magistrate is building a case in secret' },
    absentee: { label: 'Absentee noble', title: 'Reeve|Bailiff|Steward', chosen: 'by an owner who never visits', tension: 'the steward lines their own pockets|the noble is rumoured to be selling the town|nobody has seen the charter in years' },
    chief: { label: 'Chieftain', title: 'Chief|War-chief|Headwoman|Headman', chosen: 'by strength and kinship', tension: 'a rival clan disputes the chief\'s right|the chief\'s champion has grown ambitious|an old blood-debt is falling due' },
    company: { label: 'Trading company', title: 'Factor|Chief Factor|Company Governor', chosen: 'by a charter from distant shareholders', tension: 'the company squeezes every coin for its shareholders|smugglers undercut the company monopoly|the factor answers to people who have never seen the town' },
  };
  const GOV_KEYS = Object.keys(T.GOVERNMENTS);

  /* ---------------- districts ---------------- */
  T.DISTRICTS = {
    market: { label: 'Market', names: 'Market Square|the Shambles|Coin Row|the Exchange|Haggle Lane|Weigh-house Square|the Cross|Cheapside', desc: 'stalls, criers and the town\'s best gossip|a cobbled square crowded on market days|warehouses and counting-houses around a busy square' },
    temple: { label: 'Temple', names: 'Chapel Hill|the Close|Bellside|Saints\' Rise|Candle Row|the Sanctuary|Pilgrims\' Way', desc: 'quiet lanes under the temple bells|shrines, almshouses and pilgrims\' lodgings|incense, beggars and holy relics for sale' },
    docks: { label: 'Docks', water: true, names: 'the Wharves|Harbourside|Tarry Row|the Quays|Netmenders\' Lane|Low Wharf|Bargeside|the Staithes', desc: 'tar, rope and shouting crews|warehouses, cranes and sailors\' taverns|fish auctions at dawn and knife fights at dusk' },
    crafts: { label: 'Crafts', names: 'Tanners\' End|Smiths\' Row|Dyers\' Steps|Potters\' Lane|Weavers\' Walk|Coopers\' Yard|Hammer Street', desc: 'workshops open to the street|the clatter of looms and the reek of the tannery|guild signs over every door' },
    noble: { label: 'Wealthy', names: 'the Heights|Highgate|Silver Terrace|the Crescent|Lords\' Walk|Garden Ward|the Mansions', desc: 'gated houses and private gardens|tall townhouses with servants\' stairs|quiet streets patrolled by private guards' },
    poor: { label: 'Poor', names: 'the Rookery|Mudside|the Warrens|Ditchend|Ragg Lane|the Sinks|Gutter Row', desc: 'crooked tenements leaning together|narrow alleys where the watch never goes|crowded yards, washing lines and hungry children' },
    garrison: { label: 'Garrison', walls: true, names: 'the Barracks|Keepside|Shieldwall|the Drill Yard|Gatewatch|Spearhold', desc: 'barracks, stables and a parade ground|soldiers\' taverns under the keep\'s shadow' },
    foreign: { label: 'Foreigners\'', minSize: 3, names: 'the Lantern Quarter|Strangers\' Ward|Caravan Court|Outlanders\' Row|the Far Quarter', desc: 'strange tongues, strange food and stranger customs|traders from far away and the town\'s suspicion' },
    scholar: { label: 'Scholars\'', minSize: 4, names: 'the Inkwells|College Green|Scriveners\' Row|the Stacks|Lamp Street', desc: 'libraries, copyists and arguing students|a college and the taverns that feed it' },
    gardens: { label: 'Green', names: 'the Commons|Orchard Ward|Greenway|the Allotments|Goose Green', desc: 'gardens, grazing and a duck pond|orchards inside the walls' },
    old: { label: 'Old town', names: 'Old Town|the Old Walls|Founders\' Ward|the Stump|Firstfold', desc: 'the oldest houses, crooked and proud|the founders\' graves and the first well' },
    industry: { label: 'Industry', minSize: 3, names: 'Millrace|the Kilns|Forge End|the Yards|Smokeside|the Works', desc: 'smoke, sparks and the town\'s noisiest trades|kilns, mills and soot-black workers' },
    outer: { label: 'Outskirts', names: 'Outgate|the Fields|Beyond-the-Wall|Hovel Hill|the Strays', desc: 'shacks and smallholdings outside the old boundary|newcomers who are not yet welcome inside' },
  };

  /* ---------------- notable locations ---------------- */
  // key: { label, icon, w (weight), min (size index), needs, owner, names, desc, district }
  T.LOCATIONS = {
    inn: { label: 'Inn', icon: '⌂', w: 8, min: 1, owner: 'innkeeper', names: '{innName}', district: 'market', desc: 'rooms above a smoky taproom|a fire that has not gone out in forty years|a famous stew and infamous beds|stabling for travellers and a dog that bites|a board of notices, half of them warnings' },
    tavern: { label: 'Tavern', icon: '☕', w: 8, min: 0, owner: 'barkeep', names: '{innName}', district: 'poor', desc: 'cheap ale and loud songs|a back room for dice and worse|sawdust floors and a fiddler most nights|the only place open after midnight|regulars who stare at strangers' },
    temple: { label: 'Temple', icon: '✚', w: 6, min: 2, owner: 'priest', names: 'Temple of {holy}|Chapel of {holy}|The House of {holy}|Church of {holy}|Sanctuary of {holy}', district: 'temple', desc: 'a bell tower visible for miles|painted walls showing the founding legend|a crypt nobody is allowed into|candles lit for the lost at sea|offerings of bread left on the steps' },
    shrine: { label: 'Shrine', icon: '✧', w: 4, min: 0, owner: 'shrine-keeper', names: 'Shrine of {holy}|The {animal} Stone|Wayside Shrine of {holy}|The Wishing Well', district: 'gardens', desc: 'a weathered statue rubbed smooth by hands|ribbons and coins tied to an old tree|a spring said to cure warts and heartbreak' },
    market: { label: 'Market', icon: '⚖', w: 5, min: 2, owner: 'market warden', names: '{town} Market|The Weigh-house|The Butter Cross|The Covered Market|The Corn Exchange', district: 'market', desc: 'stalls every third day, a fair each season|a covered hall with a crooked weathervane|honest scales, mostly' },
    smithy: { label: 'Smithy', icon: '⚒', w: 6, min: 1, owner: 'smith', names: '{owner}\'s Forge|The Black Anvil|The Bellows|The Horseshoe|Hammer & Tongs', district: 'crafts', desc: 'the ring of a hammer from dawn to dusk|horseshoes, nails and the odd blade|a forge fire tended by three generations' },
    guildhall: { label: 'Guildhall', icon: '⚜', w: 4, min: 3, owner: 'guildmaster', names: '{guildP} Guildhall|Hall of the {guild}|The {guildP} House', district: 'market', desc: 'a hall of banners and long tables|the ledgers that decide who may trade|feasts for members, fines for everyone else' },
    keep: { label: 'Keep', icon: '♜', w: 4, min: 3, owner: 'castellan', names: '{town} Keep|The {colour} Tower|The Old Keep|{town} Castle|The Citadel', district: 'garrison', desc: 'a square tower older than the town|walls patched with three kinds of stone|a dungeon with a famous escape story' },
    docks: { label: 'Docks', icon: '⚓', w: 6, min: 2, needs: 'water', owner: 'harbourmaster', names: '{town} Docks|Low Wharf|The Long Quay|The Staithe|Tar Wharf', district: 'docks', desc: 'piers crowded with fishing boats|cranes, crates and a customs house|a harbour bell that rings for every arrival' },
    tower: { label: 'Mages\' tower', icon: '✶', w: 3, min: 2, needs: 'magic', owner: 'resident mage', names: 'The {colour} Spire|The Tower of {holy}|The Starwatch|The Leaning Tower|The Glass Tower', district: 'scholar', desc: 'windows that glow in the wrong colours|a tower that is taller inside than out|apprentices running errands at all hours' },
    apothecary: { label: 'Apothecary', icon: '⚗', w: 4, min: 2, owner: 'apothecary', names: 'The Mortar & Pestle|{owner}\'s Remedies|The Green Bottle|The Healing Hand', district: 'market', desc: 'jars of things best not named|cures for coughs, curses and broken hearts|a back shelf for poisons, sold with a smile' },
    stables: { label: 'Stables', icon: '♞', w: 3, min: 1, owner: 'stablemaster', names: '{owner}\'s Livery|The Horse Fair|The Long Stables|The Post House', district: 'outer', desc: 'horses for hire and a farrier on call|the best gossip from the road' },
    mill: { label: 'Mill', icon: '✣', w: 3, min: 1, needs: 'mill', owner: 'miller', names: 'The {town} Mill|The Old Mill|The Windmill|The Tide Mill|The Watermill', district: 'industry', desc: 'a wheel that groans like a ghost|flour on everything for a hundred yards|the miller\'s scales, never quite honest' },
    library: { label: 'Library', icon: '❧', w: 2, min: 4, owner: 'librarian', names: 'The {town} Library|The Hall of Records|The Scriptorium|The Chained Library', district: 'scholar', desc: 'books chained to the shelves|town records back to the founding|a reading room where talking is a crime' },
    bathhouse: { label: 'Bathhouse', icon: '♨', w: 2, min: 3, owner: 'bathmaster', names: 'The {town} Baths|The Steam House|The Hot Springs|The Copper Tubs', district: 'market', desc: 'steam, scandal and deals made in towels|hot water piped from somewhere nobody asks about' },
    theatre: { label: 'Theatre', icon: '♫', w: 2, min: 4, owner: 'impresario', names: 'The {adjInn} Stage|The Lantern Theatre|The {town} Playhouse|The Round House', district: 'market', desc: 'bawdy comedies and political satire|a company always one scandal from ruin' },
    gaol: { label: 'Gaol', icon: '⛓', w: 2, min: 2, owner: 'gaoler', names: 'The Clink|The Stocks|{town} Gaol|The Pit|The Hole', district: 'garrison', desc: 'cells below the water line|stocks in the square every Saturday|a gaoler who sells privileges' },
    graveyard: { label: 'Graveyard', icon: '✝', w: 2, min: 1, owner: 'gravedigger', names: 'The Yard of {holy}|Old Boneyard|The Quiet Field|The Hill of Stones', district: 'temple', desc: 'leaning stones and a lych-gate|graves dug a little too fresh' },
    lighthouse: { label: 'Lighthouse', icon: '☼', w: 3, min: 1, needs: 'sea', owner: 'lighthouse keeper', names: 'The {colour} Light|{town} Light|The Lamp on the Point|The Beacon', district: 'docks', desc: 'a lamp that has burned for a century|a keeper who sees everything from up there' },
    shipwright: { label: 'Shipwright', icon: '⛵', w: 3, min: 2, needs: 'water', owner: 'master shipwright', names: '{owner}\'s Yard|The Slipway|The Ribs|The Keel Yard', district: 'docks', desc: 'a hull half-built on the slip|the smell of tar and fresh timber' },
    brewery: { label: 'Brewery', icon: '❦', w: 3, min: 2, owner: 'brewmaster', names: 'The {town} Brewhouse|{owner}\'s Brewery|The Malt House|The Hop Garden', district: 'industry', desc: 'vats of ale and a cat for the mice|beer that is either famous or infamous' },
    countinghouse: { label: 'Counting-house', icon: '¤', w: 2, min: 3, needs: 'rich', owner: 'banker', names: 'The {colour} Ledger|{owner} & Sons|The Exchange Bank|The Vault', district: 'noble', desc: 'loans at rates that ruin families|a vault no thief has cracked, yet' },
    arena: { label: 'Arena', icon: '⚔', w: 1, min: 4, owner: 'arena master', names: 'The Pit|The {town} Arena|The Ring|The Bloodsands', district: 'poor', desc: 'fights every week, betting every day|a crowd that has seen too much' },
    store: { label: 'General store', icon: '▣', w: 5, min: 0, owner: 'shopkeeper', names: '{owner}\'s Goods|The Odds & Ends|The Provisioner|The Corner Shop', district: 'market', desc: 'rope, lamp oil, salt and gossip|everything a traveller forgets' },
    jeweller: { label: 'Jeweller', icon: '◆', w: 2, min: 3, needs: 'rich', owner: 'jeweller', names: 'The {gem} Case|{owner}\'s Gems|The Glittering Eye', district: 'noble', desc: 'stones that may have been stolen|a loupe and a suspicious stare' },
    watch: { label: 'Watch house', icon: '⛨', w: 3, min: 2, owner: 'watch captain', names: 'The Watch House|The Guard Post|{town} Watch|The Lantern Post', district: 'garrison', desc: 'a cell for drunks and a pot of bad tea|a captain who knows everyone\'s business' },
    almshouse: { label: 'Almshouse', icon: '❤', w: 2, min: 2, owner: 'warden', names: 'The Almshouse of {holy}|The House of Mercy|The Poor Hall', district: 'temple', desc: 'beds for the old and the broken|soup at noon, sermons with it' },
    alchemist: { label: 'Alchemist', icon: '⚗', w: 2, min: 2, needs: 'magic', owner: 'alchemist', names: 'The Gilded Retort|The Smoking Flask|{owner}\'s Elixirs', district: 'scholar', desc: 'explosions on alternate Tuesdays|potions with very small print' },
    caravanserai: { label: 'Caravanserai', icon: '⛺', w: 4, min: 1, needs: 'desert', owner: 'caravan master', names: 'The {colour} Serai|The Well House|The Camel Court', district: 'foreign', desc: 'a courtyard full of camels and merchants|water sold by the cup' },
    lodge: { label: 'Hunting lodge', icon: '⛰', w: 3, min: 1, needs: 'wild', owner: 'master of the hunt', names: 'The Antler Hall|The Lodge|The Hart\'s Rest', district: 'outer', desc: 'trophies on every wall|guides for hire, honest and otherwise' },
    minehead: { label: 'Mine', icon: '⛏', w: 3, min: 1, needs: 'mine', owner: 'mine boss', names: 'The Deep Shaft|The {metal} Mine|The Old Working', district: 'industry', desc: 'carts of ore and coughing miners|a shaft that goes deeper than the maps' },
    clocktower: { label: 'Clock tower', icon: '◷', w: 2, min: 3, needs: 'tech', owner: 'clockkeeper', names: 'The Clock Tower|The Great Bell|The Hour House', district: 'old', desc: 'a clock that is always seven minutes fast|gears the size of cartwheels' },
    printer: { label: 'Printing house', icon: '✎', w: 2, min: 3, needs: 'tech', owner: 'printer', names: 'The {colour} Press|{owner}\'s Broadsheets|The Inky Hand', district: 'scholar', desc: 'pamphlets the council would like burned|ink on the walls, ink on the cat' },
  };

  /* ---------------- hooks, festivals, laws ---------------- */
  G.words({
    townProblem: '{res} has gone missing, and the last person to see them was {res2}|the well in {dist} has turned bitter, and the people blame {loc}|someone is stealing {export} from the stores, a little each night|a delegation from a rival town demands the return of a relic held at {loc}|{danger} threatens the town, and {leader} refuses to act|a body washed up near {loc} wearing a stranger\'s ring|the price of bread has tripled since {res} bought the mill\'s debts|children in {dist} talk about a friendly stranger who visits at night|the {feature} has started behaving strangely, and old folk talk of omens|{loc} burned last week; {res} swears it was no accident|a sickness spreads through {dist}, and only the poor are catching it|an inheritance dispute over {loc} has split two families into armed camps|{res2} is selling maps to a treasure that should not exist|tax collectors arrived early, and they brought soldiers|the town\'s charter has been stolen from {loc}|a preacher in {dist} says the town will be punished for its sins, and people are listening|livestock are found drained of blood at the edge of town|{res} claims to have seen {creature} near the {feature}|the guilds are threatening to strike over a new tax on {export}|a ship (or caravan) arrived with no one aboard but a sleeping child|{leader}\'s seal has been used on orders {leader} swears they never gave|a bridge, a road or a gate has been sabotaged in the night|wolves, or something wearing their shape, howl inside the walls|a wealthy stranger is buying every house in {dist}',
    rumourTrue: 'the {feature} hides a smugglers\' cache|{res} was not born here; they arrived by night with a sack of gold|{loc} has a cellar that connects to old tunnels|{leader} is gravely ill and hiding it|the founders made a bargain with something under the town|a rich vein of {export} lies under {dist}, and someone is quietly buying the land|the relic of {holy} kept at {loc} is a fake; the real one was sold years ago|{res2} keeps a ledger of everyone\'s debts and secrets',
    rumourFalse: '{res} is a witch who curdles milk with a look|the water in {dist} makes people forget|{loc} is haunted by its first owner|{leader} plans to sell the town to foreigners|there is a dragon sleeping under the {feature}|anyone who says the founder\'s name three times will drown|{res2} murdered their first spouse|the tax money goes to feed a monster in {loc}',
    festName: 'the Feast of {holy}|{animal} Night|the {colour} Fair|Lantern Week|the Drowning of the Old Year|Founders\' Day|the {export} Festival|the Night of Masks|Harvest Home|the Blessing of the Boats|the First Frost Fire|the Long Table|the Running of the {animal}|Mud Day|the Quiet Day|the Song Contest|the Crowning of the Fool',
    festDesc: 'every household sets a lit candle in the window and nobody speaks after dark|the young race through the streets carrying a burning wheel|a mock king is crowned and may give one order the council must obey|the whole town eats at one long table in the square|boats are blessed with salt and wine, and one is sunk as an offering|masks are worn for three days and grudges are forgiven, officially|the best {export} is judged and the winner is carried shoulder-high|debts under a silver are cancelled at the stroke of midnight|songs are sung to the {feature} to keep it sleeping|old quarrels are settled by a contest of riddles|the dead are given a seat and a plate at every table|bonfires burn on every hill and couples leap them together',
    law: 'no blade longer than a hand may be worn inside the walls|the gates close at sunset; latecomers sleep outside|every household must keep a bucket of water by the door|strangers must register at the watch house within a day|it is forbidden to sell {export} to anyone outside the guild|insulting the founder is punished with a day in the stocks|debtors may be sold into service for a year and a day|magic must be licensed, and licences are expensive|no building may stand taller than the temple tower|the market bell must ring before any trade begins|anyone who finds a body must report it before touching it|pigs may not roam the streets after the second bell|tolls are paid on goods, not on people|a man\'s word is binding if spoken before three witnesses|no fires may be lit outdoors in the dry season',
    custom: 'guests are offered salt and bread before anything else|it is bad luck to whistle near the water|newborns are named only after their first full moon|the dead are buried facing the {feature}|people knock twice on any door, even their own|a stranger who sneezes must be wished good luck three times|lovers exchange {material} tokens|shoes are left on the step for luck at {time}|everyone falls silent when the bell of {holy} rings|the first catch or crop of the year is given away|nobody says the name of the {creature} aloud|a broken mirror is buried, never thrown away|the eldest at a table eats first and speaks last',
  });

  /* ---------------- helpers ---------------- */
  const GUILDS = { fishing: 'Fishmongers', ferrying: 'Ferrymen', dyeing: 'Dyers', quarrying: 'Quarrymen', 'caravan trade': 'Caravaneers', trade: 'Merchants', pottery: 'Potters', 'guiding travellers': 'Guides', shipwrighting: 'Shipwrights', 'salt-panning': 'Salters' };
  /** the guild of a trade: fishing → Fishmongers, weaving → Weavers */
  function guildOf(trade) {
    if (!trade) return 'Merchants';
    const k = String(trade).replace(/\s*\(.*$/, '').trim();
    const g = GUILDS[k] || (/ing$/.test(k) ? k.replace(/ing$/, 'ers') : k);
    return g.split(/([\s-])/).map(w => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  }
  T.guildOf = guildOf;
  const pickKey = (t, keys, given) => (given && keys.includes(given) ? given : t.pick(keys));
  const roundPop = n => (n < 200 ? n : n < 2000 ? Math.round(n / 10) * 10 : n < 20000 ? Math.round(n / 50) * 50 : Math.round(n / 500) * 500);
  /** splits 100 into weighted percentages */
  const spread = (weights) => { const tot = weights.reduce((a, b) => a + b, 0) || 1; const out = weights.map(w => Math.round(w / tot * 100)); const d = 100 - out.reduce((a, b) => a + b, 0); out[0] += d; return out; };

  /* ---------------- the generator ---------------- */
  const opt = (pairs) => [['', 'Any (random)']].concat(pairs);
  G.define({
    id: 'town', name: 'Town', icon: '⌂', group: 'Places', star: true, creates: 'place',
    desc: 'A whole settlement: people, districts, trade, defences, rulers, locations, residents, hooks and a map.',
    inputs: [
      { key: 'name', label: 'Name', kind: 'text', placeholder: 'Generated when empty' },
      { key: 'size', label: 'Size', kind: 'choice', def: 'town', options: opt(SIZE_KEYS.map(k => [k, T.SIZES[k].label])) },
      { key: 'terrain', label: 'Terrain', kind: 'choice', def: '', options: opt(TERRAIN_KEYS.map(k => [k, T.TERRAINS[k].label])) },
      { key: 'culture', label: 'Culture', kind: 'culture', hint: 'Names come from its sample names.' },
      { key: 'wealth', label: 'Wealth', kind: 'choice', def: '', options: opt(WEALTH_KEYS.map(k => [k, T.WEALTH[k].label])) },
      { key: 'government', label: 'Government', kind: 'choice', def: '', options: opt(GOV_KEYS.map(k => [k, T.GOVERNMENTS[k].label])) },
      { key: 'founded', label: 'Founded', kind: 'date', hint: 'Empty: an age that fits its size.' },
      { key: 'magic', label: 'Magic', kind: 'choice', def: 'rare', options: Object.entries(T.MAGIC) },
      { key: 'tech', label: 'Technology', kind: 'choice', def: 'medieval', options: Object.entries(T.TECH) },
    ],
    generate(g) {
      const o = g.opts, d = g.res.data;
      /* setup: anything left to chance is decided first, from the base seed */
      const st = g.rng('setup');
      d.size = pickKey(st, SIZE_KEYS, o.size);
      d.terrain = pickKey(st, TERRAIN_KEYS, o.terrain);
      d.wealth = o.wealth && T.WEALTH[o.wealth] ? o.wealth : st.weighted([['destitute', 1], ['poor', 3], ['modest', 5], ['comfortable', 3], ['wealthy', 1.5], ['opulent', 0.6]]);
      d.magic = T.MAGIC[o.magic] ? o.magic : 'rare';
      d.tech = T.TECH[o.tech] ? o.tech : 'medieval';
      const S = T.SIZES[d.size], TR = T.TERRAINS[d.terrain], WL = T.WEALTH[d.wealth];
      const govs = GOV_KEYS.filter(k => !T.GOVERNMENTS[k].magic || magicLvl(d.magic) >= T.GOVERNMENTS[k].magic);
      const govW = {
        thorp: { council: 4, chief: 3, absentee: 2, commune: 3 },
        hamlet: { council: 4, absentee: 3, lord: 2, commune: 2, chief: 1 },
        village: { council: 3, lord: 3, absentee: 2, mayor: 1.5, commune: 1, theocracy: 0.6 },
      }[d.size] || { lord: 4, mayor: 3, guilds: 3, council: 1.5, theocracy: 1.2, military: 1, magocracy: 1, syndicate: 0.8, absentee: 1, company: 1, commune: 0.6, chief: 0.3 };
      d.government = o.government && T.GOVERNMENTS[o.government] ? o.government : st.weighted(govs.map(k => [k, govW[k] || 0.2]));
      const GV = T.GOVERNMENTS[d.government];
      d.sizeLabel = S.label; d.terrainLabel = TR.label; d.wealthLabel = WL.label; d.govLabel = GV.label;
      const style = o.nameStyle || TR.style, peopleStyle = o.nameStyle || 'common';
      d.population = roundPop(st.between(S.pop));
      d.foundedYears = st.int(...{ thorp: [5, 60], hamlet: [20, 160], village: [40, 320], town: [80, 620], city: [150, 1200], metropolis: [300, 2200] }[d.size]);
      if (o.founded && Number.isFinite(+o.founded.day)) d.founded = { day: +o.founded.day, min: null, prec: o.founded.prec || 'year' };
      else if (o.cal && o.nowDay != null) { const n = o.cal.ymd(o.nowDay).y - d.foundedYears; d.founded = { day: o.cal.fromYmd(n, 0, 1), min: null, prec: 'year' }; }
      if (d.founded && o.cal && o.nowDay != null) d.foundedYears = Math.max(0, o.cal.ymd(o.nowDay).y - o.cal.ymd(d.founded.day).y);
      d.foundedText = d.founded && o.cal ? o.cal.format(d.founded) : '';
      const names = { style: peopleStyle, given: o.names && o.names.given, family: o.names && o.names.family };
      const person = (t) => g.person(t, names);

      /* name */
      d.name = g.section('name', 'Name', 'title', t => (o.name && String(o.name).trim()) || g.place(t, { style, prefix: TR.prefix.split('|'), suffix: TR.suffix.split('|') }));
      g.names.add(d.name);

      /* demographics */
      g.section('demographics', 'Demographics', 'kv', t => {
        const peoples = (o.peoples || []).filter(Boolean);
        let groups;
        const majority = o.cultureTitle || (peoples.length < 2 ? 'Locals' : null);
        if (majority) {
          const minor = t.sample(peoples, Math.min(3, peoples.length));
          const w = [t.int(62, 90)].concat(minor.map(() => t.int(3, 16)), [t.int(2, 9)]);
          const p = spread(w);
          groups = [majority].concat(minor, ['From far away']).map((label, i) => ({ label, pct: p[i] }));
        } else if (peoples.length) {
          const main = o.mainPeople && peoples.includes(o.mainPeople) ? o.mainPeople : peoples[0];
          const others = t.shuffle(peoples.filter(p => p !== main)).slice(0, 4);
          const w = [t.int(55, 90)].concat(others.map(() => t.int(3, 25)));
          const p = spread(w);
          groups = [main].concat(others).map((label, i) => ({ label, pct: p[i] }));
        } else {
          const p = spread([t.int(60, 88), t.int(6, 22), t.int(2, 12)]);
          groups = [{ label: 'Born here', pct: p[0] }, { label: 'From the country', pct: p[1] }, { label: 'From far away', pct: p[2] }];
        }
        groups = groups.filter(x => x.pct > 0);
        const cw = WL.classes.map(x => x * (0.75 + t.f() * 0.5));
        if (S.idx <= 1) cw[0] = 0;
        const cls = spread(cw).map((pct, i) => ({ label: T.CLASSES[i], pct })).filter(x => x.pct > 0);
        const ages = spread([t.int(28, 40), t.int(40, 52), t.int(10, 22)]);
        d.demo = { peoples: groups, classes: cls, ages: [{ label: 'Children', pct: ages[0] }, { label: 'Adults', pct: ages[1] }, { label: 'Elders', pct: ages[2] }] };
        d.households = Math.max(3, Math.round(d.population / t.int(4, 6)));
        return [['Population', G.num(d.population) + ' (about ' + G.num(d.households) + ' households)'],
          [peoples.length ? 'Peoples' : 'Origins', groups.map(x => x.label + ' ' + x.pct + '%').join(', ')],
          ['Classes', cls.map(x => x.label + ' ' + x.pct + '%').join(', ')]];
      });

      /* districts */
      const water = TR.water && TR.water !== 'oasis' && TR.water !== 'pools' && TR.water !== 'lake' ? TR.water : (TR.water === 'lake' || TR.water === 'pools' ? 'small' : null);
      d.walls = 0;
      g.section('districts', 'Districts', 'items', t => {
        const n = t.between(S.districts);
        const kinds = [S.idx >= 3 ? t.pick(['old', 'market', 'market']) : 'market'];
        const pool = Object.keys(T.DISTRICTS).filter(k => !kinds.includes(k));
        const w = k => {
          const D = T.DISTRICTS[k];
          if (D.water && !(water === 'sea' || water === 'river')) return 0;
          if (D.minSize && S.idx < D.minSize) return 0;
          if (k === 'noble' && WEALTH_KEYS.indexOf(d.wealth) < 2) return 0.2;
          if (k === 'poor' && WEALTH_KEYS.indexOf(d.wealth) > 3) return 0.6;
          return { docks: 6, crafts: 4, temple: 3, poor: 3, noble: 2.5, garrison: S.idx >= 3 ? 2 : 0.3, foreign: 1.5, scholar: 1, gardens: 1.2, industry: 1.5, outer: 1.2, old: 1.2, market: 1 }[k] || 1;
        };
        while (kinds.length < n) {
          const cand = pool.filter(k => !kinds.includes(k)).map(k => [k, w(k)]).filter(x => x[1] > 0);
          if (!cand.length) break;
          kinds.push(t.weighted(cand));
        }
        const taken = new Set();
        d.districts = kinds.map(k => {
          const D = T.DISTRICTS[k];
          let name = '';
          for (let i = 0; i < 6 && (!name || taken.has(name)); i++) {
            name = t.chance(0.28) ? t.pick(TR.prefix.split('|')) + ' ' + t.pick(['Row', 'Steps', 'End', 'Hill', 'Lane', 'Ward', 'Gate', 'Side', 'Yard', 'Green', 'Cross']) : t.pick(D.names);
          }
          taken.add(name);
          return { name: G.title(name), kind: k, label: D.label, desc: G.cap(t.pick(D.desc)) };
        });
        if (d.size === 'thorp') d.districts = [{ name: 'The green', kind: 'market', label: 'Heart', desc: 'a few houses around a muddy green and a well' }];
        return d.districts.map(x => ({ title: x.name, sub: x.label + ' quarter', text: x.desc }));
      });

      /* economy */
      g.section('economy', 'Economy & trade', 'kv', t => {
        const ex = t.sample(TR.exports.split('|'), S.idx >= 4 ? 4 : S.idx >= 2 ? 3 : 2);
        const ind = t.sample(TR.industry.split('|'), Math.min(3, 1 + Math.ceil(S.idx / 2)));
        const im = t.sample(TR.imports.split('|'), 2);
        d.exports = ex; d.industry = ind;
        const marketDay = S.idx >= 4 ? 'every day, with a great fair each season' : S.idx >= 2 ? t.pick(['every third day', 'once a week', 'twice a week']) + ' in the square' : 'when a pedlar comes through';
        d.economyText = G.cap(ind[0]) + (ind.length > 1 ? ' and ' + G.joinAnd(ind.slice(1)) : '') + ' keep the town fed. Exports ' + G.joinAnd(ex) + '; imports ' + G.joinAnd(im) + '.';
        return [['Trades', G.cap(G.joinAnd(ind))], ['Exports', G.cap(G.joinAnd(ex))], ['Imports', G.cap(G.joinAnd(im))], ['Market', G.cap(marketDay)],
          ['Prices', WL.price < 0.9 ? 'Cheap, if you can find anything worth buying' : WL.price > 1.4 ? 'Steep; visitors pay double and know it' : 'Fair, by the standards of the region']];
      });

      /* defences */
      g.section('defences', 'Defences', 'kv', t => {
        const mag = magicLvl(d.magic), tech = techLvl(d.tech);
        const walled = t.chance(S.walls);
        d.walls = walled ? (d.size === 'metropolis' ? 2 : 1) : 0;
        d.wallKind = walled ? (S.idx <= 2 || WEALTH_KEYS.indexOf(d.wealth) <= 1 ? 'palisade' : 'stone') : null;
        d.towers = walled ? t.int(2, 4) + S.idx * t.int(1, 3) : 0;
        d.gates = walled ? Math.max(1, Math.min(6, t.int(1, 2) + Math.floor(S.idx / 2))) : 0;
        const guards = Math.max(0, Math.round(d.population * (0.002 + t.f() * 0.006)));
        const militia = Math.max(2, Math.round(d.population * (0.01 + t.f() * 0.025)));
        const wall = !walled ? (S.idx <= 1 ? t.pick(['No walls; folk run to the ' + t.pick(['temple', 'mill', 'longhouse', 'hill']) + ' when raiders come', 'A hedge, a ditch and a lot of dogs', 'Nothing but distance and luck'])
          : t.pick(['An earth bank and a ditch, overgrown in places', 'No walls; the watch relies on the terrain', 'A half-finished wall abandoned for lack of coin']))
          : d.wallKind === 'palisade' ? 'A palisade of sharpened stakes with ' + d.gates + (d.gates === 1 ? ' gate' : ' gates')
          : (d.walls === 2 ? 'Two rings of stone walls' : 'Stone walls') + ' with ' + d.towers + ' towers and ' + d.gates + (d.gates === 1 ? ' gate' : ' gates');
        const extra = [];
        if (water === 'sea' && S.idx >= 3) extra.push(t.pick(['a chain boom across the harbour mouth', 'a sea wall with a gun-less bastion', 'watch fires on the headland']));
        if (water === 'river' && S.idx >= 2) extra.push(t.pick(['a fortified bridge gate', 'a toll tower over the river']));
        if (mag >= 2) extra.push(t.pick(['warding stones that hum after dark', 'a mage on retainer for the watch', 'glyphs carved over every gate']));
        if (tech >= 2 && S.idx >= 3) extra.push(t.pick(['bronze cannon on the gate towers', 'a powder store under the keep', 'musketeers on the walls']));
        if (d.terrain === 'mountains') extra.push('a gatehouse that closes the pass');
        if (d.terrain === 'swamp') extra.push('paths only the boatmen know');
        d.defences = { guards, militia };
        const weak = t.pick(['a collapsed culvert under the {dir} wall', 'the night watch drinks on duty', 'a postern gate whose key was copied', 'the garrison is half the size on paper', 'a smugglers\' tunnel runs under the walls', 'the beacon fire has not been tested in years', 'the captain takes bribes']).replace('{dir}', t.pick(['north', 'south', 'east', 'west']));
        d.weakness = weak;
        return [['Walls', wall], ['Watch', guards ? G.num(guards) + ' paid guards' + (S.idx >= 4 ? ' and a garrison' : '') : 'No paid guards'], ['Militia', 'About ' + G.num(militia) + ' who can hold a spear'],
          extra.length ? ['Also', G.cap(G.joinAnd(extra))] : null, ['Weakness', G.cap(weak)]].filter(Boolean);
      });

      /* government */
      g.section('government', 'Government', 'kv', t => {
        const title = t.pick(GV.title);
        const leader = { name: person(t), title, trait: t.pick('trait'), want: t.pick('want'), secret: t.pick('secret'), look: t.pick('look'), age: t.pick(['middle-aged', 'grey-haired', 'old', 'young', 'grown']) };
        d.leader = leader;
        const p1 = { name: person(t), role: t.pick(['the richest merchant in town', 'the high priest', 'the guildmaster of the ' + (d.industry || ['traders'])[0] + ' guild', 'the captain of the watch', 'a moneylender everyone owes', 'the ' + title.toLowerCase() + '\'s spouse', 'the old family who founded the town']) };
        const p2 = { name: person(t), role: t.pick(['a popular preacher', 'a smuggler king', 'the leader of the dock workers', 'a retired war hero', 'the town\'s only physician', 'a foreign envoy', 'a reformer with a printing press']) };
        d.power = [p1, p2];
        d.tension = G.cap(t.pick(GV.tension));
        return [['Rule', GV.label + ', chosen ' + GV.chosen], ['Leader', title + ' ' + leader.name + ', who ' + leader.trait], ['Also powerful', p1.name + ' (' + p1.role + ') and ' + p2.name + ' (' + p2.role + ')'], ['Tension', d.tension]];
      });

      /* notable locations */
      g.section('locations', 'Notable locations', 'items', t => {
        const mag = magicLvl(d.magic), tech = techLvl(d.tech);
        const ok = (k) => {
          const L = T.LOCATIONS[k];
          if (S.idx < L.min) return false;
          switch (L.needs) {
            case 'water': return water === 'sea' || water === 'river';
            case 'sea': return water === 'sea';
            case 'magic': return mag >= 2 || (mag === 1 && S.idx >= 4);
            case 'mill': return ['river', 'plains', 'hills', 'coast'].includes(d.terrain);
            case 'rich': return WEALTH_KEYS.indexOf(d.wealth) >= 2;
            case 'desert': return d.terrain === 'desert';
            case 'wild': return ['forest', 'hills', 'mountains', 'tundra', 'swamp'].includes(d.terrain);
            case 'mine': return ['mountains', 'hills'].includes(d.terrain);
            case 'tech': return tech >= 2;
            default: return true;
          }
        };
        const n = t.between(S.locations);
        const must = [S.idx <= 0 ? 'tavern' : 'inn'];
        if (S.idx >= 1) must.push(ok('smithy') ? 'smithy' : 'store');
        if (S.idx >= 2) must.push('temple', 'market');
        if (S.idx >= 3 && ok('docks')) must.push('docks');
        if (S.idx >= 3) must.push(t.chance(0.6) ? 'keep' : 'guildhall');
        if (mag >= 3 && ok('tower')) must.push('tower');
        const kinds = must.slice(0, n);
        const repeatable = new Set(['inn', 'tavern', 'store', 'shrine', 'smithy']);
        let guard = 0;
        while (kinds.length < n && guard++ < 200) {
          const cand = Object.keys(T.LOCATIONS).filter(k => ok(k) && (!kinds.includes(k) || (repeatable.has(k) && S.idx >= 4 && kinds.filter(x => x === k).length < 2))).map(k => [k, T.LOCATIONS[k].w]);
          if (!cand.length) break;
          kinds.push(t.weighted(cand));
        }
        const guild = guildOf(d.industry && d.industry[0]);
        const taken = new Set();
        d.locations = kinds.map(k => {
          const L = T.LOCATIONS[k];
          const owner = { name: person(t), title: L.owner, trait: t.pick('trait') };
          const first = owner.name.split(' ')[0];
          let name = '';
          for (let i = 0; i < 6 && (!name || taken.has(name)); i++) name = G.fill(t, t.pick(L.names), { town: d.name, owner: first, guild, guildP: /s$/.test(guild) ? guild + '\'' : guild + '\'s' });
          name = G.title(name);
          taken.add(name);
          const di = Math.max(0, d.districts.findIndex(x => x.kind === L.district));
          const dist = d.districts.findIndex(x => x.kind === L.district) >= 0 ? di : t.int(0, d.districts.length - 1);
          const hook = t.pick(['{owner} is looking for someone discreet to carry a package', 'a regular has not been seen for three days', '{owner} pays well for news from the road', 'something valuable is hidden on the premises', '{owner} is behind on payments to dangerous people', 'a locked door here has not been opened since the founding', 'the place changes hands at the next market day', '{owner} saw something they should not have']).replace('{owner}', first);
          return { kind: k, label: L.label, icon: L.icon, name, owner, desc: G.cap(t.pick(L.desc)), district: dist, hook: G.cap(hook) };
        });
        return d.locations.map(l => ({ title: l.name, sub: l.label + ' · ' + l.owner.title + ' ' + l.owner.name, text: l.desc + '. ' + l.hook + '.', icon: l.icon }));
      });

      /* residents */
      g.section('residents', 'Residents', 'items', t => {
        const peoples = (d.demo && d.demo.peoples) || [];
        const urban = S.idx >= 3, magic = magicLvl(d.magic) >= 2;
        d.residents = [];
        for (let i = 0; i < S.residents; i++) {
          const pick = peoples.length ? t.weighted(peoples.map(p => [p.label, p.pct])) : '';
          const r = { name: person(t), people: (o.peoples || []).includes(pick) ? pick : '',
            age: t.pick('age'), job: G.job(t, d.terrain, { urban, magic }), trait: t.pick('trait'), want: t.pick('want'), secret: t.pick('secret'), look: t.pick('look'),
            haunt: d.locations && d.locations.length && t.chance(0.5) ? t.int(0, d.locations.length - 1) : -1 };
          d.residents.push(r);
        }
        return d.residents.map(r => ({ title: r.name, sub: G.cap([r.age, r.people && r.people.toLowerCase(), r.job].filter(Boolean).join(' ')), text: G.cap(r.trait) + '. Wants ' + r.want + '.' + (r.haunt >= 0 ? ' Often found at ' + d.locations[r.haunt].name + '.' : ''), secret: G.cap(r.secret) + '.' }));
      });

      /* problems & rumours */
      g.section('hooks', 'Problems & rumours', 'items', t => {
        const res = (d.residents || []).map(r => r.name).concat(d.leader ? [d.leader.name] : []);
        const vars = {
          res: () => t.pick(res.length ? res : ['a local']), res2: () => t.pick(res.length ? res : ['a stranger']),
          loc: () => (d.locations && d.locations.length ? t.pick(d.locations).name : 'the inn'), dist: () => (d.districts ? t.pick(d.districts).name : 'the lanes'),
          danger: t.pick(TR.danger.split('|')), feature: () => t.pick(TR.feature.split('|')).replace(/^(an?|the) /, ''), leader: (() => { let n = 0; return () => (!d.leader ? 'the council' : n++ ? d.leader.name : d.leader.title + ' ' + d.leader.name); })(),
          export: () => t.pick(d.exports || ['grain']), town: d.name,
        };
        const nProb = S.idx >= 3 ? 3 : 2, nRum = S.idx >= 2 ? 3 : 2;
        d.problems = t.fills('townProblem', nProb, vars).map(G.cap);
        const rumours = [];
        for (let i = 0; i < nRum; i++) {
          const truth = t.weighted([['true', 4], ['false', 3], ['partly', 2]]);
          rumours.push({ text: G.cap(G.fill(t, truth === 'false' ? '@rumourFalse' : '@rumourTrue', vars)), truth });
        }
        d.rumours = rumours;
        return d.problems.map(p => ({ title: 'Problem', text: p + '.' })).concat(rumours.map(r => ({ title: 'Rumour', text: '“' + r.text + '.”', secret: r.truth === 'true' ? 'True.' : r.truth === 'false' ? 'False.' : 'Partly true.' })));
      });

      /* festivals */
      g.section('festivals', 'Festivals', 'items', t => {
        const n = S.idx <= 1 ? 1 : S.idx <= 3 ? 2 : 3;
        const months = o.months && o.months.length ? o.months : ['spring', 'midsummer', 'harvest time', 'midwinter', 'the first thaw', 'the dark of the year'];
        const vars = { export: () => t.pick(d.exports || ['ale']), feature: () => t.pick(TR.feature.split('|')).replace(/^(an?|the) /, '') };
        d.festivals = t.sample('festName', n).map(nm => ({ name: G.title(G.fill(t, nm, vars)), when: o.months && o.months.length ? t.pick(['early', 'mid', 'late', 'the last day of', 'the first day of']) + ' ' + t.pick(months) : t.pick(months), desc: G.cap(G.fill(t, '@festDesc', vars)) }));
        return d.festivals.map(f => ({ title: f.name, sub: G.cap(f.when), text: f.desc + '.' }));
      });

      /* laws & customs */
      g.section('laws', 'Laws & customs', 'list', t => {
        const vars = { export: () => t.pick(d.exports || ['grain']), feature: () => t.pick(TR.feature.split('|')).replace(/^(an?|the) /, '') };
        const laws = t.sample(G.W.law.filter(l => !/magic must be licensed/.test(l) || magicLvl(d.magic) >= 1).filter(l => !/gates close/.test(l) || d.walls), S.idx >= 3 ? 3 : 2);
        const customs = t.sample('custom', S.idx >= 3 ? 3 : 2);
        d.laws = laws.map(l => 'Law: ' + G.cap(G.fill(t, l, vars)) + '.');
        d.customs = customs.map(c => 'Custom: ' + G.cap(G.fill(t, c, vars)) + '.');
        return d.laws.concat(d.customs);
      });

      /* overview */
      g.section('overview', 'Overview', 'text', t => {
        const ex = d.exports || [];
        const notable = (d.locations || []).filter(l => !['inn', 'tavern', 'store'].includes(l.kind)).slice(0, 2).map(l => l.name);
        const feat = t.pick(TR.feature.split('|'));
        const s1 = d.name + ' is ' + G.article('a ' + WL.adj + ' ' + TR.adj + ' ' + S.label.toLowerCase()) + ' of ' + (d.population < 100 ? 'some ' : 'about ') + G.num(d.population) + ' souls' + (d.foundedText ? ', founded in ' + d.foundedText : d.foundedYears ? ', founded some ' + d.foundedYears + ' years ago' : '') + '.';
        const s2 = t.pick(['It is known for {ex}, and for {feat}.', 'Travellers remember its {ex} and {feat}.', 'Its {ex} are carried far beyond the region, and nobody forgets {feat}.']).replace('{ex}', G.joinAnd(ex.slice(0, 2))).replace('{feat}', feat);
        const s3 = d.leader ? G.cap(d.leader.title) + ' ' + d.leader.name + ' governs ' + t.pick(['from', 'out of', 'in the name of']) + ' ' + (t.pick(['the old hall', 'a modest house', 'a fortified tower', 'the counting-house', 'the temple steps'])) + ', though ' + g.lower(d.tension || 'not everyone is content') + '.' : '';
        const s4 = notable.length ? 'Look for ' + G.joinAnd(notable) + '.' : '';
        const s5 = d.problems && d.problems[0] ? 'Lately, ' + g.lower(d.problems[0]) + '.' : '';
        d.overview = [s1, s2, s3, s4, s5].filter(Boolean).join(' ');
        return d.overview;
      });

      g.res.title = d.name;
      g.res.summary = G.cap(G.article('a ' + WL.adj + ' ' + TR.adj + ' ' + S.label.toLowerCase())) + ' of ' + G.num(d.population) + ', known for ' + G.joinAnd((d.exports || []).slice(0, 2)) + '.';
      /* the map is seeded on its own so it can be re-drawn without touching the rest */
      const ms = g.rng('map');
      d.mapSeed = g.res.seeds.map;
      d.mapRot = ms.f();
      if (G.townMap) d.map = G.townMap(d, d.mapSeed);
    },

    text(res) {
      const d = res.data, out = [d.name, res.summary, '', d.overview];
      for (const s of res.sections) if (!['name', 'overview'].includes(s.key)) { out.push('', s.label.toUpperCase(), ...G.sectionLines(s)); }
      return out.join('\n');
    },

    /** env: { cultureId, mapId, x, y, now, include: { districts, locations, residents, owners, map } } */
    plan(res, env = {}) {
      const d = res.data, inc = Object.assign({ districts: true, locations: true, residents: true, owners: false, map: true }, env.include || {});
      const esc = G.esc, m = (ref, label) => '<a class="wb-m" data-id="@ref:' + ref + '">' + esc(label) + '</a>';
      const entries = [], relations = [], media = [], pins = [];
      const useDistricts = inc.districts && d.districts && d.districts.length > 1;
      const kindOf = { thorp: 'Village', hamlet: 'Village', village: 'Village', town: 'Town', city: 'City', metropolis: 'City' }[d.size] || 'Town';
      const sec = key => res.sections.find(s => s.key === key);
      // the residents and the leader
      const leaderRef = inc.residents && d.leader ? 'leader' : null;
      const resRefs = inc.residents ? (d.residents || []).map((r, i) => 'res' + i) : [];
      const locRefs = inc.locations ? (d.locations || []).map((l, i) => 'loc' + i) : [];
      const ownerRefs = inc.locations && inc.owners ? (d.locations || []).map((l, i) => 'own' + i) : [];
      const distRefs = useDistricts ? d.districts.map((x, i) => 'dist' + i) : [];
      // town body
      let body = '<p>' + esc(d.overview) + '</p>';
      const kvHtml = s => (s ? '<ul>' + s.value.map(([k, v]) => '<li><strong>' + esc(k) + ':</strong> ' + esc(v) + '</li>').join('') + '</ul>' : '');
      body += '<h3>Demographics</h3>' + kvHtml(sec('demographics'));
      body += '<h3>Districts</h3><ul>' + d.districts.map((x, i) => '<li>' + (useDistricts ? m(distRefs[i], x.name) : '<strong>' + esc(x.name) + '</strong>') + ' — ' + esc(x.desc) + '</li>').join('') + '</ul>';
      body += '<h3>Economy &amp; trade</h3>' + kvHtml(sec('economy'));
      const def = sec('defences');
      body += '<h3>Defences</h3><ul>' + def.value.map(([k, v]) => '<li>' + (k === 'Weakness' ? '<span class="wb-s"><strong>Weakness:</strong> ' + esc(v) + '</span>' : '<strong>' + esc(k) + ':</strong> ' + esc(v)) + '</li>').join('') + '</ul>';
      body += '<h3>Government</h3><ul><li><strong>Rule:</strong> ' + esc(T.GOVERNMENTS[d.government].label + ', chosen ' + T.GOVERNMENTS[d.government].chosen) + '</li>'
        + '<li><strong>Leader:</strong> ' + esc(d.leader.title) + ' ' + (leaderRef ? m(leaderRef, d.leader.name) : esc(d.leader.name)) + ', who ' + esc(d.leader.trait) + '</li>'
        + '<li><strong>Also powerful:</strong> ' + d.power.map(p => esc(p.name + ' (' + p.role + ')')).join(', ') + '</li><li><strong>Tension:</strong> ' + esc(d.tension) + '</li></ul>';
      body += '<h3>Notable locations</h3><ul>' + d.locations.map((l, i) => '<li>' + (locRefs[i] ? m(locRefs[i], l.name) : '<strong>' + esc(l.name) + '</strong>') + ' — ' + esc(l.label.toLowerCase()) + ', ' + esc(l.owner.title) + ' ' + (ownerRefs[i] ? m(ownerRefs[i], l.owner.name) : esc(l.owner.name)) + '. ' + esc(l.desc) + '.</li>').join('') + '</ul>';
      body += '<h3>Residents</h3><ul>' + d.residents.map((r, i) => '<li>' + (resRefs[i] ? m(resRefs[i], r.name) : '<strong>' + esc(r.name) + '</strong>') + ', ' + esc([r.age, r.job].join(' ')) + ' — ' + esc(r.trait) + '. Wants ' + esc(r.want) + '. <span class="wb-s">Secret: ' + esc(r.secret) + '.</span></li>').join('') + '</ul>';
      body += '<h3>Problems &amp; rumours</h3><ul>' + d.problems.map(p => '<li>' + esc(p) + '.</li>').join('') + d.rumours.map(r => '<li>“' + esc(r.text) + '.” <span class="wb-s">(' + (r.truth === 'true' ? 'true' : r.truth === 'false' ? 'false' : 'partly true') + ')</span></li>').join('') + '</ul>';
      body += '<h3>Festivals</h3><ul>' + d.festivals.map(f => '<li><strong>' + esc(f.name) + '</strong> (' + esc(f.when) + ') — ' + esc(f.desc) + '.</li>').join('') + '</ul>';
      body += '<h3>Laws &amp; customs</h3><ul>' + d.laws.concat(d.customs).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      if (inc.map && d.map) body += '<p><em>A map of the town is kept under </em>' + m('map', 'Map of ' + d.name) + '<em>.</em></p>';
      entries.push({ ref: 'town', type: 'place', title: d.name, summary: res.summary, body, start: d.founded || null,
        fields: { kind: kindOf, population: d.population, climate: T.TERRAINS[d.terrain].climate, economy: d.economyText, features: d.locations.map(l => l.name).slice(0, 12),
          danger: Math.max(1, Math.min(5, 1 + Math.round((d.problems.length + (d.walls ? 0 : 1)) / 1.5))), rumours: d.rumours.map(r => r.text + '.'), ruler: leaderRef ? '@ref:' + leaderRef : '' },
        tags: ['generated'] });
      // districts as child places
      if (useDistricts) d.districts.forEach((x, i) => entries.push({ ref: distRefs[i], type: 'place', parent: 'town', title: x.name, summary: x.desc, fields: { kind: 'District' },
        body: '<p>' + esc(G.cap(x.label)) + ' quarter of ' + m('town', d.name) + ': ' + esc(x.desc) + '.</p>' + (inc.locations ? '<ul>' + d.locations.map((l, j) => (l.district === i ? '<li>' + m(locRefs[j], l.name) + '</li>' : '')).join('') + '</ul>' : '') }));
      // locations as child places (inside their district when there are districts)
      if (inc.locations) d.locations.forEach((l, i) => {
        const owner = ownerRefs[i] ? m(ownerRefs[i], l.owner.name) : esc(l.owner.name);
        entries.push({ ref: locRefs[i], type: 'place', parent: useDistricts ? distRefs[l.district] || 'town' : 'town', title: l.name, summary: l.label + ' run by ' + l.owner.name,
          fields: { kind: l.kind === 'shrine' || l.kind === 'graveyard' ? 'Landmark' : 'Building', features: [l.desc] },
          body: '<p>' + esc(G.cap(G.article('a ' + l.label.toLowerCase()))) + ' in ' + m('town', d.name) + (useDistricts ? ' (' + m(distRefs[l.district], d.districts[l.district].name) + ')' : '') + ', kept by ' + esc(l.owner.title) + ' ' + owner + ', who ' + esc(l.owner.trait) + '.</p><p>' + esc(l.desc) + '.</p><p class="wb-s">Hook: ' + esc(l.hook) + '.</p>' });
        if (ownerRefs[i]) {
          entries.push({ ref: ownerRefs[i], type: 'character', title: l.owner.name, summary: G.cap(l.owner.title) + ' of ' + l.name, fields: { occupation: G.cap(l.owner.title), home: '@ref:town', culture: env.cultureId || '', personality: G.cap(l.owner.trait) + '.', status: 'Alive' } });
          relations.push({ src: ownerRefs[i], dst: locRefs[i], rel: 'owns' }, { src: ownerRefs[i], dst: 'town', rel: 'lives in' });
        }
      });
      // the leader and the residents
      if (leaderRef) {
        const L = d.leader;
        entries.push({ ref: leaderRef, type: 'character', title: L.name, summary: L.title + ' of ' + d.name, fields: { occupation: L.title, home: '@ref:town', culture: env.cultureId || '', personality: G.cap(L.trait) + '.', appearance: G.cap(L.look) + '.', goals: G.cap(L.want) + '.', secret: G.cap(L.secret) + '.', status: 'Alive' },
          body: '<p>' + esc(L.title) + ' of ' + m('town', d.name) + '. ' + esc(G.cap(L.trait)) + '.</p>' });
        relations.push({ src: leaderRef, dst: 'town', rel: 'rules' }, { src: leaderRef, dst: 'town', rel: 'lives in' });
      }
      if (inc.residents) d.residents.forEach((r, i) => {
        entries.push({ ref: resRefs[i], type: 'character', title: r.name, summary: G.cap(r.job) + ' in ' + d.name + ' who ' + r.trait,
          fields: { occupation: G.cap(r.job), home: '@ref:town', culture: env.cultureId || '', personality: G.cap(r.trait) + '.', appearance: G.cap(r.look) + '.', goals: G.cap(r.want) + '.', secret: G.cap(r.secret) + '.', status: 'Alive', species: (env.peopleIds || {})[r.people] || '' },
          body: '<p>' + esc(G.cap([r.age, r.people && r.people.toLowerCase(), r.job].filter(Boolean).join(' '))) + ' of ' + m('town', d.name) + '.' + (r.haunt >= 0 && locRefs[r.haunt] ? ' Often found at ' + m(locRefs[r.haunt], d.locations[r.haunt].name) + '.' : '') + '</p>' });
        relations.push({ src: resRefs[i], dst: 'town', rel: 'lives in' });
      });
      // the town map, as a sub-map of the map it was founded on (or inside the town)
      if (inc.map && d.map) {
        media.push({ ref: 'mapimg', name: 'Map of ' + d.name + '.svg', mime: 'image/svg+xml', text: d.map.svg, width: d.map.width, height: d.map.height });
        entries.push({ ref: 'map', type: 'map', parent: env.mapId ? null : 'town', parentId: env.mapId || null, title: 'Map of ' + d.name, summary: 'Town plan of ' + d.name + ' (generated).',
          fields: { kind: 'City' }, data: { image: '@media:mapimg', width: d.map.width, height: d.map.height, unit: 'feet', unitsPerPx: d.map.feetPerPx, grid: null, generated: { by: 'town', seed: res.seed } },
          body: '<p>Town plan of ' + m('town', d.name) + '.</p>' });
        if (inc.locations) d.map.pins.forEach(p => { if (locRefs[p.loc] != null) pins.push({ map: 'map', entry: locRefs[p.loc], x: p.x, y: p.y, label: d.locations[p.loc].name, icon: T.PIN_ICON[d.locations[p.loc].kind] || 'dot' }); });
      }
      if (env.mapId && env.x != null && env.y != null) pins.push({ mapId: env.mapId, entry: 'town', x: env.x, y: env.y, label: d.name, icon: { thorp: 'village', hamlet: 'village', village: 'village', town: 'town', city: 'city', metropolis: 'capital' }[d.size], subMap: inc.map && d.map ? 'map' : null });
      return { entries, relations, media, pins, open: 'town' };
    },
  });
  return G;
});
