# Worldbuilder

Offline worldbuilding studio: an interlinked codex, maps, timelines on your own calendars, manuscripts, languages and campaign tools.

A Windows desktop app (Electron) with a customizable liquid-glass interface. Everything you make stays on your computer in one
database — no account, no internet needed.

## What it does

Worldbuilder is for anyone who builds a world: novelists, game masters, game designers, conlangers, mapmakers and people
who just like inventing places. Everything in a world is an **entry** (a character, place, faction, species, item, event,
piece of lore, culture, language, story, chapter, scene, plot thread, map, board, random table, encounter, session, note,
post or product — or a type you design yourself), and every screen is a different way of looking at your entries.

The sidebar has eight groups; the screens of a group are tabs at the top of its pages: **Home**, **World** (Codex, Connections, Timeline, Checks), **Maps & Sim** (Atlas, Simulate), **Create** (Write, Boards, Lexicon), **Play** (Toolkit), **Collect** (Inbox, Library), **Share** (Publish, Business) and **Settings** at the bottom (World settings, Look, Guide). Ctrl+1…8 opens a group, and it reopens the screen you used last in it.

- **Home** (Home) — your world at a glance: its own date, season and moon phases, writing progress and streak, where you left
  off, tasks, the inbox, world health, anniversaries on this day, and questions about gaps in your world.
- **Codex** (World) — every entry as a tree, list, cards or an editable table (sortable,
  grouped, your columns), filtered by type, tag or saved collection. Anything can nest in anything: drag to reparent or reorder,
  Tab / Shift+Tab to indent, Alt+Up/Down to reorder, "Move to…", select several to move, tag, retype or delete them, a clickable
  path with a sibling picker, a Contents card with quick add and counts; deleting a parent asks whether its contents go too. Each entry has fields from its
  type's template, rich text, relations (family, allies, rulers, homes…) with dates, everything that links to it, the
  maps and boards it appears on, its history, tasks and earlier versions. Rename freely: links never break.
- **Write** (Create) — manuscripts of stories, chapters and scenes (prose or screenplay), with your world one click away: an
  outline, a corkboard and a story grid of who appears where, focus mode with sprints and typewriter scrolling, word
  goals and streaks, and compile to PDF, Word (RTF), HTML, Markdown, plain text or Fountain.
