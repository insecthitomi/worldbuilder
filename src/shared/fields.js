/* Built-in entry types, field kinds, relation types and world starters. Shared by the main process (seeding)
   and the renderer (field editors). Type and relation colours are data colours. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBFields = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = {
    text: { label: 'Short text', icon: 'T' },
    longtext: { label: 'Long text', icon: '¶' },
    number: { label: 'Number', icon: '#' },
    ref: { label: 'Link to an entry', icon: '↗', link: true },
    refs: { label: 'Links to entries', icon: '⇉', link: true },
    choice: { label: 'Choice', icon: '◉', options: true },
    multi: { label: 'Several choices', icon: '☑', options: true },
    bool: { label: 'Yes / no', icon: '◐' },
    url: { label: 'Web address', icon: '⌁' },
    image: { label: 'Image', icon: '▣' },
    color: { label: 'Colour', icon: '◍' },
    rating: { label: 'Rating (1–5)', icon: '★' },
    progress: { label: 'Progress (%)', icon: '▰' },
    stats: { label: 'Stat block', icon: '▤' },
    list: { label: 'List', icon: '≡' },
    dice: { label: 'Dice roll', icon: '⚄' },
    realdate: { label: 'Real-world date', icon: '▦' },
    axis: { label: 'Classification (race, class…)', icon: '◆' },
    attrs: { label: 'Attributes (stat block)', icon: '⬡' },
  };

  const f = (key, label, kind, extra) => Object.assign({ key, label, kind }, extra || {});
  const CHAR = ['character'], PLACE = ['place'], FACTION = ['faction'];

  /* key, name, plural, icon, color, extra props, fields */
  const TYPES = [
    ['character', 'Character', 'Characters', '☺', '#e0796b', { dated: { start: 'Born', end: 'Died' }, lifespan: true, pinnable: true, namegen: true }, [
      f('pronouns', 'Pronouns', 'text'),
      f('species', 'Species', 'ref', { refTypes: ['species'] }),
      f('culture', 'Culture', 'ref', { refTypes: ['culture'] }),
      f('allegiance', 'Allegiance', 'refs', { refTypes: FACTION }),
      f('occupation', 'Occupation', 'text'),
      f('home', 'Home', 'ref', { refTypes: PLACE }),
      f('status', 'Status', 'choice', { options: ['Alive', 'Dead', 'Missing', 'Unknown'] }),
      f('appearance', 'Appearance', 'longtext', { group: 'Portrait' }),
      f('personality', 'Personality', 'longtext', { group: 'Portrait' }),
      f('voice', 'Voice & mannerisms', 'text', { group: 'Portrait' }),
      f('goals', 'Wants', 'longtext', { group: 'Drives', required: true }),
      f('fears', 'Fears', 'longtext', { group: 'Drives' }),
      f('flaw', 'Flaw', 'text', { group: 'Drives' }),
      f('secret', 'Secret', 'longtext', { group: 'Drives', secret: true }),
      f('classes', 'Classification', 'axis', { group: 'Identity', wide: true, hint: 'Race, class, caste… set up in World settings → People & attributes.' }),
      f('attributes', 'Attributes', 'attrs', { group: 'Game', wide: true }),
      f('stats', 'Stats', 'stats', { group: 'Game', hint: 'Keys hp, ac and init feed the initiative tracker.' }),
    ]],
    ['place', 'Place', 'Places', '⌂', '#5fb38a', { dated: { start: 'Founded', end: 'Fell' }, hierarchical: true, childTypes: ['place'], pinnable: true, namegen: true }, [
      f('kind', 'Kind', 'choice', { options: ['World', 'Continent', 'Region', 'Nation', 'Province', 'City', 'Town', 'Village', 'District', 'Building', 'Landmark', 'Wilderness', 'Dungeon', 'Plane', 'Vessel'] }),
      f('population', 'Population', 'number'),
      f('ruler', 'Ruled by', 'ref', { refTypes: CHAR.concat(FACTION) }),
      f('climate', 'Climate', 'text'),
      f('economy', 'Economy', 'longtext'),
      f('features', 'Notable features', 'list'),
      f('danger', 'Danger', 'rating'),
      f('rumours', 'Rumours', 'list', { secret: true }),
    ]],
    ['faction', 'Faction', 'Factions', '⚑', '#c49a3c', { dated: { start: 'Founded', end: 'Dissolved' }, hierarchical: true, childTypes: ['faction'], pinnable: true }, [
      f('kind', 'Kind', 'choice', { options: ['Nation', 'House', 'Guild', 'Order', 'Cult', 'Company', 'Gang', 'Council', 'Army', 'Church'] }),
      f('leader', 'Leader', 'ref', { refTypes: CHAR }),
      f('seat', 'Seat', 'ref', { refTypes: PLACE }),
      f('motto', 'Motto', 'text'),
      f('symbol', 'Symbol', 'image'),
      f('colors', 'Colours', 'color'),
      f('goals', 'Goals', 'longtext', { required: true }),
      f('resources', 'Resources', 'list'),
      f('power', 'Power', 'progress'),
      f('agenda', 'Hidden agenda', 'longtext', { secret: true }),
    ]],
    ['species', 'Species', 'Species', '❦', '#8f7ad8', { pinnable: false, namegen: true }, [
      f('kind', 'Kind', 'choice', { options: ['People', 'Beast', 'Monster', 'Spirit', 'Plant', 'Construct', 'Undead', 'Divine'] }),
      f('habitat', 'Habitat', 'refs', { refTypes: PLACE }),
      f('lifespan', 'Lifespan', 'number', { unit: 'years' }),
      f('size', 'Size', 'choice', { options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] }),
      f('diet', 'Diet', 'text'),
      f('traits', 'Traits', 'list'),
      f('danger', 'Danger', 'rating'),
      f('classes', 'Classification', 'axis', { group: 'Identity', wide: true }),
      f('attributes', 'Attributes', 'attrs', { group: 'Game', wide: true }),
      f('stats', 'Stat block', 'stats', { group: 'Game' }),
    ]],
    ['item', 'Item', 'Items', '⚱', '#d2a35a', { dated: { start: 'Made', end: 'Lost' }, pinnable: true }, [
      f('kind', 'Kind', 'choice', { options: ['Weapon', 'Armour', 'Relic', 'Tool', 'Document', 'Jewel', 'Vehicle', 'Treasure', 'Potion', 'Technology'] }),
      f('owner', 'Owner', 'ref', { refTypes: CHAR.concat(FACTION) }),
      f('origin', 'Origin', 'ref', { refTypes: PLACE }),
      f('maker', 'Maker', 'ref', { refTypes: CHAR.concat(FACTION) }),
      f('properties', 'Properties', 'list'),
      f('value', 'Value', 'text'),
      f('curse', 'True nature', 'longtext', { secret: true }),
    ]],
    ['event', 'Event', 'Events', '✷', '#e2b33d', { dated: { start: 'Began', end: 'Ended' }, hierarchical: true, childTypes: ['event'], pinnable: true }, [
      f('kind', 'Kind', 'choice', { options: ['Battle', 'War', 'Treaty', 'Disaster', 'Discovery', 'Founding', 'Coronation', 'Death', 'Birth', 'Festival', 'Crime', 'Migration', 'Miracle'] }),
      f('location', 'Where', 'ref', { refTypes: PLACE }),
      f('participants', 'Who', 'refs', { refTypes: CHAR.concat(FACTION) }),
      f('outcome', 'Outcome', 'longtext'),
      f('significance', 'Significance', 'rating'),
      f('truth', 'What really happened', 'longtext', { secret: true }),
    ]],
    ['lore', 'Lore', 'Lore', '✧', '#6fa7d8', { hierarchical: true, childTypes: ['lore'] }, [
      f('category', 'Category', 'choice', { options: ['Religion', 'Deity', 'Myth', 'Magic', 'Technology', 'Law', 'Custom', 'History', 'Prophecy', 'Science', 'Philosophy'] }),
      f('origin', 'Origin', 'text'),
      f('believers', 'Held by', 'refs', { refTypes: ['culture', 'faction'] }),
      f('rules', 'Rules & limits', 'list'),
      f('cost', 'Cost', 'text'),
      f('truth', 'The truth', 'longtext', { secret: true }),
    ]],
    ['culture', 'Culture', 'Cultures', '❖', '#d6739c', { namegen: true }, [
      f('language', 'Language', 'ref', { refTypes: ['language'] }),
      f('homeland', 'Homeland', 'refs', { refTypes: PLACE }),
      f('values', 'Values', 'list'),
      f('customs', 'Customs', 'longtext'),
      f('dress', 'Dress', 'text'),
      f('food', 'Food & drink', 'text'),
      f('naming', 'Naming conventions', 'longtext', { group: 'Names' }),
      f('names_given', 'Sample given names', 'list', { group: 'Names', hint: 'Feeds the name generator.' }),
      f('names_family', 'Sample family names', 'list', { group: 'Names' }),
    ]],
    ['language', 'Language', 'Languages', 'ℒ', '#4fb6b2', { lens: 'language' }, [
      f('family', 'Family', 'text'),
      f('speakers', 'Spoken by', 'refs', { refTypes: ['culture', 'faction'] }),
      f('script', 'Script', 'text'),
      f('status', 'Status', 'choice', { options: ['Living', 'Dying', 'Dead', 'Liturgical', 'Constructed', 'Trade pidgin'] }),
      f('features', 'Grammar notes', 'longtext'),
    ]],
    ['story', 'Story', 'Stories', '✎', '#b07ad6', { lens: 'story', hierarchical: false, childTypes: ['chapter'] }, [
      f('genre', 'Genre', 'text'),
      f('logline', 'Logline', 'longtext'),
      f('target', 'Word target', 'number', { unit: 'words' }),
      f('pov', 'Main character', 'ref', { refTypes: CHAR }),
      f('stage', 'Stage', 'choice', { options: ['Idea', 'Outlining', 'Drafting', 'Revising', 'Editing', 'Finished', 'Published'] }),
      f('themes', 'Themes', 'list'),
    ]],
    ['chapter', 'Chapter', 'Chapters', '§', '#9b8bd0', { lens: 'story', childTypes: ['scene'] }, [
      f('status', 'Status', 'choice', { options: ['Idea', 'Draft', 'Revised', 'Final'] }),
      f('target', 'Word target', 'number', { unit: 'words' }),
    ]],
    ['scene', 'Scene', 'Scenes', '❡', '#8c9fe0', { lens: 'story', dated: { start: 'Starts', end: 'Ends' } }, [
      f('pov', 'Point of view', 'ref', { refTypes: CHAR }),
      f('location', 'Location', 'ref', { refTypes: PLACE }),
      f('cast', 'Characters', 'refs', { refTypes: CHAR }),
      f('status', 'Status', 'choice', { options: ['Idea', 'Draft', 'Revised', 'Final'] }),
      f('target', 'Word target', 'number', { unit: 'words' }),
      f('goal', 'Goal', 'text', { group: 'Beat' }),
      f('conflict', 'Conflict', 'text', { group: 'Beat' }),
      f('outcome', 'Outcome', 'text', { group: 'Beat' }),
      f('threads', 'Plot threads', 'refs', { refTypes: ['plot'], group: 'Beat' }),
    ]],
    ['plot', 'Plot thread', 'Plot threads', '⟿', '#e08b4f', { hierarchical: true, childTypes: ['plot'] }, [
      f('status', 'Status', 'choice', { options: ['Seed', 'Open', 'Active', 'Resolved', 'Abandoned', 'Failed'] }),
      f('giver', 'Started by', 'ref', { refTypes: CHAR.concat(FACTION) }),
      f('stakes', 'Stakes', 'longtext'),
      f('clues', 'Clues', 'list'),
      f('reward', 'Reward', 'text'),
      f('resolution', 'How it ends', 'longtext', { secret: true }),
    ]],
    ['map', 'Map', 'Maps', '⌖', '#6dbb6f', { lens: 'map', hierarchical: true, childTypes: ['map'] }, [
      f('kind', 'Kind', 'choice', { options: ['World', 'Region', 'City', 'Building', 'Dungeon', 'Battle', 'Star chart'] }),
      f('cartographer', 'Drawn by', 'ref', { refTypes: CHAR }),
    ]],
    ['board', 'Board', 'Boards', '▦', '#d97f9f', { lens: 'board' }, [
      f('purpose', 'Purpose', 'choice', { options: ['Plotting', 'Mind map', 'Mood board', 'Investigation', 'Planning'] }),
    ]],
    ['table', 'Random table', 'Random tables', '⚄', '#c7835b', { lens: 'table' }, [
      f('dice', 'Dice', 'dice', { hint: 'Leave empty to pick by weight.' }),
      f('creates', 'Results become', 'choice', { options: [] , hint: 'A type to turn results into entries.' }),
    ]],
    ['encounter', 'Encounter', 'Encounters', '⚔', '#d0574e', { lens: 'encounter', pinnable: true }, [
      f('location', 'Where', 'ref', { refTypes: PLACE }),
      f('difficulty', 'Difficulty', 'choice', { options: ['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly'] }),
      f('foes', 'Foes', 'refs', { refTypes: ['character', 'species'] }),
      f('treasure', 'Treasure', 'list'),
      f('tactics', 'Tactics', 'longtext', { secret: true }),
    ]],
    ['session', 'Session', 'Sessions', '☗', '#5a9fd4', { dated: { start: 'In-world start', end: 'In-world end' } }, [
      f('number', 'Number', 'number'),
      f('played', 'Played on', 'realdate'),
      f('players', 'At the table', 'list'),
      f('npcs', 'People met', 'refs', { refTypes: CHAR }),
      f('places', 'Places visited', 'refs', { refTypes: PLACE }),
      f('loot', 'Loot', 'list'),
      f('xp', 'Experience', 'number'),
      f('prep', 'Prep notes', 'longtext', { secret: true }),
    ]],
    ['note', 'Note', 'Notes', '✉', '#9aa5b1', {}, [
      f('audio', 'Recording', 'text', { hint: 'Media id of a voice memo.' }),
      f('transcript', 'Transcript', 'longtext'),
    ]],
    ['post', 'Post', 'Posts', '✦', '#e06aa8', { defaultAudience: 'public' }, [
      f('publish', 'Publish on', 'realdate'),
      f('status', 'Status', 'choice', { options: ['Draft', 'Scheduled', 'Published'] }),
      f('audience_tier', 'For', 'choice', { options: ['Everyone', 'Supporters'] }),
      f('excerpt', 'Excerpt', 'longtext'),
    ]],
    ['product', 'Product', 'Products', '¤', '#4fae7d', { defaultAudience: 'public' }, [
      f('price', 'Price', 'number', { unit: 'cents', hint: 'In cents (1999 = 19.99).' }),
      f('currency', 'Currency', 'text', { hint: 'Empty = the world currency.' }),
      f('format', 'Format', 'choice', { options: ['Ebook', 'Paperback', 'Hardcover', 'Audiobook', 'PDF', 'Art print', 'Map pack', 'Adventure module', 'Merch', 'Membership'] }),
      f('link', 'Buy link', 'url'),
      f('work', 'Work', 'ref', { refTypes: ['story', 'map', 'board', 'encounter'] }),
      f('status', 'Status', 'choice', { options: ['Planned', 'In production', 'Available', 'Sold out', 'Retired'] }),
      f('released', 'Released', 'realdate'),
      f('blurb', 'Store blurb', 'longtext'),
    ]],
  ];

  function builtinTypes() {
    return TYPES.map(([key, name, plural, icon, color, extra, fields], i) => Object.assign({
      key, name, plural, icon, color, fields: fields.map(x => Object.assign({}, x)), dated: null, lifespan: false, hierarchical: false,
      childTypes: [], lens: null, pinnable: false, defaultAudience: null, namegen: false, hidden: false, builtin: true, sort: (i + 1) * 10,
    }, JSON.parse(JSON.stringify(extra))));
  }

  /* name, inverse (null = symmetric), category, familyRole, color */
  const RELS = [
    ['parent of', 'child of', 'family', 'parent', '#e0796b'],
    ['spouse of', null, 'family', 'spouse', '#e06aa8'],
    ['sibling of', null, 'family', 'sibling', '#d6739c'],
    ['betrothed to', null, 'family', null, '#e09ab8'],
    ['friend of', null, 'social', null, '#5fb38a'],
    ['lover of', null, 'social', null, '#e06aa8'],
    ['rival of', null, 'social', null, '#e2b33d'],
    ['enemy of', null, 'social', null, '#d0574e'],
    ['mentor of', 'student of', 'social', null, '#6fa7d8'],
    ['serves', 'served by', 'social', null, '#9aa5b1'],
    ['owes a debt to', 'is owed by', 'social', null, '#c7835b'],
    ['member of', 'has member', 'political', null, '#c49a3c'],
    ['leader of', 'led by', 'political', null, '#d2a35a'],
    ['ally of', null, 'political', null, '#5fb38a'],
    ['at war with', null, 'political', null, '#d0574e'],
    ['vassal of', 'liege of', 'political', null, '#b8954a'],
    ['founded', 'founded by', 'political', null, '#8f7ad8'],
    ['spy for', 'has spy', 'political', null, '#6b6f7d'],
    ['lives in', 'home of', 'spatial', null, '#5fb38a'],
    ['rules', 'ruled by', 'spatial', null, '#c49a3c'],
    ['born in', 'birthplace of', 'spatial', null, '#8c9fe0'],
    ['buried in', 'resting place of', 'spatial', null, '#7a8291'],
    ['owns', 'owned by', 'other', null, '#d2a35a'],
    ['created', 'created by', 'other', null, '#8f7ad8'],
    ['worships', 'worshipped by', 'other', null, '#6fa7d8'],
    ['caused', 'caused by', 'other', null, '#e08b4f'],
    ['related to', null, 'other', null, '#9aa5b1'],
  ];
  const builtinRels = () => RELS.map(([name, inverse, category, familyRole, color], i) => ({
    name, inverse: inverse || name, symmetric: !inverse, category, familyRole, color, builtin: true, sort: (i + 1) * 10,
  }));
  const CATEGORIES = [['family', 'Family'], ['social', 'Social'], ['political', 'Political'], ['spatial', 'Places'], ['other', 'Other']];

  /* starters: rename or hide built-in types, set the calendar flavour and default audience */
  const STARTERS = {
    fantasy: { label: 'Fantasy', desc: 'Kingdoms, magic, gods and monsters.', audience: 'shared' },
    scifi: { label: 'Science fiction', desc: 'Star systems, species, corporations and technology.', audience: 'shared',
      rename: { place: ['Location', 'Locations'], item: ['Technology', 'Technology'], lore: ['Science & lore', 'Science & lore'] },
      calendar: { eras: [{ name: 'Standard Era', abbr: 'SE', start: 1 }], before: { name: 'Before Standard Era', abbr: 'BSE' } } },
    modern: { label: 'Modern & mystery', desc: 'Cities, cases, suspects and secrets.', audience: 'private',
      rename: { faction: ['Organization', 'Organizations'], lore: ['Background', 'Background'], plot: ['Case', 'Cases'] },
      hide: ['species', 'encounter', 'table'] },
    campaign: { label: 'Tabletop campaign', desc: 'Sessions, encounters, quests and a player wiki.', audience: 'shared', rename: { plot: ['Quest', 'Quests'] } },
    novel: { label: 'Novel', desc: 'A story first: manuscript, cast, settings and plot threads.', audience: 'private', hide: ['encounter', 'session', 'table'] },
    blank: { label: 'Blank', desc: 'Every type, no assumptions.', audience: 'shared' },
  };

  /* presets: ready-made starting points in the create dialog (fields + a body of guiding questions) */
  const Q = (...sections) => sections.map(([h, q]) => '<h3>' + h + '</h3><p><em>' + q + '</em></p>').join('');
  const PRESETS = [
    ['character', 'Hero', '★', { status: 'Alive' }, Q(['Where they come from', 'What did they lose, and what do they still have?'], ['What they want', 'And what do they need instead?'], ['What stands in the way', 'Who or what — and why can\'t they just walk around it?'])],
    ['character', 'Villain', '☠', { status: 'Alive' }, Q(['Why they are right', 'From where they stand, what are they fixing?'], ['Their plan', 'Three steps, and the one nobody sees coming.'], ['Their weakness', 'What would make them stop?'])],
    ['character', 'Mentor', '✧', { status: 'Alive' }, Q(['What they know', 'And what they refuse to teach.'], ['Their old failure', 'Who did they fail before?'])],
    ['character', 'Ruler', '♛', { status: 'Alive', occupation: 'Ruler' }, Q(['How they took power', ''], ['Who could replace them', ''], ['What keeps them awake', ''])],
    ['character', 'Merchant', '¤', { status: 'Alive', occupation: 'Merchant' }, Q(['What they sell — openly', ''], ['What they sell — quietly', ''], ['Who owes them', ''])],
    ['character', 'Quick NPC', '☺', { status: 'Alive' }, '<p><em>One look, one want, one secret.</em></p>'],
    ['place', 'Tavern', '♨', { kind: 'Building' }, Q(['The room', 'What do you smell, hear and see as the door opens?'], ['The owner', 'Who runs it, and what do they want?'], ['On the menu', 'Food, drink and prices.'], ['Regulars', 'Three faces at the bar.'], ['Rumours', 'What is overheard tonight?'])],
    ['place', 'Temple', '✝', { kind: 'Building' }, Q(['Who is worshipped', ''], ['The clergy', ''], ['Rites & holy days', ''], ['What is hidden in the crypt', ''])],
    ['place', 'Port city', '⚓', { kind: 'City' }, Q(['The harbour', 'Ships, cargo and who controls the docks.'], ['Districts', ''], ['Who rules', ''], ['Trouble', 'Smugglers, plague, war, debt?'])],
    ['place', 'Castle', '♜', { kind: 'Building' }, Q(['Who holds it', ''], ['Defences', ''], ['Its history', 'Sieges, betrayals, ghosts.'])],
    ['place', 'Village', '⌂', { kind: 'Village' }, Q(['What it lives on', ''], ['Notable folk', ''], ['What it fears', ''])],
    ['place', 'Dungeon', '☠', { kind: 'Dungeon', danger: 4 }, Q(['Who built it, and why', ''], ['Who lives here now', ''], ['Rooms', '1. Entrance — …'], ['The treasure', ''])],
    ['place', 'Capital city', '♛', { kind: 'City' }, Q(['The seat of power', ''], ['Districts', ''], ['Factions', ''], ['Landmarks', ''])],
    ['place', 'Planet', '◍', { kind: 'World' }, Q(['Physical', 'Size, gravity, day length, moons, climate.'], ['Life', ''], ['Civilisations', ''])],
    ['faction', 'Noble house', '⚑', { kind: 'House' }, Q(['Lineage', ''], ['Holdings', ''], ['Allies & enemies', ''], ['The family secret', ''])],
    ['faction', 'Thieves\' guild', '⚷', { kind: 'Guild' }, Q(['How to join', ''], ['Ranks & rules', ''], ['Turf', ''], ['Who protects them', ''])],
    ['faction', 'Religious order', '✝', { kind: 'Order' }, Q(['Doctrine', ''], ['Hierarchy', ''], ['Schisms', ''])],
    ['faction', 'Merchant company', '¤', { kind: 'Company' }, Q(['Trade routes', ''], ['Partners', ''], ['Rivals', ''])],
    ['faction', 'Secret society', '◐', { kind: 'Cult' }, Q(['What they believe', ''], ['How they recognise each other', ''], ['Their endgame', ''])],
    ['item', 'Artifact of power', '✦', { kind: 'Relic' }, Q(['What it does', ''], ['What it costs', ''], ['Who has held it', ''])],
    ['item', 'Weapon', '⚔', { kind: 'Weapon' }, Q(['Its make', ''], ['Its name & legend', ''])],
    ['item', 'Book or scroll', '✎', { kind: 'Document' }, Q(['What is written in it', ''], ['Who wants it', ''])],
    ['event', 'Battle', '⚔', { kind: 'Battle' }, Q(['The sides', ''], ['How it went', ''], ['What it changed', ''])],
    ['event', 'Coronation', '♛', { kind: 'Coronation' }, Q(['Who was crowned', ''], ['Who objected', ''])],
    ['event', 'Disaster', '☄', { kind: 'Disaster' }, Q(['What happened', ''], ['Who survived', ''], ['What it left behind', ''])],
    ['event', 'Treaty', '✍', { kind: 'Treaty' }, Q(['Terms', ''], ['Who signed', ''], ['Who broke it', ''])],
    ['lore', 'Religion', '✝', { category: 'Religion' }, Q(['Gods', ''], ['Beliefs', ''], ['Practices', ''], ['Clergy & holy places', ''])],
    ['lore', 'Magic system', '✧', { category: 'Magic' }, Q(['Where it comes from', ''], ['Who can use it', ''], ['Rules', 'What can it never do?'], ['Price', ''])],
    ['lore', 'Deity', '☀', { category: 'Deity' }, Q(['Domains', ''], ['Symbol & colours', ''], ['Worship', ''], ['Myths', ''])],
    ['lore', 'Legend', '❧', { category: 'Myth' }, Q(['The tale', ''], ['What is true in it', ''])],
    ['species', 'Dragon', '♆', { kind: 'Monster', size: 'Gargantuan', danger: 5 }, Q(['Lair', ''], ['Hoard', ''], ['Temperament', ''])],
    ['species', 'Intelligent people', '☺', { kind: 'People' }, Q(['Body & life cycle', ''], ['Society', ''], ['How others see them', ''])],
    ['species', 'Beast', '❦', { kind: 'Beast' }, Q(['Habitat', ''], ['Behaviour', ''], ['Uses', 'Hide, meat, magic?'])],
    ['culture', 'Seafaring folk', '⛵', {}, Q(['Ships & sea-lore', ''], ['Customs ashore', ''])],
    ['culture', 'Nomads', '⛺', {}, Q(['Routes & seasons', ''], ['What they carry', ''], ['Hospitality', ''])],
    ['plot', 'Mystery', '⌕', { status: 'Open' }, Q(['The crime', ''], ['Suspects', ''], ['Clues', ''], ['The truth', ''])],
    ['plot', 'Quest', '⟿', { status: 'Open' }, Q(['The call', ''], ['Obstacles', ''], ['Reward', ''])],
  ].map(([type, label, icon, fields, body]) => ({ type, label, icon, fields, body: body.replace(/<p><em><\/em><\/p>/g, '<p></p>') }));

  /** empty value for a field kind */
  function empty(kind) {
    switch (kind) {
      case 'refs': case 'multi': case 'list': case 'stats': return [];
      case 'axis': case 'attrs': return {};
      case 'bool': return false;
      case 'number': case 'rating': case 'progress': return null;
      default: return '';
    }
  }
  /** whether a field holds a value */
  function filled(kind, v) {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (kind === 'bool') return v === true;
    if (kind === 'axis') return typeof v === 'object' && Object.keys(v).some(k => [].concat(v[k]).some(Boolean));
    if (kind === 'attrs') return typeof v === 'object' && Object.keys(v).some(k => v[k] && typeof v[k] === 'object' && Object.keys(v[k]).length > 0);
    return String(v).trim() !== '';
  }
  /** text of a field for search and exports (refs as ids) */
  function asText(def, v, titleOf) {
    if (!filled(def.kind, v)) return '';
    switch (def.kind) {
      case 'ref': return titleOf ? titleOf(v) || '' : '';
      case 'refs': return titleOf ? v.map(titleOf).filter(Boolean).join(', ') : '';
      case 'multi': case 'list': return v.join(', ');
      case 'stats': return v.map(s => s.label + ' ' + s.value).join(', ');
      case 'axis': return Object.keys(v).map(k => [].concat(v[k]).filter(Boolean).join(', ').replace(/_/g, ' ')).filter(Boolean).join('; ');
      case 'attrs': return Object.keys(v).map(k => Object.keys(v[k] || {}).map(a => a + ' ' + v[k][a]).join(', ')).filter(Boolean).join('; ');
      case 'bool': return v ? 'Yes' : 'No';
      case 'rating': return '★'.repeat(+v || 0);
      case 'progress': return v + '%';
      default: return String(v);
    }
  }
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';

  /** may an entry of type `child` sit inside one of type `parent`? World setting allowAnyNesting (default on) allows everything;
      off, a type nests in itself when `hierarchical`, and holds other types listed in its `childTypes` (keys) */
  function canNest(settings, parent, child) {
    if (!parent || !child) return true;
    if (!settings || settings.allowAnyNesting !== false) return true;
    const kids = parent.childTypes || [];
    if (parent.id === child.id || parent.key === child.key) return !!parent.hierarchical || kids.includes(child.key);
    return kids.includes(child.key);
  }
  /** type keys offered as "Add inside": the type's childTypes, else itself when it nests, else nothing special */
  function childChoices(parent) {
    const out = (parent.childTypes || []).slice();
    if (parent.hierarchical && !out.includes(parent.key)) out.push(parent.key);
    return out;
  }

  return { canNest, childChoices, KINDS, builtinTypes, builtinRels, CATEGORIES, STARTERS, PRESETS, empty, filled, asText, slug };
});
