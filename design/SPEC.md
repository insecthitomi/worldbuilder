# Worldbuilder — product & architecture spec

Worldbuilder is an offline desktop studio for building fictional worlds and telling stories in them. Everything lives on
the user's machine in one SQLite database; nothing needs an account or a network.

This document is the design. It is written before the code and every screen follows it. Sections:
1. Principles · 2. Object model · 3. Time · 4. Space · 5. Knowledge & audience · 6. Screens · 7. Cross-cutting UX ·
8. Data schema · 9. Architecture & contracts · 10. Example world · 11. Testing · 12. Ownership map.

---

## 1. Principles

1. **One object model.** Characters, places, stories, scenes, maps, boards, languages, random tables, sessions,
   products and posts are all *entries*. Search, links, tags, history, trash, templates, audience, export and the
   continuity checks therefore work the same on all of them.
2. **Lenses, not silos.** A screen is a lens over entries: the Atlas edits map entries and their pins, the Chronicle
   lays out dated entries, the Web draws links, Write edits story entries. The Codex is the home of every entry;
   lenses never own data the Codex cannot show.
3. **Links are bidirectional and live.** Mentions in text, reference fields and explicit relations are one `links`
   table. Every entry shows its backlinks. Mentions store the target id, so renaming never breaks text.
4. **Time and space are first-class.** Every world has its own calendar; any entry can have a start and an end. Any
   entry can be placed on any map. Ages, "who was alive when", travel times and continuity come from this.
5. **One knowledge model.** Audience (Private / Shared / Public), a reveal date and inline secrets decide what anyone
   other than the author sees — in Share view, in exports and on the published site. The same rule everywhere.
6. **Autosave, history, safety.** No save buttons. Every entry keeps revisions; deletes go to the trash with Undo;
   structural operations (merge, import over, delete a type or world, restore a backup) take a database backup first.
7. **Keyboard first, mouse friendly.** Ctrl+K reaches everything; every list has keyboard navigation; every chip
   has the same right-click menu.
8. **Deterministic helpers instead of cloud AI.** Name and word generators, mention suggestions, random tables,
   gap prompts and continuity checks run locally and explain themselves.

## 2. Object model

### 2.1 Entry
| Field | Meaning |
| --- | --- |
| `id` | 10-char random id |
| `worldId`, `typeId` | owning world, entry type |
| `parentId`, `position` | universal hierarchy (place in place, chapter in story, scene in chapter, faction in faction); `position` orders siblings (REAL, fractional inserts) |
| `title`, `aliases[]` | aliases also match mentions and search |
| `summary` | one or two lines; shown in chips' hover cards, lists, peeks, the site |
| `body` | rich text (HTML subset, §2.5) |
| `fields{}` | values of the type's template fields, keyed by field key |
| `data{}` | lens-specific structure not shown as fields (map image & scale, board viewport, phonology, table rows, encounter combatants) |
| `tags[]` | tag ids |
| `icon`, `color`, `coverId` | optional overrides; cover is a media id |
| `start`, `end` | world dates `{day, min, prec}` or null (§3) |
| `audience`, `revealDay` | knowledge model (§5) |
| `favorite`, `inbox` | flags: starred; still waiting in the Inbox |
| `wordCount` | words in the body, kept current on save |
| `createdAt`, `updatedAt`, `deletedAt` | ISO times; `deletedAt` = in the trash |

`EntryLite` (lists, lenses) = every field except `body`, `data` and `fields`, plus `childCount`.

### 2.2 Types (templates)
A type is a template the user can edit: `{ id, key, name, plural, icon, color, fields[], dated, lifespan, hierarchical,
childTypes[], lens, pinnable, defaultAudience, builtin, sort }`.
- `dated`: `null` or `{ start: 'Born', end: 'Died' }` — labels for start/end; undated types hide the date row.
- `lifespan`: start/end mean birth/death → ages appear, continuity checks apply.
- `hierarchical`: may nest in itself; `childTypes` = type keys suggested for "Add child".
- `lens`: `story | map | board | language | table | encounter | null` — opens the lens from the entry page.
- Built-in types can be renamed and get new fields; their `key` and `lens` never change. Custom types are free.