- **Atlas** (Maps & Sim) — maps from your own images, a blank sheet or seeded terrain (planets, continents, two lands,
  islands, inland seas, highlands: tectonic ridges, erosion, climate bands, Whittaker biomes, rivers that run downhill,
  lakes, resource deposits, optional settlement sites and roads). The View menu switches between Political, Terrain,
  Relief, Climate (temperature or rainfall), Travel (isochrone rings by walking, horse, cart or ship from any point),
  Resources, Economy (the simulation's population, wealth, shortages and trade flows) and the Parchment and Plain styles,
  remembered per map. A toolbox edits generated and blank maps: raise, lower and smooth ground, add or drain water,
  smooth coastlines, paint or fill biomes, paint regions with a brush, rivers that follow the drainage, roads that
  follow the cheapest ground, deposits, symbol stamps, curved and path labels, an eraser, grid or hex snapping and
  multi-select with align and distribute, all undoable and stored compactly in the map. Planets spin on a globe with
  areas and distances measured on the sphere; country borders change through history with a time slider; maps nest inside
  maps; routes show travel times; pins link to entries; towns are founded with one click. The Map panel holds View,
  Layers and Settings; Atlas shortcuts are listed under ⋯ → Keyboard shortcuts.
- **Chronicle** (World, shown as Timeline) — a timeline from millennia to hours on your world's own calendar, a month calendar with moons and
  seasons, chronologies, annals (an automatic history of any nation, house, city or person), successions and ages.
- **Web** (World, shown as Connections) — how everything connects: a relationship graph with a path finder, family trees with a kinship calculator, and
  a table of every relation.
- **Boards** (Create) — infinite canvases for plotting, mind maps, investigations and mood boards.
- **Lexicon** (Create) — languages with dictionaries, an IPA phonology builder, word and name generators, sound changes that
  evolve daughter languages, a translator and scripts.
- **Simulate** (Maps & Sim) — an economy engine for any setting (fantasy, historical, sci-fi): settlements gather, make, eat and trade along your map's routes;
  prices follow supply and demand; goods travel as caravans or ships that take real travel days, can spoil and can be raided. Laws and customs are plain rules
  (embargo, tariff, toll, price cap, tithe in kind, guild monopoly, festival, rationing, sacred or forbidden goods, escorts, seasonal bans) with a scope, a season
  or a condition, written from a form with no code. Import settlements and routes from a map, auto-fill what each place makes and needs from terrain and
  population, scrub a timeline over a network drawn on the map, read price, stock, wealth and population charts, compare a run with a rule on or off, and
  record what happened (famines, raids, closed passes) as events in the Timeline. The result is saved on the map for the Atlas Economy view.
  The engine is `src/shared/sim.js` (seeded and deterministic) with its own tests.
- **Toolkit** (Play) — dice, random tables, a town generator and many more generators, an initiative tracker, a session runner
  and converters.
- **Inbox** (Collect) — quick captures and voice memos waiting to be sorted, and your tasks.
- **Library** (Collect) — the images, audio and files of a world, and where each is used.
- **Publish** (Share) — a website of your world (a public wiki or a player wiki), a devlog with RSS, and exports and imports
  (world packages, Markdown/Obsidian vaults, CSV, JSON, PDF).
- **Business** (Share) — products, sales, supporters, coupons and reviews, for people who sell what they build.
- **Checks** (World) — continuity: characters appearing after their death, children born before their parents, people in two
  places at once, broken links, duplicates (with merge), gaps and more.
- **World settings** (Settings) — the world's details, a calendar designer (months, weeks, leap years, eras, moons, seasons), the types and
  fields editor, kinds of relations, tags, all your worlds, backups and data tools.
- **People & attributes** (World settings → Structure) — make the app fit any world: define your own classifications of people (Race, Class, Caste, Order, Clan, Calling… each with colours, icons, nested values such as Race → Subrace, single or several values per entry, and the entry types it applies to), attribute systems of any size (numbers with limits, rating dots, dice, choices, text, bars like HP, and formulas such as `floor((con - 10) / 2)`), modifiers per value that show as totals on the entry (an Elf gets +2 DEX, a Noble +1 Charm), and different words per people (Ruler → Thane for Northmen, Emir for desert folk) plus a naming style for name suggestions. Starter packs (Fantasy RPG, Historical, Sci-fi, Modern, Blank) can be mixed in one click and are never forced; configurations export and import as JSON. Character and Species get *Classification* and *Attributes* fields; worlds made earlier can add them with one button, and the old Stats field keeps working.
- **Guide** (Settings, F1) — everything you can do, by purpose: maps and borders, towns, history, writing, running games,
  languages, game data, publishing and selling. Type what you want ("family tree", "sell my book") and each recipe opens
  the right place. The same recipes show up in Ctrl+K under *How to*.

### Secrets and sharing

Every entry has an **audience**: *Private* (only you), *Shared* (players and readers) or *Public* (also on your
published site). Mark a field or a passage of text as **secret** and only you see it. Give an entry a **reveal date**
and it stays hidden until your world's date reaches it. **Share view** (title bar) shows the app exactly as a shared
reader would see it — handy for screen-sharing with players. Exports and the website follow the same rules.

### Getting around

| Keys | What it does |
| --- | --- |
| Ctrl+K | Search everything, run any command, roll dice (`r 2d6`) |
| Ctrl+N | New entry (with presets such as Tavern, Noble house, Magic system) |
| Ctrl+Shift+N | Capture an idea from anywhere |
| @ or [[ while writing | Link an entry — or create it on the spot |
| / at the start of a line | Insert a heading, table, callout, secret passage… |
| Ctrl+Click on any entry | Peek at it without leaving the screen |
| Ctrl+Shift+F | Focus mode for writing |
| Alt+← / Alt+→ | Back and forward |
| Ctrl+1 … 9 | Open a sidebar group (the screen you used last in it) |
| F1 | The Guide: what you can do, by purpose |
| Shift+F1 | All shortcuts |

Right-click any entry anywhere for the same menu: open, peek, favourite, audience, tags, move, duplicate, change type,
merge, copy a link, delete. Deleting always offers Undo, and the trash keeps everything until you empty it. Duplicating
a map, board or language copies what is on it too; merging two entries moves everything that pointed at the one you
fold in — links, pins, board cards, words, sales and tasks — to the one you keep.

### Your data

Everything is stored in `%APPDATA%\Worldbuilder` (database, media, backups). A backup is made automatically once a day
and before anything risky (merging, deleting a type or a world, restoring); World → Backups restores any of them.
Worlds can be exported as a single file and imported on another computer.

Start with **Open the example world** on the welcome screen to see every tool filled in.

## Run

```
npm install
npm start
```

## Test

```
npm test
```

Runs the code checks, the unit tests (they need Node 22.5 or newer for its built-in SQLite) and the app's own smoke
test, which opens the example world, visits every screen and saves screenshots to `test/shots`.

## Build an installer

```
npm run dist
```

The installer is built from a clean staged copy that holds only the runtime files in the build allowlist (`build.files` in `package.json`), so local-only files such as `CLAUDE.md`, `*.local.md` or `.env` never reach it; the release guard checks that copy before anything is packaged. `npm run guard` runs the same check without building. The installer is written to `release/`.

## Appearance

Open **Appearance** (Ctrl+,). *Quick start* covers the common choices (look, glass, text colour, accent, size, density, outline); the categories hold everything else: the background (gradients, your own image, GIF or video; rising bubbles come with the *Living bubbles* add-on), glass (clear, tinted, milky or frosted, refraction and light), every colour including text, lines and highlights, fonts (including imported font files), the text outline and text backdrop, spacing between and inside panels, row spacing and control size, corner radius, motion and graphics quality. Search finds any setting by everyday words ("distance", "highlight"); ↺ puts a setting back and *Auto* lets a colour or size follow the others. The **◇ Glass / ■ Solid** switch in the title bar turns every panel, widget and button between transparent glass and a solid colour you choose. Looks can be saved, exported and imported. The **Worldbuilder** category holds the app's own preferences: writing font, size and column width, spell check, hover previews, typewriter scrolling and more.

Glass is rendered on the graphics card at full screen resolution with real optics: light bends through the glass edge, splits into colours, and casts caustics and shadows on what lies beneath; glass edges catch the light; selections and grouped controls behave like liquid. Glass is perfectly clear until you tint or frost it. Where the graphics path is unavailable the app switches to a lighter SVG rendering by itself. With *Follow system accessibility settings* on, reduced transparency or more contrast make every surface solid and reduced motion stops all animation.

The window is frameless: the title bar draws its own minimize, maximize/restore and close buttons, which take the current look. Drag the title bar to move the window (Windows snap works) and double-click it to maximize.

UI development notes are in [docs/UI-LEDGER.md](docs/UI-LEDGER.md).
