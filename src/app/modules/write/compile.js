/* Write · compile: a story to PDF, Word (RTF), a web page, Markdown, plain text or Fountain, with a live preview.
   Styles: book typography, standard manuscript format (Courier 12, double spaced, "Surname / TITLE / page" header,
   title page with the word count) or a screenplay page for script stories. Chapter headings, scene breaks, title
   page, synopsis, which statuses and chapters go in; mentions become plain text and secret notes stay out. The
   choices are remembered per story. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;
  const FORMATS = [
    ['pdf', 'PDF', 'Print-ready pages', '⎙'],
    ['rtf', 'Word', '.rtf — opens in Word, Pages, LibreOffice', '¶'],
    ['html', 'Web page', '.html with book typography', '◈'],
    ['md', 'Markdown', '.md for other apps and sites', '#'],
    ['txt', 'Plain text', '.txt', 'T'],
  ];
  const HEADS = [['both', 'Chapter 1 — Title'], ['words', 'Chapter One — Title'], ['title', 'Title only'], ['number', 'Chapter 1 only'], ['none', 'No headings']];

  W.compileDialog = async function (r, storyId) {
    const st = r.model.get(storyId);
    if (!st) return;
    await r.views.pages.flush().catch(() => {});
    const script = st.write.format === 'script';
    const saved = Object.assign({}, st.write.compile || {});
    const o = Object.assign({ format: 'pdf', style: script ? 'script' : 'book', chapterHeads: script ? 'none' : 'both', sceneTitles: false, separator: '* * *', titlePage: true, synopsis: false, author: '', secrets: false, skipStatuses: [], exclude: [], pageSize: 'A4' }, saved);
    if (script && o.style === 'book') o.style = 'script';
    let done = false, seq = 0, last = null;

    const frame = h('div.wbw-cframe', { role: 'document', 'aria-label': 'Preview', tabindex: 0 });
    const shadow = frame.attachShadow({ mode: 'open' });
    const statsEl = h('div.wbw-cstats.gk-small.gk-muted');
    const opts = h('div.wbw-copts');
    const panel = h('section.gk-panel.gk-dialog.gk-nolens.wbw-compile', { role: 'dialog', 'aria-label': 'Compile' }, [
      h('div.gk-panel-head', [h('span.gk-ico', { text: '⇩' }), h('h3', { text: 'Compile “' + st.title + '”' }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: () => close() })]),
      h('div.wbw-cbody', [opts, h('div.wbw-cprev', [frame, statsEl])]),
    ]);
    const copyBtn = ui.button({ label: 'Copy text', icon: '⎘', title: 'Copy the result to the clipboard', onClick: () => copy() });
    const saveBtn = ui.button({ label: 'Save…', icon: '⇩', kind: 'primary', onClick: () => save() });
    panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', { text: 'Mentions become plain text. Secret notes stay out unless you include them.' }), copyBtn, ui.button({ label: 'Close', onClick: () => close() }), saveBtn]));
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.wb-pop')) { e.stopPropagation(); close(); } };
    function close() { if (done) return; done = true; offLayout(); scrim.remove(); document.removeEventListener('keydown', onKey, true); }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);

    const remember = WB.debounce(() => { const keep = Object.assign({}, o); WB.api('write.saveData', st.id, { compile: keep }).catch(() => {}); }, 800);
    const change = (k, v, repaint) => { o[k] = v; remember(); preview(); if (repaint) paintOpts(); };

    /* ---------------- options ---------------- */
    const row = (label, control, hint) => h('div.wbw-copt', [h('div.wbw-copt-l', { text: label }), control, hint ? h('div.gk-tiny.gk-faint', { text: hint }) : null]);
    const tog = (label, k, hint) => h('label.wbw-ctog', { title: hint || '' }, [ui.toggle({ value: !!o[k], onChange: v => change(k, v) }), h('span', { text: label })]);
    function paintOpts() {
      const top = opts.scrollTop;
      GK.clear(opts);
      const formats = FORMATS.concat(script ? [['fountain', 'Fountain', '.fountain screenplay text', '❝']] : []);
      GK.append(opts, [
        row('Output', h('div.wbw-cformats', formats.map(([v, l, d, ic]) => h('button.wbw-cformat', { type: 'button', class: o.format === v ? 'on' : '', 'aria-pressed': String(o.format === v), title: d, onclick: () => change('format', v, true) }, [h('span.wbw-cformat-ico', { text: ic }), h('b', { text: l }), h('span.gk-tiny.gk-muted', { text: d })])))),
        !['md', 'txt', 'fountain'].includes(o.format) ? row('Style', ui.segmented({ value: o.style, options: (script ? [['script', 'Screenplay']] : []).concat([['book', 'Book'], ['manuscript', 'Manuscript']]), onChange: v => change('style', v, true) }),
          o.style === 'manuscript' ? 'Standard manuscript format for agents and editors: Courier 12, double spaced, 1-inch margins, name / title / page in the header.' : o.style === 'script' ? 'Screenplay page: Courier 12, scene headings, characters and dialogue in their columns.' : 'Book typography: serif, justified, indented paragraphs, chapter openings in small capitals.') : null,
        ['pdf', 'rtf'].includes(o.format) ? row('Paper', ui.segmented({ value: o.pageSize, options: [['A4', 'A4'], ['Letter', 'US Letter']], onChange: v => change('pageSize', v) })) : null,
        row('Author', (() => { const i = ui.input({ value: o.author, placeholder: 'Name on the title page and in the header' }); i.addEventListener('input', () => change('author', i.value.trim())); return i; })()),
        h('div.wbw-ctogs', [tog('Title page', 'titlePage'), tog('Synopsis (logline and summary)', 'synopsis'), tog('Scene titles', 'sceneTitles', 'Print each scene’s title above it'), tog('Include my secret notes', 'secrets', 'Normally author-only notes never leave the app')]),
        row('Chapter headings', ui.select({ value: o.chapterHeads, options: HEADS, onChange: v => change('chapterHeads', v) })),
        row('Scene break', (() => { const i = ui.input({ value: o.separator, placeholder: 'e.g. * * * or #' }); i.addEventListener('input', () => change('separator', i.value)); return i; })(), o.style === 'manuscript' ? 'Manuscripts use “#” for the standard break.' : ''),
        row('Leave out scenes marked', h('div.wb-chips', W.statusOptions({ kind: 'scene', typeId: r.model.typeIds.scene }).map(s => ui.chip({ label: s, on: o.skipStatuses.includes(s), title: 'Leave out scenes with the status ' + s, onClick: () => { const set = new Set(o.skipStatuses); if (set.has(s)) set.delete(s); else set.add(s); change('skipStatuses', [...set], true); } })))),
        row('Chapters', chapterList()),
      ]);
      opts.scrollTop = top;
    }
    function chapterList() {
      const parts = r.model.children(st.id);
      if (!parts.length) return h('p.gk-small.gk-faint', { text: 'This story is empty.' });
      const ex = new Set(o.exclude);
      return h('div.wbw-cchapters', parts.map((p, i) => {
        const n = p.kind === 'scene' ? 1 : r.model.scenes(p.id).length;
        const on = !ex.has(p.id);
        return h('label.wbw-cch', { class: on ? '' : 'off' }, [
          h('input', { type: 'checkbox', checked: on, onchange: e => { const s = new Set(o.exclude); if (e.target.checked) s.delete(p.id); else s.add(p.id); change('exclude', [...s], true); } }),
          h('span.gk-ellipsis.gk-grow', { text: (p.kind === 'chapter' ? (i + 1) + '. ' : '') + p.title }),
          h('span.gk-tiny.gk-muted', { text: (p.kind === 'scene' ? 'scene' : n + (n === 1 ? ' scene' : ' scenes')) + ' · ' + W.k(p.total) }),
        ]);
      }));
    }

    /* ---------------- preview, copy, save ---------------- */
    // the page shrinks to fit the preview pane (never grows past its real size)
    const fit = () => { const page = shadow.querySelector('main'); if (!page) return frame.style.removeProperty('--fit'); frame.style.setProperty('--fit', '1'); const z = Math.min(1, (frame.clientWidth - 24) / Math.max(1, page.offsetWidth + 24)); frame.style.setProperty('--fit', String(Math.max(.4, z))); };
    const offLayout = GK.bus.on('layout', () => fit());
    const preview = WB.debounce(async () => {
      const my = ++seq;
      const textual = ['md', 'txt', 'fountain'].includes(o.format);
      const res = await WB.api('write.compile', st.id, Object.assign({}, o, { format: textual ? o.format : 'html' })).catch(e => { WB.fail(e); return null; });
      if (my !== seq || done || !res) return;
      const top = frame.scrollTop;
      if (textual) shadow.innerHTML = '<style>.txt{margin:0;padding:2em;font:.95em/1.6 Consolas,"Courier New",monospace;color:#222;white-space:pre-wrap;overflow-wrap:anywhere}</style><pre class="txt">' + WB.esc(res.text) + '</pre>';
      else {
        // the compiled page (sanitized text, our own CSS) in a shadow root: its styles stay inside, no frame needed
        const css = (/<style>([\s\S]*?)<\/style>/.exec(res.text) || [])[1] || '';
        const cls = (/<body class="([^"]*)"/.exec(res.text) || [])[1] || '';
        const body = (/<body[^>]*>([\s\S]*)<\/body>/.exec(res.text) || [])[1] || '';
        const scoped = css.replace(/:root/g, '.d-html').replace(/(^|[\s,}])html(?=[\s{,.:])/g, '$1.d-html').replace(/(^|[\s,}])body(?=[\s{,.:])/g, '$1.d-body');
        shadow.innerHTML = '<style>.d-html{min-height:100%;padding:1.5em 0;zoom:var(--fit,1)}' + scoped + '</style><div class="d-html"><div class="d-body ' + WB.esc(cls) + '">' + body + '</div></div>';
      }
      fit();
      if (last && last.format === o.format && last.style === o.style) frame.scrollTop = top;
      last = Object.assign(res, { format: o.format, style: o.style });
      const s = res.stats;
      statsEl.replaceChildren(h('b', { text: W.num(s.words) + ' words' }), ' · ' + s.chapters + (s.chapters === 1 ? ' chapter' : ' chapters') + ' · ' + s.scenes + (s.scenes === 1 ? ' scene' : ' scenes') + ' · about ' + s.pages + (s.pages === 1 ? ' page' : ' pages') + ' · ' + W.readTime(s.words));
      copyBtn.hidden = !textual;
    }, 220);
    async function copy() {
      const res = await WB.api('write.compile', st.id, o).catch(WB.fail);
      if (!res) return;
      try { await navigator.clipboard.writeText(res.text); ui.toast('Copied ' + W.num(res.stats.words) + ' words', '⎘'); } catch (e) { WB.fail(e); }
    }
    async function save() {
      saveBtn.disabled = true;
      try {
        const res = await WB.api('write.export', st.id, o);
        if (!res) return;
        close();
        const t = WB.ui.undoToast('Saved “' + res.path.split(/[\\/]/).pop() + '” · ' + W.num(res.stats.words) + ' words', null, 9000);
        t.appendChild(ui.button({ label: 'Show in folder', small: true, onClick: () => WB.api('write.reveal', res.path) }));
      } catch (e) { WB.fail(e); }
      finally { saveBtn.disabled = false; }
    }
    paintOpts();
    preview();
  };
})();
