/* Guide: "what do you want to do?" — recipes by purpose that open the right screen or run the right command,
   every screen at a glance, and the keyboard shortcuts. WB.guide.match(q) also feeds the palette's "How to" rows. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;

  const PURPOSES = [
    ['all', '✦', 'Everything'],
    ['start', '➜', 'Start here'],
    ['maps', '🗺', 'Maps, planets & borders'],
    ['towns', '⌂', 'Towns & generators'],
    ['history', '⟷', 'History & time'],
    ['people', '☍', 'People & connections'],
    ['write', '✎', 'Writing stories'],
    ['games', '⚄', 'Running games'],
    ['lang', 'ᚨ', 'Languages & names'],
    ['design', '⚙', 'Game design & data'],
    ['share', '⇪', 'Publish & sell'],
    ['keep', '⛁', 'Organise & keep safe'],
  ];

  /* a recipe: { id, p: [purposes], icon, t: title, why, steps: [], c: command id | fn() | go: [screen, params], at: screen id, words } */
  const R = [
    // start here
    { id: 'new-world', p: ['start'], icon: '✦', t: 'Start a new world', why: 'Pick what you are making — a fantasy realm, a sci-fi setting, a campaign, a novel — and get sensible types to begin with.', steps: ['Choose a starter (it only sets defaults)', 'Name the world', 'Everything can change later in World → Types & fields'], fn: () => WB.newWorld(), at: 'home', free: true, words: 'create begin project setting' },
    { id: 'example', p: ['start'], icon: '❖', t: 'Explore the example world', why: 'The Saltmarch shows every feature filled in: maps with moving borders, a dynasty, a language, a manuscript, a shop.', steps: ['Open it from the world menu or here', 'Click around — nothing you do there matters', 'Switch back to your own world from the title bar'], fn: async () => { const w = await WB.api('worlds.sample'); await WB.switchWorld(w.id); WB.go('home'); }, at: 'home', free: true, words: 'sample demo tour saltmarch' },
    { id: 'first-entry', p: ['start'], icon: '☺', t: 'Add a character, place or anything', why: 'Everything in a world is an entry with fields, notes and links. Twenty-odd types come built in.', steps: ['Press Ctrl+N anywhere', 'Pick a type, type a name (or roll one with 🎲)', 'Fill in the fields you care about — the rest can wait'], fn: () => WB.ui.createDialog({}), at: 'codex', words: 'create new entry character npc place item faction ctrl+n' },
    { id: 'link-text', p: ['start', 'write'], icon: '@', t: 'Link things while you write', why: 'Mentions make your world a web: every page shows what links to it, and renames follow everywhere.', steps: ['In any text, type @ or [[ and a few letters', 'Pick the entry — or press Enter to create it on the spot', 'Ctrl+Click a link to peek without leaving the page'], go: ['codex'], at: 'codex', words: 'mention wikilink backlink connect reference' },
    { id: 'capture', p: ['start', 'keep'], icon: '✚', t: 'Catch an idea before it’s gone', why: 'Quick capture drops a note in the Inbox from anywhere; sort it into a real entry later.', steps: ['Press Ctrl+Shift+N', 'Type the idea (and #tags if you like)', 'Later: Inbox → turn it into a character, place, scene…'], fn: () => WB.capture(), at: 'inbox', words: 'quick note inbox idea jot' },
    { id: 'search', p: ['start'], icon: '⌕', t: 'Find anything, run anything', why: 'Ctrl+K searches every entry and every command. Filters: t:place  #tag  is:fav  has:date.', steps: ['Press Ctrl+K (or /)', 'Type a name, words from a page, or what you want to do', 'Shift+Enter creates what you typed; r 2d6 rolls dice'], fn: () => WB.palette(), at: 'home', words: 'search palette command find ctrl+k' },
    { id: 'share-view', p: ['start', 'games', 'share'], icon: '◑', t: 'See only what players may see', why: 'Share view hides private entries, secret fields and secret passages, and anything not yet revealed.', steps: ['Mark text secret with Ctrl+Shift+S, or a whole entry Private', 'Set “Reveal to players on…” for a later surprise', 'Toggle ◐ Author / ◑ Share view in the title bar'], fn: () => WB.setShare(!WB.share), at: 'home', words: 'secret players spoilers hide reveal gm' },

    // maps, planets & borders
    { id: 'map', p: ['maps'], icon: '🗺', t: 'Make a map of your world', why: 'Use your own drawing, a blank sheet or generated terrain, then pin entries, draw territories, routes and labels on it. The View menu switches between political, terrain, relief, climate, travel, resources and economy.', steps: ['Maps & Sim → Atlas → New map', 'Use an image you made, or generate terrain', 'Tools: Pin (P), Territory (R), Route (L), Label (T), Measure (M)'], c: 'atlas:new', at: 'atlas', words: 'atlas map image draw continent region' },
    { id: 'terrain', p: ['maps'], icon: '⛰', t: 'Generate a continent or islands', why: 'Seeded terrain with plate ridges, erosion, climate, biomes, rivers, lakes and resource deposits. Re-roll until you like it, then keep editing it by hand.', steps: ['Maps & Sim → Atlas → Generate terrain', 'Choose a shape: continent, islands, archipelago, a whole planet', 'Create, then draw borders and found settlements on it'], c: 'atlas:terrain', at: 'atlas', words: 'random terrain generator procedural island continent' },
    { id: 'planet', p: ['maps'], icon: '🌍', t: 'Build a whole planet', why: 'Planet maps wrap around a globe, measure on a sphere and give real coordinates and areas.', steps: ['Maps & Sim → Atlas → New map → Planet (or generate a planet)', 'Set the planet’s radius — the scale follows', 'Spin the globe; distances and areas are measured on the sphere'], c: 'atlas:new', at: 'atlas', words: 'globe sphere planet world map latitude longitude' },
    { id: 'borders', p: ['maps', 'history'], icon: '⬠', t: 'Draw country borders that change over time', why: 'Each territory belongs to a nation or faction and can hold From/Until dates — the map follows the timeline.', steps: ['Maps & Sim → Atlas → Territory tool (R): click the corners, Enter to finish', 'Link it to the faction or place that holds it', 'Give it From / Until dates; draw the next border for the next era'], c: 'atlas:open', at: 'atlas', words: 'border borders country nation kingdom territory empire war conquest' },
    { id: 'who-held', p: ['maps', 'history'], icon: '⌛', t: 'See who held a place through history', why: 'Right-click any spot on a map to list every territory that covered it, in order.', steps: ['Open a map in the Atlas', 'Right-click a spot → Who held this spot?', 'Each line opens the nation’s entry'], c: 'atlas:open', at: 'atlas', words: 'history border ownership held control timeline map' },
    { id: 'travel', p: ['maps', 'games'], icon: '📏', t: 'Measure distances and travel time', why: 'Maps know their scale, so routes show how long the journey takes on foot, horse or ship. The Travel view draws how far you get in a day, a week or a month from any point.', steps: ['Measure tool (M): click along the way', 'Read distance and travel time', '“Save as route” keeps it on the map'], c: 'atlas:open', at: 'atlas', words: 'distance travel time scale route journey road' },
    { id: 'simulate', p: ['maps', 'games', 'design'], icon: '⇄', t: 'Simulate trade and resources', why: 'Settlements gather, make and trade along your map’s routes under laws and customs you write (embargoes, tariffs, tithes, festivals, rationing, winter closures). Watch prices, shortages and caravans, then record what happened.', steps: ['Maps & Sim → Simulate, pick a map (or a preset), Import settlements & routes', 'Run it; click a settlement to see its stock and prices; add rules in Rules', 'Compare a run with a rule on and off; use “Record this in the world’s history” to make events'], go: ['simulate'], at: 'simulate', words: 'simulate economy trade routes caravan resources prices embargo tariff tithe rationing supply demand market' },
    { id: 'submaps', p: ['maps'], icon: '⤵', t: 'Maps inside maps', why: 'A pin can open its own map — continent → region → city → building.', steps: ['Pin a place on a map', 'Give the pin a sub-map in its inspector', 'Double-click the pin to dive in'], c: 'atlas:open', at: 'atlas', words: 'sub map nested city plan zoom' },
    { id: 'nesting', p: ['maps', 'keep'], icon: '⇲', t: 'Put places inside places', why: 'Any entry can live inside another: districts in cities, cities in provinces, chapters in books.', steps: ['In the Codex tree, drag an entry onto another (top edge: before, bottom edge: after, middle: inside)', 'Or press Tab / Shift+Tab to indent and outdent, Alt+↑↓ to reorder, ⋯ → Move to… to search a new parent', 'Shift- or Ctrl-click several to move, tag or delete them together', 'The path above an entry and its Contents card follow'], go: ['codex'], at: 'codex', words: 'hierarchy parent child nest tree inside district indent outdent drag move contents breadcrumb' },

    // towns & generators
    { id: 'town', p: ['towns', 'games', 'maps'], icon: '⌂', t: 'Create a whole town in one go', why: 'Generates a settlement with districts, notable places, residents and owners, a street map — and makes them all entries.', steps: ['Toolkit → Generators → Town (or right-click a map → Found a settlement here…)', 'Choose size, culture and what to include; re-roll any part', 'Create — everything lands in the Codex, linked; Undo is one click'], go: ['toolkit', { tool: 'town' }], at: 'toolkit', words: 'town city village settlement generate create found districts residents' },
    { id: 'npc', p: ['towns', 'games'], icon: '☺', t: 'Make an NPC on the spot', why: 'A person with a name from your cultures, a look, a manner, a want and a secret.', steps: ['Toolkit → NPC (or Ctrl+K → Generate an NPC)', 'Re-roll what you don’t like', 'Keep it as a Character entry'], go: ['toolkit', { tool: 'npc' }], at: 'toolkit', words: 'npc character person generate random' },
    { id: 'tavern', p: ['towns', 'games'], icon: '☕', t: 'A tavern, shop or landmark', why: 'Taverns with menus and regulars, shops with stock and prices in your world’s coins, landmarks with a story.', steps: ['Toolkit → Generators', 'Pick tavern, shop or landmark', 'Create to keep it'], go: ['toolkit', { tool: 'tavern' }], at: 'toolkit', words: 'inn tavern shop store landmark menu prices' },
    { id: 'generators', p: ['towns', 'games', 'design'], icon: '✦', t: 'Quests, rumours, treasure, weather…', why: 'Seeded generators for quests, rumours, twists, weather by season, treasure, artifacts, ships, deities, religions and factions.', steps: ['Toolkit → Generators', 'Pick one; inputs use your world’s names and calendar', 'Re-roll, then create entries from the result'], go: ['toolkit', { tool: 'gen' }], at: 'toolkit', words: 'random generator quest rumour twist weather treasure loot ship god religion' },
    { id: 'tables', p: ['towns', 'games'], icon: '☷', t: 'Your own random tables', why: 'Weighted or dice tables that can roll on other tables — encounters, names, events.', steps: ['Toolkit → Random tables → New table', 'Add rows with weights or dice ranges', 'Roll; use [[other table]] inside a row to nest'], go: ['toolkit', { tool: 'tables' }], at: 'toolkit', words: 'random table oracle encounter roll' },

    // history & time
    { id: 'calendar', p: ['history', 'start'], icon: '▦', t: 'Design your own calendar', why: 'Months, weekdays, leap years, eras (with a “before” count), moons and seasons — every date in the app uses it.', steps: ['Settings → World settings → Calendar', 'Start from a preset or build from scratch', 'The live preview shows a month with its moons'], c: 'world:calendar', at: 'world', words: 'calendar months weeks moons seasons eras leap year' },
    { id: 'timeline', p: ['history'], icon: '⟷', t: 'See history on a timeline', why: 'Everything dated on one zoomable line, from millennia to hours, in lanes by type, tag or place.', steps: ['World → Timeline → Timeline', 'Scroll to zoom, drag to pan; double-click empty space to add an event there', 'Drag a bar (or its ends) to re-date it'], go: ['chronicle', { view: 'timeline', fit: true }], at: 'chronicle', words: 'timeline history chronology events zoom' },
    { id: 'event', p: ['history'], icon: '✷', t: 'Record an event', why: 'Wars, treaties, founding days — events can contain smaller events and become named periods.', steps: ['Ctrl+K → New event at a date', 'Give it a start and (optionally) an end', 'Link who was there; it shows in their annals'], c: 'chronicle:event', at: 'chronicle', words: 'event war battle treaty history happen date' },
    { id: 'annals', p: ['history'], icon: '⧉', t: 'Read the history of anything', why: 'Annals gather an entry’s own dates, events it took part in, relations with dates, family births and deaths, and border changes.', steps: ['Open an entry → History card, or Chronicle → Annals', 'Filter by kind of record', 'Copy, save as Markdown or print'], c: 'chronicle:annals', at: 'chronicle', words: 'annals history records chronicle biography' },
    { id: 'rulers', p: ['history', 'people'], icon: '♛', t: 'Track rulers and succession', why: 'Reigns of every realm with gaps (interregnums), overlaps, ages at accession and lengths of rule.', steps: ['Relate a person to a place or faction with “rules” and dates', 'World → Timeline → Succession', 'Add the next reign straight from there'], c: 'chronicle:succession', at: 'chronicle', words: 'king queen ruler reign dynasty succession throne' },
    { id: 'ages', p: ['history', 'people'], icon: '⌛', t: 'Who is alive (and how old) on a date', why: 'Pick any date to see who lives, their ages, who was born or died that year, and anniversaries.', steps: ['World → Timeline → Ages', 'Choose a date', 'Click anyone to open them'], c: 'chronicle:today', at: 'chronicle', words: 'age alive born died anniversary on this day' },
    { id: 'advance', p: ['history', 'games'], icon: '⏩', t: 'Move the world’s clock forward', why: 'Advance a day, a season or a year; see what happens on the way and write a log entry.', steps: ['Ctrl+K → Advance world time', 'Pick a step or an exact date', 'Optionally log it as a note or session entry'], c: 'chronicle:advance', at: 'chronicle', words: 'time passes advance day now today clock' },

    // people & connections
    { id: 'graph', p: ['people'], icon: '☍', t: 'See how everything connects', why: 'A live graph of every link and relation, with filters, groups and a focus mode.', steps: ['World → Connections → Graph', 'Hover to light up neighbours; filter by type and kind', 'Right-click an entry → Focus to see just its circle'], c: 'web:graph', at: 'web', words: 'graph network connections links relations map' },
    { id: 'family', p: ['people', 'history'], icon: '⚭', t: 'Build family trees', why: 'Ancestors, descendants, several marriages, half-siblings — and a kinship calculator (“second cousin once removed”).', steps: ['World → Connections → Family tree of…', 'Add parents, partners and children straight in the tree', 'Pick two people to see how they are related'], c: 'web:family', at: 'web', words: 'family tree genealogy parents children marriage cousin kinship dynasty' },
    { id: 'path', p: ['people'], icon: '⇝', t: 'How are two things connected?', why: 'Finds the shortest chains of links between any two entries.', steps: ['Ctrl+K → Find the connection between…', 'Pick both entries', 'Each step says how they link'], c: 'web:path', at: 'web', words: 'path connection between link chain degrees' },
    { id: 'relations', p: ['people'], icon: '⇄', t: 'Relations with dates', why: 'Allies, rivals, married, rules, member of… each can have a note and From/Until dates.', steps: ['Open an entry → Relations → ＋', 'Pick the other entry and the kind', '“When…” sets dates; both sides show it'], go: ['web', { tab: 'relations' }], at: 'web', words: 'relation ally enemy rival married member rules' },

    // writing
    { id: 'story', p: ['write'], icon: '✎', t: 'Write a novel, series or script', why: 'Books, chapters and scenes with your world one click away, POV and cast per scene, and word goals.', steps: ['Create → Write → New story', 'Add chapters and scenes; drag to reorder', 'Mention characters with @ — they show up in the scene’s cast'], c: 'write:story', at: 'write', words: 'novel book manuscript chapter scene script story' },
    { id: 'focus', p: ['write'], icon: '◻', t: 'Write without distractions', why: 'Focus mode: just your text, typewriter scrolling, a quiet word counter.', steps: ['Open a scene in Write', 'Ctrl+K → Focus mode', 'Esc to come back'], c: 'write:focus', at: 'write', words: 'focus distraction free fullscreen typewriter' },
    { id: 'outline', p: ['write'], icon: '☰', t: 'Outline and corkboard', why: 'See the whole story as an outline with synopses, or as index cards to shuffle.', steps: ['Create → Write → Outline or Corkboard', 'Edit synopses in place', 'Drag cards to restructure'], c: 'write:outline', at: 'write', words: 'outline corkboard index cards plot structure' },
    { id: 'goals', p: ['write'], icon: '📈', t: 'Track words, goals and streaks', why: 'Daily and project goals, a writing streak and a history of your sessions.', steps: ['Create → Write → Statistics', 'Set a daily goal', 'Home shows your streak'], c: 'write:stats', at: 'write', words: 'word count goal streak statistics nanowrimo' },
    { id: 'compile', p: ['write', 'share'], icon: '⎙', t: 'Compile the manuscript', why: 'Export the book as PDF, Word, HTML or Markdown with your chosen front matter and scene breaks.', steps: ['Create → Write → Compile', 'Pick format and what to include', 'Save'], c: 'write:compile', at: 'write', words: 'compile export pdf word docx book manuscript' },
    { id: 'plot-board', p: ['write', 'design'], icon: '▦', t: 'Plot on a board', why: 'Infinite canvas for plot lines, mind maps and mood boards — with real entries as cards.', steps: ['Create → Boards → New board (try a template)', 'Drag entries in from the side; draw connectors', 'Frames group cards into acts or threads'], c: 'boards:new', at: 'boards', words: 'board canvas plot mind map mood corkboard whiteboard' },
    { id: 'continuity', p: ['write', 'games', 'keep'], icon: '✓', t: 'Catch continuity mistakes', why: 'Dead characters in later scenes, two places at once, parents younger than children, broken links, duplicates…', steps: ['World → Checks → run', '“Fix next” walks you through them', 'Mark anything deliberate as intended'], c: 'checks:open', at: 'checks', words: 'continuity errors plot holes consistency check' },

    // running games
    { id: 'session', p: ['games'], icon: '☗', t: 'Run a game session', why: 'A session log that collects rolls, people met, places visited and loot — then writes the recap.', steps: ['Toolkit → Session → Start', 'Rolls and notes land in the log automatically', 'End it to get a recap entry'], go: ['toolkit', { tool: 'session' }], at: 'toolkit', words: 'session game night log recap campaign gm' },
    { id: 'initiative', p: ['games'], icon: '⚔', t: 'Track combat and initiative', why: 'Turn order, hit points, conditions and rounds — encounters can be saved and reused.', steps: ['Toolkit → Initiative', 'Add combatants (from your Codex or quick ones)', 'Next turn with Space'], go: ['toolkit', { tool: 'initiative' }], at: 'toolkit', words: 'initiative combat encounter hp hit points turn order' },
    { id: 'dice', p: ['games'], icon: '⚄', t: 'Roll dice anywhere', why: 'Full notation: 4d6kh3, 2d20 adv, d%, exploding dice — and inline rolls inside your notes.', steps: ['Ctrl+K and type r 2d6+3', 'Or Toolkit → Dice for history and saved rolls', 'Write [[2d6]] in a note to make a clickable roll'], go: ['toolkit', { tool: 'dice' }], at: 'toolkit', words: 'dice roll d20 d6 advantage' },
    { id: 'handout', p: ['games', 'share'], icon: '✉', t: 'Print a handout for players', why: 'A clean page for one entry with secrets removed — print it or save as PDF.', steps: ['Share → Publish → Export → Handout', 'Pick the entry', 'Print or save'], c: 'publish:handout', at: 'publish', words: 'handout print players pdf card' },
    { id: 'player-wiki', p: ['games', 'share'], icon: '⌂', t: 'A wiki for your players', why: 'Build a website from your world that shows only what is shared — and keeps reveal dates.', steps: ['Share → Publish → Website → Audience: Shared', 'Preview it right there', 'Build to a folder and share it'], c: 'publish:site', at: 'publish', words: 'player wiki website share campaign' },

    // languages
    { id: 'language', p: ['lang'], icon: 'ᚨ', t: 'Create a language', why: 'Pick sounds from an IPA chart, set syllable shapes and spelling, and generate words that sound like they belong.', steps: ['Create → Lexicon → New language (start from a preset)', 'Phonology: click sounds, set syllable shapes', 'Samples update live; click one to keep it'], c: 'lexicon:language', at: 'lexicon', words: 'conlang language phonology ipa sounds' },
    { id: 'names', p: ['lang', 'start'], icon: '✍', t: 'Names that fit a culture', why: 'Names from a culture’s sample names, a language’s sounds or a sound style — checked against names you already use.', steps: ['Create → Lexicon → Name generator', 'Choose the culture or language', 'One click creates the character or place'], c: 'lexicon:names', at: 'lexicon', words: 'name generator names culture people places' },
    { id: 'dictionary', p: ['lang'], icon: '📖', t: 'Build a dictionary', why: 'Words with meanings, IPA, roots and derived words; import or export CSV.', steps: ['Create → Lexicon → your language → Lexicon tab', 'Type a meaning and press Ctrl+G to coin a word', 'Link words to the entries they name'], c: 'lexicon:word', at: 'lexicon', words: 'dictionary words vocabulary lexicon gloss' },
    { id: 'translate', p: ['lang'], icon: '⇄', t: 'Translate a sentence', why: 'Word by word by meaning, both ways — unknown words can be coined on the spot.', steps: ['Create → Lexicon → Translator', 'Type in English (or the language)', '“Add missing words…” fills the gaps'], c: 'lexicon:translate', at: 'lexicon', words: 'translate translation sentence phrase' },
    { id: 'daughter', p: ['lang', 'history'], icon: '⑂', t: 'Evolve a daughter language', why: 'Sound changes turn a proto-language into its descendants, with etymologies kept.', steps: ['Create → Lexicon → Sound changes', 'Write rules (from → to / where)', 'Create the daughter language — every word evolves'], c: 'lexicon:changes', at: 'lexicon', words: 'sound change evolution proto daughter etymology' },

    // game design & data
    { id: 'people', p: ['design', 'start'], icon: '◆', t: 'Race, class, caste and stats for your people', why: 'Define your own classifications (Race, Caste, Order, Calling…) with nested values, attribute systems with formulas and modifiers, and different words per people. Starter packs are optional.', steps: ['Settings → World settings → Structure → People & attributes', 'Add a starter pack or your own classification, then an attribute system', 'Give a value modifiers (an Elf gets +2 DEX) and its own words (Thane for Northmen)', 'Open a character: pick values and see the totals'], c: 'world:people', at: 'world', words: 'race species class caste profession rank attributes stats strength dexterity modifiers formula terminology subrace' },
    { id: 'types', p: ['design', 'start'], icon: '⚙', t: 'Your own types and fields', why: 'Make a “Spell”, “Starship” or “Card” type with exactly the fields you need — numbers, dice, lists, links.', steps: ['Settings → World settings → Types & fields', 'New type, or add fields to a built-in one', 'Fields can be secret, required or grouped'], c: 'world:types', at: 'world', words: 'custom type fields template schema spell item card stats' },
    { id: 'table-view', p: ['design', 'keep'], icon: '▤', t: 'Edit many entries like a spreadsheet', why: 'The Codex has four views of the same entries: Tree, List, Cards and Table. Table shows fields as columns — edit in place, sort, group, copy as TSV, add rows fast.', steps: ['World → Codex → choose a type on the left', 'Switch the view to Table (or Cards)', 'Choose columns, a group-by field and a sort; click a cell to edit'], go: ['codex', { table: true, typeKey: 'character' }], at: 'codex', words: 'table spreadsheet grid bulk edit columns' },
    { id: 'json', p: ['design', 'share'], icon: '{}', t: 'Export data for a game engine', why: 'JSON with a schema per type — ready for Unity, Godot or your own tools.', steps: ['Share → Publish → Export → JSON', 'Choose the audience and types', 'Save'], c: 'publish:json', at: 'publish', words: 'json export game engine unity godot data schema' },
    { id: 'csv', p: ['design', 'share'], icon: '▦', t: 'Spreadsheets in and out', why: 'CSV per type for Excel or Sheets — and import CSV back into any type with column mapping.', steps: ['Share → Publish → Export → CSV', 'Or Publish → Import → CSV into a type', 'Preview before anything changes'], c: 'publish:csv', at: 'publish', words: 'csv excel spreadsheet sheets import export' },

    // publish & sell
    { id: 'website', p: ['share'], icon: '⌂', t: 'Publish a website for your world', why: 'A complete offline site: entries, interactive maps, chronology, families, search, devlog and shop.', steps: ['Share → Publish → Website: pick theme and what to include', 'Preview on desktop, tablet and phone', 'Build to a folder — upload it anywhere'], c: 'publish:site', at: 'publish', words: 'website site wiki html publish' },
    { id: 'devlog', p: ['share'], icon: '✦', t: 'Write devlog posts', why: 'Drafts, scheduled posts and supporter-only posts, with RSS on your site.', steps: ['Share → Publish → Devlog → New post', 'Write, set status and date', 'It appears on the site when it goes live'], c: 'publish:new-post', at: 'publish', words: 'blog devlog news post update' },
    { id: 'bible', p: ['share', 'write'], icon: '▣', t: 'Print a world bible', why: 'A PDF with cover, contents, a part per type and page numbers — secrets removed for shared versions.', steps: ['Share → Publish → Export → PDF world bible', 'Pick the audience', 'Save'], c: 'publish:pdf', at: 'publish', words: 'pdf bible book print document' },
    { id: 'sales', p: ['share'], icon: '€', t: 'Track sales of what you sell', why: 'A ledger of sales, fees and refunds per product and channel, with goals and charts.', steps: ['Share → Business → Sales → log a sale (or import a store’s CSV)', 'Products are entries — prices and formats live there', 'Overview shows the month and the goal'], c: 'business:sale', at: 'business', words: 'sales money revenue shop store income ledger' },
    { id: 'supporters', p: ['share'], icon: '♥', t: 'Supporters, tiers and coupons', why: 'Membership tiers with perks, your supporters, coupon codes and reviews for your shop page.', steps: ['Share → Business → Supporters & tiers', 'Coupons and Reviews have their own tabs', 'Featured reviews show on your site'], c: 'business:supporters', at: 'business', words: 'patreon supporters members tiers coupons reviews' },
    { id: 'vault', p: ['share', 'keep'], icon: '⇩', t: 'Work with Obsidian or Markdown', why: 'Export a Markdown vault with [[links]] — or import one, folders becoming types and parents.', steps: ['Share → Publish → Export → Markdown vault', 'Or Publish → Import → Markdown / Obsidian vault', 'Imports show a preview and can be undone'], c: 'publish:vault', at: 'publish', words: 'obsidian markdown notes import export vault' },

    // organise & keep safe
    { id: 'inbox', p: ['keep'], icon: '✉', t: 'Sort your inbox', why: 'Everything captured waits here — turn each into the right kind of entry, or file it.', steps: ['Collect → Inbox → Sort', 'Choose a type for each idea', 'Or merge it into an existing entry'], c: 'inbox:triage', at: 'inbox', words: 'inbox triage sort ideas' },
    { id: 'voice', p: ['keep', 'start'], icon: '🎙', t: 'Record a voice memo', why: 'Talk an idea through; the memo lands in the Inbox with the recording.', steps: ['Ctrl+K → Record a voice memo', 'Speak, then stop', 'Sort it later'], c: 'inbox:voice', at: 'inbox', words: 'voice memo audio record microphone' },
    { id: 'tasks', p: ['keep', 'write'], icon: '☐', t: 'Keep a to-do list', why: 'Tasks with due dates and priorities, attached to entries or free-standing.', steps: ['Ctrl+K → Add a task', 'Or add one on any entry page', 'Home shows what is due'], c: 'inbox:addtask', at: 'inbox', words: 'task todo checklist due' },
    { id: 'library', p: ['keep'], icon: '▣', t: 'Keep images and files together', why: 'Every picture, map and sound file in one place, with where each is used.', steps: ['Collect → Library → Import (or drop files anywhere)', 'Use them as covers, in notes, on maps and boards', '“Unused” finds files nothing uses'], c: 'library:import', at: 'library', words: 'images files media pictures art library' },
    { id: 'backups', p: ['keep'], icon: '⛁', t: 'Backups and restoring', why: 'A backup is made every day and before big changes; restore any of them in two clicks.', steps: ['Settings → World settings → Backups', 'Back up now, or restore a backup', 'Packages (.wbworld) move a whole world to another computer'], c: 'world:backups', at: 'world', words: 'backup restore safety undo recover' },
    { id: 'replace', p: ['keep'], icon: '⇆', t: 'Find and replace everywhere', why: 'Rename a word across every entry — links are left alone.', steps: ['Settings → World settings → Data → Find & replace', 'Preview the matches', 'Replace'], c: 'world:replace', at: 'world', words: 'find replace rename everywhere' },
    { id: 'unlinked', p: ['keep', 'write'], icon: '@', t: 'Turn plain names into links', why: 'Finds places where you wrote an entry’s name without linking it, and links them for you.', steps: ['Ctrl+K → Link unlinked mentions', 'Review the list', 'Link them all or one by one'], c: 'world:unlinked', at: 'world', words: 'unlinked mentions auto link names' },
    { id: 'trash', p: ['keep'], icon: '🗑', t: 'Get something back', why: 'Deleted entries wait in the trash; every entry keeps earlier versions too.', steps: ['World → Codex → Trash → Restore', 'On any entry: ⋯ → Versions… to roll back text', 'Undo toasts cover most actions'], c: 'codex:trash', at: 'codex', words: 'trash deleted restore undo versions history recover' },
    { id: 'merge', p: ['keep'], icon: '⤞', t: 'Merge duplicates', why: 'Fold one entry into another: fields, text, links, map pins, sales and words all move to the one you keep.', steps: ['Open the duplicate → ⋯ → Merge into…', 'Pick the entry to keep', 'A backup is made first'], go: ['codex'], at: 'codex', words: 'merge duplicate combine' },
  ];

  const hasWorld = () => !!WB.worldId;
  const commandIds = () => new Set(WB.commands.list().map(c => c.id));
  const can = r => !!(r.fn || r.go || (r.c && commandIds().has(r.c)));
  async function run(r) {
    if (!r.free && !hasWorld()) { ui.toast('Open or create a world first', '◎'); return; }
    try {
      if (r.fn) await r.fn();
      else if (r.c && commandIds().has(r.c)) await WB.commands.run(r.c);
      else if (r.go) await WB.go(r.go[0], r.go[1] || null);
      else if (r.at) await WB.go(r.at);
    } catch (e) { WB.fail(e); }
    markTried(r.id);
  }
  let store = null;
  const loadStore = async () => store || (store = await GK.store('guide', { tried: [], purpose: 'all' }));
  async function markTried(id) { const s = await loadStore(); const t = s.get().tried; if (!t.includes(id)) s.patch({ tried: t.concat([id]) }); }

  const norm = s => String(s || '').toLowerCase();
  /** recipes matching a query (title, why, words), best first */
  function match(q, n = 50) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return R.slice(0, n);
    return R.map(r => {
      const t = norm(r.t), all = t + ' ' + norm(r.why) + ' ' + norm(r.words) + ' ' + norm(r.steps.join(' '));
      if (!words.every(w => all.includes(w))) return null;
      let s = 1;
      for (const w of words) { if (t.includes(w)) s += 3; if (norm(r.words).includes(w)) s += 2; }
      if (t.startsWith(words[0])) s += 2;
      return [s, r];
    }).filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
  }
  WB.guide = { RECIPES: R, PURPOSES, match, run, open: id => WB.go('guide', id ? { recipe: id } : null) };

  WB.commands.add({ id: 'guide:open', label: 'Guide: what can I do here?', icon: '?', group: 'Help', keys: 'F1', words: 'help how to tutorial learn guide features', run: () => WB.go('guide') });

  /* ---------------- the screen ---------------- */
  GK.modules.register({
    id: 'guide',
    title: 'Guide',
    icon: '?',
    order: 950,
    subtitle: 'What do you want to do? Pick a purpose or just type — every recipe opens the right place.',
    async mount(page) {
      const params = WB.params('guide') || {};
      const s = await loadStore();
      let purpose = PURPOSES.some(p => p[0] === s.get().purpose) ? s.get().purpose : 'all', q = '';
      page.classList.add('gd-page');
      const search = h('input.gk-input.gd-search', { placeholder: 'What do you want to do?  e.g. “borders”, “family tree”, “sell my book”', spellcheck: false });
      const chips = h('div.wb-chips.gd-purposes');
      const progress = h('div.gd-progress');
      const grid = h('div.gd-grid');
      const empty = h('div.gd-empty.gk-muted', { hidden: true });
      page.append(
        h('div.gd-hero', [h('div.gd-searchrow', [h('span.gd-search-ico', { text: '⌕' }), search]), chips, progress]),
        grid, empty,
        h('div.gd-lower', [screensPanel(), keysPanel()]),
      );
      const paintChips = () => {
        GK.clear(chips);
        for (const [id, icon, label] of PURPOSES) {
          const n = id === 'all' ? R.length : R.filter(r => r.p.includes(id)).length;
          chips.appendChild(h('button.gd-purpose', { type: 'button', class: id === purpose && !q ? 'on' : '', onclick: () => { purpose = id; q = ''; search.value = ''; s.patch({ purpose: id }); paint(); } }, [h('span.gd-purpose-ico', { text: icon }), h('span', { text: label }), h('span.gd-count', { text: String(n) })]));
        }
      };
      const paintProgress = () => {
        const tried = new Set(s.get().tried), n = R.filter(r => tried.has(r.id)).length;
        GK.clear(progress);
        progress.append(h('div.gd-bar', [h('span', { style: { width: Math.round(n / R.length * 100) + '%' } })]), h('span.gk-small.gk-muted', { text: n ? 'You’ve tried ' + n + ' of ' + R.length + ' things here' : R.length + ' things you can do — tried ones get a ✓' }));
      };
      function card(r, tried) {
        const ok = can(r), needsWorld = !r.free && !hasWorld();
        const mod = GK.modules.get(r.at);
        return h('article.gk-panel.gd-card', { class: tried.has(r.id) ? 'tried' : '', 'data-id': r.id, tabindex: '-1' }, [
          h('div.gd-card-head', [h('span.gd-ico', { text: r.icon }), h('h3', { text: r.t }), tried.has(r.id) ? h('span.gd-tick', { text: '✓', title: 'You tried this' }) : null]),
          h('p.gd-why', { text: r.why }),
          h('ol.gd-steps', r.steps.map(x => h('li', { text: x }))),
          h('div.gd-card-foot', [
            mod ? h('button.gd-where', { type: 'button', title: 'Open ' + mod.title, onclick: () => { if (needsWorld) return ui.toast('Open or create a world first', '◎'); WB.go(mod.id); markTried(r.id); } }, [h('span', { text: mod.icon }), h('span', { text: mod.title })]) : null,
            h('span.gk-grow'),
            ok ? ui.button({ label: needsWorld ? 'Needs a world' : 'Do it', kind: needsWorld ? 'ghost' : 'primary', small: true, disabled: needsWorld, onClick: () => run(r) }) : null,
          ]),
        ]);
      }
      function paint() {
        paintChips(); paintProgress();
        const list = q ? match(q) : R.filter(r => purpose === 'all' || r.p.includes(purpose));
        const tried = new Set(s.get().tried);
        GK.clear(grid);
        list.forEach(r => grid.appendChild(card(r, tried)));
        empty.hidden = !!list.length;
        if (!list.length) empty.replaceChildren(h('span', { text: 'Nothing matches “' + q + '”. Try fewer words — or ' }), h('button.cx-addlink', { type: 'button', text: 'search your world for it', onclick: () => WB.palette(q) }), h('span', { text: '.' }));
      }
      search.addEventListener('input', WB.debounce(() => { q = search.value.trim(); paint(); }, 90));
      search.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const first = (q ? match(q) : []).find(can); if (first) { e.preventDefault(); run(first); } }
        else if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; q = ''; paint(); }
      });
      paint();
      const offTried = s.on ? s.on(() => { paintProgress(); }) : null;
      if (params.recipe) {
        const r = R.find(x => x.id === params.recipe);
        if (r && !r.p.includes(purpose) && purpose !== 'all') { purpose = 'all'; paint(); }
        const el = grid.querySelector('[data-id="' + params.recipe + '"]');
        if (el) setTimeout(() => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); el.focus({ preventScroll: true }); }, 80);
      } else setTimeout(() => search.focus({ preventScroll: true }), 40);
      return () => { if (typeof offTried === 'function') offTried(); };
    },
  });

  function screensPanel() {
    const groups = GK.shell.groups().filter(g => g.members.some(m => m.id !== 'guide')), main = groups.filter(g => !g.foot);
    return ui.panel({ title: 'Every screen', icon: '☰', cls: 'gd-screens', body: h('div.gd-screen-list', groups.map(g => {
      const ms = g.members.filter(m => m.id !== 'guide'), i = main.indexOf(g);
      return h('button.gd-screen', { type: 'button', onclick: () => WB.go(ms[0].id) }, [
        h('span.gd-screen-ico', { text: g.icon }),
        h('span.gd-screen-text', [h('b', { text: g.title }), h('span.gk-small.gk-muted', { text: ms.length > 1 ? ms.map(m => m.label).join(' · ') : (ms[0].mod.subtitle || '') })]),
        i >= 0 && i < 9 ? WB.ui.kbd('Ctrl+' + (i + 1)) : null,
      ]);
    })) });
  }
  function keysPanel() {
    return ui.panel({ title: 'Keyboard shortcuts', icon: '⌨', cls: 'gd-keys', body: h('div.wb-shortcuts', (WB.SHORTCUTS || []).map(([k, d]) => h('div.wb-kv-row', [WB.ui.kbd(k), h('span', { text: d })]))) });
  }

  /* ---------------- smoke ---------------- */
  const res = {};
  WB.smoke('guide', async () => {
    await WB.go('guide');
    await WB.wait(300);
    const cards = document.querySelectorAll('.gd-card').length;
    const search = document.querySelector('.gd-search');
    search.value = 'border'; search.dispatchEvent(new Event('input'));
    await WB.wait(250);
    const first = document.querySelector('.gd-card h3');
    const missing = R.filter(r => r.c && !commandIds().has(r.c)).map(r => r.c);
    Object.assign(res, { cards, borderFirst: first && first.textContent, missing });
    search.value = ''; search.dispatchEvent(new Event('input'));
    await WB.wait(150);
    return res;
  });
  WB.check('guide: recipes show, search finds borders, every command a recipe names exists', () => res.cards >= 20 && /border/i.test(res.borderFirst || '') && !(res.missing || []).length);
})();