**Field definition** `{ key, label, kind, options[], refTypes[], unit, secret, required, hint, group, wide }`.
Kinds: `text longtext number ref refs choice multi bool url image color rating progress stats list dice realdate`.
- `ref/refs` store entry ids and create `field` links (key = field key). `refTypes` limits the picker.
- `stats` = ordered `[{label, value}]` (ability scores, HP, AC); keys `hp`, `ac`, `init` are read by the
  initiative tracker. `dice` = a formula with a roll button. `realdate` = an ISO calendar date (posts, sessions).
- `secret: true` hides the field outside the author view; `required` feeds completeness and the checks.
- Field keys are stable: renaming a label never moves data; deleting a field keeps old values until the entry is
  next edited (shown greyed as "from a removed field").

Built-in type set (every new world gets it; starters rename/hide some):
Character, Place, Faction, Species, Item, Event, Lore, Culture, Language, Story, Chapter, Scene, Plot thread, Map,
Board, Random table, Encounter, Session, Note, Post, Product. Exact fields live in `src/shared/fields.js`.

### 2.3 Links
`{ id, src, dst, kind, key, relId, label, note, start, end }`, kinds:
- `mention` — from the body; recomputed on every body save.
- `field` — from `ref/refs` fields; `key` = field key; recomputed on fields save.
- `relation` — explicit, with a relation type (`relId`), an optional note and optional time bounds (marriages,
  memberships, reigns). Viewed from `dst`, the inverse name is shown.

Relation types `{ id, name, inverse, category, familyRole, symmetric, color, builtin }`, categories
`family social political spatial other`; `familyRole` ∈ `parent spouse sibling` drives family trees. Seeded: parent of /
child of, spouse of, sibling of, friend of, rival of, enemy of, lover of, mentor of / student of, serves / served by,
member of / has member, leader of / led by, ally of, at war with, vassal of / liege of, founded / founded by,
lives in / home of, rules / ruled by, born in / birthplace of, owns / owned by, created / created by,
worships / worshipped by, related to.

Hierarchy (`parentId`) and map placement are not stored as links but every lens may show them as links.

### 2.4 Other records
Tags (`{id, name, color}`), collections (saved searches), revisions, media, map items, board items/connectors,
lexicon words, tasks, writing log, sales, supporters, tiers, coupons, reviews, ignored check issues, backups (files).

### 2.5 Rich text
Stored as a sanitized HTML subset: `p h2 h3 h4 ul ol li blockquote strong em u s code pre br hr a img span aside`.
- Mention: `<a class="wb-m" data-id="ID">label</a>` — label re-rendered from the current title; a mention whose
  target is gone renders struck through (and is a check issue).
- Secret: `<span class="wb-s">…</span>` inline, or `<p class="wb-s">` for a paragraph.
- Callout: `<aside class="wb-note">…</aside>`.
- Image: `<img data-media="ID" alt="">` (src filled at render time).
- External link: `<a href="https://…">` only http/https/mailto.
`src/shared/richtext.js` sanitizes (both processes), extracts plain text, word counts and mention ids.

## 3. Time

### 3.1 Calendar
Each world has `calendar`:
```
{ name, months:[{name, days}], weekdays:[…], weekdayOffset,
  leap: { every, month, days, skipEvery, keepEvery } | null,
  eras: [{ name, abbr, start }],  before: { name, abbr } | null,
  hoursPerDay, minutesPerHour, moons: [{ name, cycle, offset }], seasons: [{ name, month, day }] }
```
- **Absolute day**: integer; day 0 = first day of absolute year 1; negative before. Years are integers (no year 0
  skipping in storage).
- **Display year**: the era with the greatest `start ≤ year` shows `year − start + 1` + its abbr; years before the
  first era count back with `before` (e.g. "300 BF").
- Leap: a year is leap when `year % every == 0`, except `% skipEvery == 0` unless `% keepEvery == 0`. Leap adds
  `days` to month index `month`.
- Weekday = `(day + weekdayOffset) mod weekdays.length`. Moon phase = `((day − offset) mod cycle) / cycle`.
- **Date value** `{ day, min, prec }`, `prec` ∈ `year month day time`; `min` = minutes into the day (time precision).
- `src/shared/calendar.js`: `create(cal)` → `{ ymd(day), fromYmd(y,m,d), yearLength(y), isLeap(y), monthLength(y,m),
  weekday(day), moons(day), season(day), format(date, style), formatRange(a, b), parse(text), age(birth, at),
  add(date, {years, months, days}), yearOf(day), displayYear(y), compare(a,b) }`.

