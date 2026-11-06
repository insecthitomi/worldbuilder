/* Generator vocabulary: original word lists shared by every generator (people, traits, wants, secrets, things).
   Lists are '|'-separated; {key} inside an item expands from another list when filled. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./gen-core.js') : root.WBGen;
  factory(G);
  if (node) module.exports = G;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  G.words({
    /* ---- people ---- */
    age: 'young|young|youthful|weathered|middle-aged|middle-aged|grey-haired|old|elderly|ancient',
    build: 'wiry|broad-shouldered|stooped|lanky|round-faced|compact|heavy-set|willowy|bony|barrel-chested|small and quick|tall and slow-moving',
    look: 'a burn scar across one hand|silver rings on every finger|one cloudy eye|ink-stained cuffs|a braid tied with fishing line|a missing front tooth|freckles like spilled sand|a voice too deep for their size|a nose broken more than once|a tattoo of a ship on the throat|eyebrows that meet in the middle|hands that never stop fidgeting|a coat two sizes too big|immaculate boots in a muddy town|a limp they refuse to explain|hair dyed the colour of rust|a necklace of small bones|a face weathered like driftwood|a perpetual squint|bright, mismatched eyes|calloused, tar-black palms|a smile with too many teeth|an elegant cane they do not need|a sunburnt bald head|a cough they hide behind a scarf|spectacles mended with wire|a sailor\'s earring|a faded noble crest on a patched cloak|soot in every crease|a sprig of herbs behind one ear',
    trait: 'speaks in proverbs|laughs too loudly at their own jokes|never sits with their back to a door|collects buttons from strangers|hums work songs under their breath|is suspicious of anyone from inland|is unfailingly polite, even when threatening|keeps a ledger of every favour owed|cannot tell a story without embellishing it|is fiercely loyal to their street|is terrified of deep water|gives advice nobody asked for|is gentle with animals and curt with people|quotes scripture, slightly wrong|counts things when nervous|is generous to a fault and always broke|takes offence at the smallest slight|is easily bored and always moving|remembers every face and forgets every name|is honest to the point of rudeness|flirts with everyone out of habit|is pious in public, cynical in private|gambles on anything, even the weather|treats every deal like a battle|is sentimental about old songs|never finishes a sentence|is relentlessly cheerful in a grim town|apologises for everything|tells the truth only when it costs them nothing|is proud of a trade nobody admires|whittles while they talk|insists on paying for everything|keeps strange hours and stranger company|is bitter about a promotion that never came|cannot resist a wager|speaks to their dead spouse aloud|mispronounces long words with confidence|is courteous to the gods, rude to their priests|watches the sky for omens|keeps meticulous lists',
    want: 'to buy back the family boat|a cure for a sister\'s cough|revenge on the harbourmaster|their name entered in the guild ledger|to leave town before winter|a child\'s safe return from the sea|to marry above their station|to find who poisoned their dog|enough coin to open a shop|to be taken seriously by the council|forgiveness from an old friend|to see the capital once before they die|the deed to a field their grandmother lost|to prove a rival is a cheat|a quiet life, finally|to learn to read|a map to the wreck their father sailed on|to be left alone by the temple|to win the spring wager|an apprentice who will not quit|to restore a ruined chapel|a seat at the lord\'s table|to undo a promise made while drunk|to know what is buried under the old mill|the return of a stolen heirloom|to outlive their creditors|a new name and a new start|to see the sea monster their uncle swore was real|a pardon for a brother|their late master\'s recipe book',
    fear: 'deep water|the dark under the docks|being forgotten|their own temper|dogs|the tax collector|fire|the old gods noticing them|losing their hands|debt|the plague coming back|silence|heights|their mother\'s disapproval|being found out',
    secret: 'is paid by smugglers to look the other way|buried a stranger beneath the floorboards|cannot actually read|is the rightful heir to a lapsed title|writes love letters to the temple\'s priest|stole the money that founded their business|informs for the lord\'s steward|has a second family in the next town|is not who they claim; the real one drowned|keeps a forbidden book under the bed|set the fire everyone blamed on lightning|owes a terrible debt to a cult|knows where the old treasury went|poisons rats with something stronger than rat poison|is slowly going blind and hides it|sold a neighbour\'s secret to their enemies|deserted from an army that still hunts deserters|hears a voice from the well at night|forged their guild papers|is secretly wealthy and lives as a pauper|was once a notorious highway robber|loves someone they are forbidden to|witnessed a murder and said nothing|is in debt to a creditor who is not human|cheats at the harvest scales|has been dead once already|is a spy for a rival town|hid a fugitive in the cellar for a year|knows the leader\'s heir is a changeling|carries a cursed coin they cannot throw away',
    voice: 'a slow, careful drawl|a rasp from too much pipe smoke|a sing-song lilt|clipped, military sentences|a whisper that makes people lean in|a booming market-crier\'s voice|a nervous stammer that vanishes when angry|an educated accent worn thin|endless rhetorical questions|a laugh between every sentence|dry, deadpan understatement|a habit of calling everyone "friend"',
    /* ---- occupations by setting ---- */
    jobCommon: 'baker|butcher|carter|chandler|cobbler|cook|cooper|farmer|fishwife|gravedigger|herbalist|laundress|mason|midwife|miller|potter|ratcatcher|scribe|servant|shepherd|smith|stablehand|tailor|tanner|thatcher|tinker|washerwoman|weaver|woodcutter|beekeeper|candlemaker|lamplighter|messenger|nightwatch|porter|street sweeper|toll keeper|town crier|well-keeper',
    jobSea: 'net-mender|fisher|boatwright|harbour pilot|salt-panner|ropemaker|sailmaker|dockhand|lighthouse keeper|pearl diver|smoker of fish|tide-reader|wrecker|customs officer|ferry captain',
    jobRiver: 'ferry hand|miller|eel-trapper|dyer|bargeman|bridge-warden|fuller|reed-cutter',
    jobHill: 'shepherd|cheesemaker|drover|slate-cutter|wool-comber|copper miner',
    jobMountain: 'miner|smelter|stonecutter|mountain guide|goatherd|gem-cutter|ice-cutter',
    jobForest: 'woodcutter|charcoal-burner|trapper|forester|bowyer|carver|honey-gatherer|resin-tapper',
    jobPlain: 'ploughman|horse-breeder|thresher|brewer|cattle drover|reaper|hayward',
    jobDesert: 'caravan master|glassblower|well-digger|date farmer|camel trader|spice merchant|water-seller',
    jobTundra: 'hunter|reindeer herder|ivory carver|ice-fisher|hide tanner|sled-driver',
    jobSwamp: 'peat-cutter|eel-catcher|leech-gatherer|stilt-builder|bog-guide|reed-weaver',
    jobUrban: 'moneylender|notary|clerk|apothecary|jeweller|bookbinder|perfumer|watchman|courier|tutor|actor|bathhouse keeper|wigmaker|printer|glazier|locksmith|architect|bailiff|banker|physician',
    jobMagic: 'hedge-witch|astrologer|alchemist|wand-whittler|charm-seller|dream-reader|ward-scribe',
    jobShady: 'fence|pickpocket|smuggler|forger|debt collector|card sharp|informer|burglar',
    /* ---- things ---- */
    colour: 'red|green|blue|black|white|grey|golden|silver|copper|amber|crimson|violet|ochre|indigo|rust-coloured|sea-green',
    metal: 'iron|bronze|silver|gold|copper|tin|brass|pewter|steel|lead',
    material: 'oak|bone|antler|horn|whalebone|driftwood|jet|amber|soapstone|obsidian|glass|clay|ivory|leather|bog-oak|coral|slate|silk',
    gem: 'garnet|moonstone|jet bead|river pearl|amethyst|carnelian|agate|bloodstone|opal|jade|sea-glass|tiger\'s eye|lapis|topaz|sapphire|emerald|ruby|diamond',
    animal: 'gull|heron|crow|fox|hare|stag|boar|owl|eel|crab|seal|otter|badger|wolf|bear|raven|hound|goat|ram|horse|swan|pike|toad|moth|wren|lark|adder|salmon|cormorant|hawk',
    beast: 'wyrm|serpent|griffin|wyvern|kraken|basilisk|manticore|leviathan|chimera|cockatrice|hydra|roc',
    creature: 'sea-hag|bog lurker|shadow hound|ghoul|wraith|troll|giant spider|ogre|rust-beetle swarm|will-o-light|barrow-wight|drowned sailor|marsh goblin|stone sentinel|ice wolf|sand stalker|bandit crew|cultists|mad hermit|dire boar',
    smell: 'brine and rot|old incense|wet fur|smoke and tallow|mould and earth|sweet decay|cold iron|lamp oil|sulphur|crushed herbs|fresh blood|nothing at all, unnervingly',
    sound: 'dripping water|distant chanting|scratching inside the walls|wind moaning through a crack|a slow, heavy breathing|chains shifting|a child humming somewhere|the scrape of stone on stone|buzzing flies|absolute silence|creaking timbers|a bell, very far off',
    /* ---- small phrases ---- */
    weather: 'fog|rain|sleet|sun|wind|snow|thunder|drizzle|heat|frost',
    time: 'dawn|first bell|midday|dusk|midnight|the turn of the tide|market day|the new moon|the full moon|the first frost',
    holy: 'the Drowned Bell|the Lantern|the First Tide|the Quiet Mother|the Ninefold Star|the Grey Shepherd|the Ember Crown|the Weaver|the Long Road|the Green Man|the Salt Saint|the Patient Ox|the Lamp Below|the Burning Wheel|the Two Moons|the Hollow Hill|the Gatekeeper|the Sleeping Maiden',
    adjInn: 'Gilded|Drowned|Laughing|Crooked|Sleeping|Salted|Silver|Rusty|Wandering|Merry|Broken|Red|Hollow|Lucky|Blind|Copper|Whistling|Tipsy|Black|Golden|Old|Weeping|Dancing|Painted|Stubborn|Patient|Last|Lonely|Thirsty|Honest|Leaning|Iron|Velvet|Barnacled|Foggy|Bitter|Green|Hungry|Proud|Wicked|Jolly|Grinning|Sunken|Lame|Gentle|Wet|Bold|Rambling',
    nounInn: 'Gull|Anchor|Lantern|Oyster|Kettle|Stag|Boar|Owl|Fox|Hound|Crow|Goose|Barrel|Tankard|Wheel|Plough|Crown|Harp|Bell|Key|Compass|Eel|Crab|Heron|Badger|Mule|Pony|Rooster|Ram|Pike|Lamb|Candle|Moon|Star|Tide|Wave|Shell|Net|Mast|Oar|Thistle|Rose|Acorn|Cauldron|Quill|Drum|Fiddle|Hat|Boot|Wyrm|Mermaid|Sailor|Shepherd|Bishop|Widow|Giant|Dragon|Kraken|Pilgrim',
    innName: 'The {adjInn} {nounInn}|The {adjInn} {nounInn}|The {adjInn} {nounInn}|The {nounInn} and {nounInn}|The {nounInn}\'s Rest|The {nounInn}\'s Head|The {nounInn} in the {weather}|The {two|three|seven|nine} {nounInn}s|The {adjInn} {nounInn} Inn|The {nounInn} at {time}|The {colour} {nounInn}',
  });
  /** every occupation list a setting may draw from */
  G.JOBS = { coast: ['jobSea', 'jobCommon'], island: ['jobSea', 'jobCommon'], river: ['jobRiver', 'jobCommon'], hills: ['jobHill', 'jobCommon'], mountains: ['jobMountain', 'jobCommon'],
    forest: ['jobForest', 'jobCommon'], plains: ['jobPlain', 'jobCommon'], desert: ['jobDesert', 'jobCommon'], tundra: ['jobTundra', 'jobCommon'], swamp: ['jobSwamp', 'jobCommon'] };
  /** an occupation fitting the terrain and the size of the place */
  G.job = (t, terrain, { urban = false, magic = false, shady = 0.08 } = {}) => {
    const lists = (G.JOBS[terrain] || ['jobCommon']).map(k => [k, k === 'jobCommon' ? 3 : 2]);
    if (urban) lists.push(['jobUrban', 3]);
    if (magic) lists.push(['jobMagic', 1]);
    lists.push(['jobShady', shady * 10]);
    return t.pick(t.weighted(lists));
  };
  return G;
});
