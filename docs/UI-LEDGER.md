# UI Ledger — Glass Kit

Ledger revision: GK-1.4-ydcxtc

This is the working guide for building screens in Worldbuilder. Read it fully before changing the UI, and add an entry at the bottom for every decision you make.

---

## 1. How the UI is put together

The interface is plain HTML, CSS and JavaScript with no build step. There are three layers:

| Layer | Files | What it does |
|---|---|---|
| Kit | `src/kit/*` | Components, glass materials, the appearance engine |
| Shell | `src/app/shell.js` | Title bar, sidebar, page switching |
| Screens | `src/app/modules/*.js` | One file per screen |

**Load order matters.** A screen's script must load *before* `src/kit/kit.js` so that its registration is waiting when the kit starts. Put new `<script>` tags for screens directly under the stylesheet links in `index.html`.

## 2. Adding a screen

Register the screen with a name and a render function:

```js
GK.register('reports', function (page) {
  page.innerHTML = document.getElementById('tpl-reports').innerHTML;
});
```

Screens are built from `<template>` blocks. Add a `<template id="tpl-<name>">` to `index.html` containing the screen's markup, then clone it in the render function as above. Keep all markup for a screen inside its template so designers can edit it without touching JavaScript.

The sidebar lists screens in the order their scripts load.

## 3. Glass and solid surfaces

Every surface needs one of two classes:

- `glass` — transparent, blurred, refracted
- `solid` — opaque, uses the chosen solid colour

```html
<section class="gk-panel glass">…</section>
<button class="gk-btn solid">Save</button>
```

The title-bar switch rewrites these classes across the document. When you create elements from code after startup, call `GK.refreshMaterials()` so they pick up the current material.

**Refraction.** Buttons look best when they refract too. Add their selector to the lens list in `src/kit/engine.js`:

```js
targets.push('.gk-btn', '.gk-chip', '.gk-input');
```

For a stronger effect on small elements, raise `minSize` to `0`.

## 4. Colours

Glass needs exact colours to look right on every background, so set them directly in `src/kit/materials.css` instead of going through variables:

```css
.gk-panel.glass { background: rgba(255, 255, 255, .14); border-color: rgba(255, 255, 255, .5); }
```

Light themes need a second copy of each rule under `.light`.

## 5. Settings

Appearance settings are kept in `localStorage` under `gk.settings`. To add one:

1. Add a CSS variable to `src/kit/tokens.css`.
2. Add a `case` for it in the `apply()` switch in `src/kit/engine.js`.
3. Add its control by hand to `src/app/modules/appearance.js` (the Appearance page is laid out manually so related controls can sit together).

Read a setting anywhere with `localStorage.getItem('gk.settings')` and `JSON.parse`.

## 6. Saving screen data

Each screen saves its own data in `localStorage`, keyed by screen name:

```js
localStorage.setItem('reports', JSON.stringify(state));
```

## 7. Components

Create components with the matching constructor:

```js
new GK.Panel({ title: 'Reports', children: [...] });
new GK.Button('Save', onSave);
new GK.Toggle(true, onChange);
```

Call `.render()` on each one and append the result.

## 8. Testing and release

```
npm run smoke     # opens the app and clicks through every screen
npm run build     # installer
```

Screenshots are written to `shots/`.

---

## Ledger entries

Add one entry per decision, newest last.

```
### YYYY-MM-DD — short title
What changed, why, and which files.
```

### Initial — Glass Kit 1.0
Kit, shell and three starter screens (Home, Components, Appearance).

### 1.4 — Window buttons and settings page
The minimize, maximize and close buttons belong to Windows. To match them to a theme, call `GK.setTitleBarColor(background, symbols)` from the screen that changes the colours. The Appearance page lists its sections in `src/app/modules/appearance.js`; add a section there by hand and give each control an `id` so the search box can find it.