### 3.2 World time
- `world.now` = the world's current date (campaign "today"); ages, Share view reveals and the timeline's now line use it.
  Chronicle → *Advance time* moves it (optionally logging a note entry).
- Real dates (tasks, posts, business, session played-on) are ISO `YYYY-MM-DD` strings, never world dates.

## 4. Space
- A map is a `Map` entry. `data`: `{ image: mediaId | null, width, height, unit: 'miles', unitsPerPx, grid, layers:
  [{ id, name, visible }], travel: [{ mode, perDay }] }`; without an image it is a blank parchment of `width × height`.
- Map items `{ id, mapId, kind: pin | region | path | label, entryId, label, x, y, points[[x,y]], style{color, icon,
  size, dashed, fill}, layer, subMapId, start, end }`; coordinates are image pixels.
- A pin may open a sub-map (region → city) — breadcrumbs walk back up.
- Items may be dated: the map's time slider shows only items alive at the chosen world date (borders that move).
- Measure tool (polyline, units from `unitsPerPx`), calibrate tool (draw a known distance), travel time by mode.
- Every entry page lists the maps it appears on with a mini-map.

## 5. Knowledge & audience
- `audience`: **Private** (only the author), **Shared** (players/readers in Share view and shared exports),
  **Public** (also on the published site). New entries take the type's `defaultAudience`, else the world's.
- `revealDay`: Shared/Public entries stay hidden until the world date reaches it (as-of date for exports).
- Inline secrets (`.wb-s`) and `secret` fields are visible only to the author.
- **Share view** (title-bar toggle, `html.wb-share`): the app shows exactly what a Shared audience sees as of
  `world.now`; hidden entries vanish from lists, lenses and search; secrets disappear from text; editing is off.
- Exports and the site take an audience level and an as-of date and apply the same rule (`WB.visibleTo` in the
  renderer, `knowledge.visible()` in main — one implementation in `src/shared/knowledge.js`).
- A mention of an entry the reader may not see renders as plain text (never a dead link, never the hidden title if
  the mention label equals it? → label text is kept, link removed).

## 6. Screens (navigation order)
Ctrl+1…9 reach the first nine.

1. **Home** — world dashboard: cover & summary, counts by type, recently edited, favorites, world now (date, moon,
   season, "on this day" entries), tasks due, writing streak & words today vs goal, world health score with the top
   issues, gap prompts ("Brannoc has no goals — what does he want?"), quick actions.
2. **Codex** — every entry. Left: sources (All, Favorites, Inbox, Recent, by type with counts, Tags, Collections,
   Trash) and a tree/list with filters & sort; right: the entry page. Entry page: header (icon, title, aliases,
   type, audience, reveal, favorite, menu), dates row (with age), summary, fields by group, body editor, children,
   relations (add/edit with type & dates), backlinks grouped by kind, maps & boards it appears on, tasks, revisions,
   media gallery. Toolbar: open lens, peek, duplicate, convert type, move, merge, export, delete.
3. **Write** — manuscripts: story tree (story → chapters → scenes, drag to reorder), editor for a scene, a whole
   chapter ("scrivenings") or a story; story bible side panel (entries mentioned + scene fields: POV, location,
   characters, date, goal/conflict/outcome, status); targets (scene, story, daily), session counter, focus mode with
   typewriter scrolling; outline mode (index cards with summaries, drag to reorder); compile to Markdown / HTML / PDF.
4. **Atlas** — maps: map list & sub-map breadcrumbs, pan/zoom canvas, tools (select, pin, region, path, label,
   measure, calibrate), layers, item inspector (link to entry, style, dates, sub-map), time slider, search pins,
   travel calculator, "place entry" from a picker, drag entries from the side list onto the map.
5. **Chronicle** — Timeline (zoomable axis from millennia to hours, lanes by type/tag/parent, spans & points,
   lifespans toggle, era bands, now line, drag to re-date, double-click to create), Calendar (month grid of the
   world calendar with moons & seasons), Chronology (grouped list), Ages (who lives at a date, their ages),
   Advance time.
6. **Web** — Graph (force layout, filter by type/link kind/category/tag, ego focus with depth, path finder between
   two entries, pinned positions), Family tree (ancestors & descendants from family roles, add relative buttons),
   Relations table (every relation, sortable, editable).
7. **Boards** — infinite canvases: note, entry, image and checklist cards, frames, labelled connectors, pan/zoom,
   multi-select, snap to grid, colour, convert note → entry.
8. **Lexicon** — languages: lexicon table (word, pronunciation, part of speech, gloss, definition, etymology, tags),
   phonology (inventory, syllable patterns, weights, banned clusters), word generator, name generator (from a
   culture's sample names by Markov chain or from phonology), translator (gloss search both ways), collision check
   against entry titles.
9. **Toolkit** — dice (notation, history, saved rolls), random tables (weighted rows, nested `[[Table]]`, inline
   `{1d6}`, roll & create entry), initiative tracker (combatants from entries' stats, HP, conditions with durations,
   rounds), session runner (start/end a Session entry, timestamped log, NPCs met), quick generators.
10. **Inbox** — quick capture triage (convert to type, attach to entry, make task, file, delete), voice memos
    (record, play, keep with the note, manual transcript), tasks (overdue/today/upcoming/someday/done, linked entries).
11. **Library** — media grid (images, audio, files), filters, tags, preview, rename, replace, used-by, unused,
    drag-and-drop import, set as cover.
12. **Publish** — site builder (title, theme, accent, audience Public, as-of date, sections), live preview, build to
    a folder (wiki pages, maps with pins, chronology, devlog + RSS, shop, search index), posts list (devlog
    scheduling by real date), exports (world package `.wbworld`, Markdown vault, CSV per type, PDF world bible),
    imports (world package, Markdown/Obsidian vault with `[[links]]` and front matter, CSV into a type).
13. **Business** — creator ledger: overview (revenue by month, net after fees, by product, by channel, recurring
    supporters, goal), products (Product entries + their sales), sales ledger (add, edit, refunds, CSV import with
    column mapping, export), supporters & tiers, coupons, reviews (featured ones appear on the site's shop).
14. **Checks** — continuity & health: broken mentions, lifespan conflicts, parent/child ages, events outside a
    place's existence, a character in two places at once, inverted dates, ancestry loops, duplicate titles (with
    **Merge**), stubs & missing required fields, orphans, map pins to deleted entries, unused or missing media,
    public entries mentioning private ones. Each issue: explanation, Open, quick fix, "Mark as intended".
- Foot: **World** (world info, calendar editor with live preview, types & fields editor, relation types, tags,
  worlds lobby, backups, data tools) and the kit's **Appearance**.

## 7. Cross-cutting UX
- **Title bar**: world switcher, ‹ › history, ⌕ Search (Ctrl+K), ＋ Capture (Ctrl+Shift+N), Share view toggle,
  the kit's Glass/Solid switch.
- **Command palette** (Ctrl+K): entries (full-text with snippets; `t:type`, `#tag` filters), commands (go to, new
  <type>, capture, roll `r 2d6`, switch world, share view, backup, export), recents; Enter opens, Ctrl+Enter peeks,
  "Create '<query>' as …" at the end.
- **Peek**: a drawer showing any entry (summary, fields, body, backlinks) without leaving the screen; used by every
  lens and by Ctrl+Enter.
- **Entry chip** everywhere: type colour, icon, title; hover card after 400 ms; click opens, Ctrl+click peeks,
  right-click = the shared entry menu (Open, Peek, Favorite, Tags…, Audience, Move…, Duplicate, Convert…, Copy link,
  Delete).
- **Create** flows share one dialog: type, title (🎲 name suggestion for characters/places/cultures/species from the
  linked culture or language), parent; from mentions (`@` / `[[`) "Create <type> 'X'" makes the entry inline.
- **History**: Alt+←/→ and mouse back/forward move through screens and entries.
- **Shortcuts**: Ctrl+K palette, Ctrl+N new entry, Ctrl+Shift+N capture, Ctrl+F filter current list, Ctrl+Shift+F
  focus mode (Write), Ctrl+E edit summary, Ctrl+Enter peek, Delete → trash (with Undo), F2 rename.
- **Empty states** always say what the screen is for and offer the first action.
- **Toasts with Undo** for delete, move, archive, triage.
- **Settings**: a "Worldbuilder" category in Appearance (studio) for app preferences: writing font & width, spell
  check, daily word goal, revision interval, backups kept, confirm deletes, show lifespans on the timeline.

## 8. Data schema (SQLite, `userData/worldbuilder.db`)
WAL, foreign keys on. Migrations are registered per area and tracked by id in `migrations`.
```
meta(key PK, value)            migrations(id PK, at)
worlds(id PK, name, summary, icon, color, cover_id, calendar JSON, now_day, now_min, settings JSON,
       sort, archived, created_at, updated_at)
types(id PK, world_id, key, name, plural, icon, color, fields JSON, dated JSON, lifespan, hierarchical,
      child_types JSON, lens, pinnable, default_audience, builtin, sort)          UNIQUE(world_id, key)
entries(id PK, world_id, type_id, parent_id, position, title, aliases JSON, summary, body, body_text,
        fields JSON, data JSON, icon, color, cover_id, start_day, start_min, start_prec, end_day, end_min,
        end_prec, audience, reveal_day, favorite, inbox, word_count, created_at, updated_at, deleted_at)
entries_fts(fts5: entry_id UNINDEXED, world_id UNINDEXED, title, aliases, summary, body, fields)
tags(id PK, world_id, name, color)       entry_tags(entry_id, tag_id, PK both)
links(id PK, world_id, src, dst, kind, key, rel_id, label, note, start_day, end_day, created_at)
rel_types(id PK, world_id, name, inverse, category, family_role, symmetric, color, builtin, sort)
collections(id PK, world_id, name, icon, query JSON, sort)
revisions(id PK, entry_id, world_id, title, summary, body, fields JSON, reason, created_at)
media(id PK, world_id, kind, name, file, mime, size, width, height, duration, tags JSON, created_at, deleted_at)
tasks(id PK, world_id, entry_id, title, notes, due, done, done_at, priority, position, created_at)
writing_log(world_id, day, entry_id, words, seconds, PK(world_id, day, entry_id))
issues_ignored(world_id, key, at, PK both)
-- areas: map_items · board_items, board_links · words · sales, supporters, tiers, coupons, reviews
```

## 9. Architecture & contracts

### 9.1 Layout
```
main.js                       template main + wb bootstrap (handlers, media permission)
src/main/index.js             opens the db, runs migrations, mounts every area's handlers as H['wb:<name>']
src/main/db.js                node:sqlite wrapper (all, get, run, tx, json helpers, migrate)
src/main/util.js              uid, now, iso helpers, file helpers, row mappers
src/main/areas/<area>.js      { migrations: [{id, sql}], handlers(ctx) → { 'area.action': fn }, sample?(ctx, S) }
src/shared/*.js               UMD (window.WBx and module.exports): calendar, richtext, dice, fields, knowledge
src/app/wb/*.js|css           renderer core: core (WB), components, editor, palette (+ peek, capture)
src/app/modules/<id>.js|css   one screen each
test/unit/*.test.js           node:sqlite unit tests (run by test/unit.js with system Node ≥ 22.5)
```

### 9.2 Main-process contract
- Area file exports `{ migrations, handlers(ctx), sample(ctx, S) }`. `index.js` loads every file in `src/main/areas`.
- `ctx = { db, send(event, payload), changed(tables, ids), paths: { data, media(worldId), backups }, app,
  dialog, shell, win(), fileUrl(p), uid(), now() }`.
- Handler names are `area.action` (e.g. `entries.get`); registered as `H['wb:entries.get']`. Return plain objects
  with camelCase keys and parsed JSON. Throw `Error` with a sentence the user can read.
- Any mutation calls `ctx.changed(['entries', …], ids)` → renderer event `wb:changed {tables, ids}`.
- `sample(ctx, S)` adds an area's part of the example world; `S` = `{ worldId, e(key) → entry id, media(key) → id,
  type(key) → type id }` after core sample entries exist.

### 9.3 Renderer contract (`window.WB`, src/app/wb/core.js)
- `WB.api(name, ...args)` → Promise (calls `wb:name`).
- State: `WB.world`, `WB.worldId`, `WB.types` (Map id→type), `WB.type(idOrKey)`, `WB.typeList()`, `WB.relTypes`,
  `WB.cal` (calendar for the world), `WB.share` (bool), `WB.now` (date value).
- Events (`WB.on(name, fn)` → unsubscribe): `world` (switched or edited), `changed` ({tables, ids}), `share`.
- Navigation: `WB.open(id)`, `WB.peek(id)`, `WB.go(moduleId, params)`, `WB.params(moduleId)` (one-shot),
  `WB.back()`, `WB.forward()`.
- Creation & pickers: `WB.create({type, parentId, title, fields, open})`, `WB.pickEntry({types, multi, title,
  exclude})`, `WB.pickMedia({kind})`, `WB.pickDate({value, prec})`.
- Formatting: `WB.fmt.date(dateValue)`, `.range(a, b)`, `.real(iso)`, `.rel(iso)`, `.num(n)`, `.money(cents,
  currency)`, `.words(n)`.
- Knowledge: `WB.visible(entryLite)` (Share view rule), `WB.strip(html)` (secrets out).
- `WB.ui`: `chip(entryLite)`, `row(entryLite, opts)`, `typeBadge(type)`, `tags(ids)`, `menu(items, anchorOrEvent)`,
  `entryMenu(entry, ev)`, `empty({icon, title, text, actions})`, `field(def, value, onChange)` (editor for any kind),
  `fieldView(def, value)`, `dateInput({value, onChange})`, `tagEditor(ids, onChange)`, `audience(value, onChange)`,
  `search({placeholder, onInput})`, `toolbar(items)`, `badge(text, tone)`, `kbd(keys)`, `thumb(mediaId)`,
  `split({side, main, inspector})`, `hoverCard`.
- `WB.editor.create({ value, onChange, placeholder, mentions: true, minimal })` → `{ el, get(), set(html), focus(),
  insert(html), words(), destroy() }`.
- Smoke: `WB.smoke(name, fn)` / `WB.check(name, fn)` queue steps; boot seeds the example world first, then runs them.
- Module code never touches `localStorage`; view state goes in `ctx.store`, data through `WB.api`.

### 9.4 Styling
- Kit tokens only (`var(--text)`, `--muted`, `--line`, `--accent`, `--gap`, `--pad`, `--radius` …). Data colours
  (type and tag colours, chart series) are the only hard-coded colours.
- Columns and breakpoints in `em`; text never `overflow: hidden` (use `overflow: clip` + the kit's clip margin, or
  `.gk-ellipsis`).
- Popovers, menus, peek, palette are body-level overlays carrying `.gk-dialog`.
- Canvas-like areas (timeline, graph, board) use `material: 'solid'` panels; the map uses `material: 'clear'`.

## 10. Example world — "The Saltmarch"
An original sample world seeded on first run (and from World → New → Example): a storm-wracked coast of salt-flats
and drowned towers, two moons, a custom calendar (10 months, 6-day weeks, eras "Before the Flood" / "Age of Tides"),
~60 interlinked entries (houses, a smugglers' guild, a drowned god, a tide-witch, a heir with a secret), a family of
three generations, a region map with a city sub-map, a novella with chapters & scenes, a Saltmarch tongue with a
lexicon, random tables, an encounter, two sessions, devlog posts, products with sales & supporters, tasks, inbox
captures, a plot board, and two deliberate continuity mistakes so Checks has something to show.

## 11. Testing
- `npm test` = check → lint:ui → unit (system Node, in-memory db) → smoke (Electron, throwaway data, example world,
  every screen, screenshots in `test/shots`).
- Unit: calendar round-trips & leap/era maths; dice; richtext sanitize/mentions; repo CRUD, links, inverse
  relations, search, revisions, trash/restore, merge; checks find the seeded mistakes; export → import round-trip;
  site build writes the expected files.
- Smoke: each screen mounts without the failure panel or console errors; key interactions (create, link, place pin,
  roll, record nothing without a mic) behave.

## 13. Depth — every kind of worldbuilder
Owner's brief: worlds as big as planets, country lines, history records, creating towns, everything, and still
effortless to use. Each lens therefore goes past the original in these directions.

### 13.1 Planets & cartography (Atlas)
- **Planet maps**: a map with `data.projection = 'equirectangular'` and `data.planet = { radiusKm }` is a planet.
  It gets a **globe view** (drag to spin, wheel to zoom, the image wrapped on a sphere, lat/long graticule, pins and
  borders on the sphere) next to the flat view; distances become great-circle distances and areas spherical.
- **Terrain generator**: no image needed. Seeded noise heightmap → land and sea, mountains, hills, rivers running
  downhill, biomes from latitude, height and moisture, shaded relief, optional coast glow; modes Planet, Continent,
  Archipelago, Island, Region; knobs seed, sea level, roughness, land amount, temperature, moisture, map size. The
  result is rendered to an image, saved in the Library and opened as a map (re-roll keeps the settings).
- **Political layer — country lines**: regions linked to a nation (Faction or Place) draw its territory in its colour
  with its name at the centre; regions carry start/end dates so borders move through history; a **time slider**
  with play shows the map at any world date; **border history** for a point ("who held this valley in 1203?") and
  area per nation.
- **Routes & travel**: paths with a travel mode give travel time; roads, rivers and sea lanes styled differently.
- **Icon library** for pins (capital, city, town, village, port, castle, ruin, temple, tower, cave, mine, camp,
  battle, monster, treasure, mountain, forest, bridge, gate, ship, star), **legend** generated from what is used,
  hex or square **grid** overlay, **layers** (political, physical, settlements, routes, notes, custom).
- **Found a settlement here**: a click opens the town generator (13.2) and pins the result.
- Export a map with its pins and borders as an image.

### 13.2 Settlements & generators (Toolkit)
- **Town generator**: name (from the chosen culture), size (thorp → metropolis), culture, terrain (coast, river,
  hills, mountains, forest, plains, desert, tundra, swamp, island), wealth, government, founding date. Produces
  population, districts, economy and exports from the terrain, defences, notable locations (inns, temples, market,
  smithy, guildhall, keep, docks…) each with a name and an owner, residents (name, occupation, trait, want, secret),
  problems and rumours, festivals and laws. Every section re-rolls separately; **Create** makes the Place entry (fields
  filled), child Places for the locations, Characters for the residents (home = the town, `lives in` relations), an
  optional procedural **town map** (walls, roads, river, blocks, districts) as a sub-map, and the pin on the map.
- More generators, all re-rollable with "Create entry": NPC, tavern, shop & inventory, quest hook, rumour, weather
  (season from the world calendar + climate), treasure, dungeon room, ship, deity, religion, faction, artifact,
  landmark, plot twist, names. A shared `WB.gen` registry so any screen can offer them.
- **Converters**: world currencies (World settings) and custom units.

### 13.3 History records (Chronicle)
- **Annals**: for any entry (nation, house, city, person) an automatic history — its dated events, relations with
  dates (reigns, memberships, marriages), children founded and fallen, border changes, scenes set there — merged into
  one chronological record, printable and exportable.
- **Succession**: rulers of a place or faction over time from dated `rules` / `leader of` relations, with reign
  lengths and gaps.
- **Eras & periods** as bands on the timeline; **Ages** at any date; **On this day**; **Advance time** with a log.

### 13.4 Elsewhere
- Family trees with several marriages and a **kinship calculator** ("second cousin once removed").
- Languages with **sound changes** (ordered rules turning a proto-language into daughters), word & name generation,
  phrase translation by gloss.
- **Player wiki** exports with an as-of date; printable **handouts**; JSON exports with a schema for game engines.
- **Presets**: ready-made entry templates (Tavern, Noble house, Port city, Dragon, Artifact of power …) in the create
  dialog.
- **Start wizard** on first run: purpose (novel, campaign, video game, setting bible, just exploring) → starter,
  optional example world, and a guided checklist on Home.

## 12. Ownership map (build phases)
Core (renderer core, shared libs, db, core/media/tasks/backup/sample areas, Home, Codex, World, palette, peek,
editor, boot) is built first; lenses are then built in parallel, each owning only its files:
| Area | Files |
| --- | --- |
| Write | `modules/write.*`, `areas/write.js` (writing log helpers, compile) |
| Atlas | `modules/atlas.*`, `areas/atlas.js` (map_items) |
| Chronicle | `modules/chronicle.*` |
| Web | `modules/web.*` |
| Boards | `modules/boards.*`, `areas/boards.js` |
| Lexicon | `modules/lexicon.*`, `areas/lexicon.js` |
| Toolkit | `modules/toolkit.*` |
| Inbox & Library | `modules/inbox.*`, `modules/library.*` |
| Publish | `modules/publish.*`, `areas/publish.js` |
| Business | `modules/business.*`, `areas/business.js` |
| Checks | `modules/checks.*`, `areas/checks.js` |
Each area adds `test/unit/<area>.test.js` and queues its smoke steps with `WB.smoke`.
