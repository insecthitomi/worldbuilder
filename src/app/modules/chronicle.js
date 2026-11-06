/* Chronicle: the world's history on its own calendar — timeline, calendar, chronology, annals, succession, ages, eras,
   and advancing world time. The views live in src/app/modules/chronicle/ and load on first use. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;
  const BASE = 'src/app/modules/chronicle/';
  const PARTS = ['scale.js', 'shared.js', 'timeline.js', 'calendar.js', 'lists.js', 'history.js'];
  let loading = null;
  // a part that failed to load once is asked for again with a fresh address (the script cache keeps failures)
  const part = p => WB.loadScript(BASE + p).catch(() => WB.loadScript(BASE + p + '?retry=' + Date.now()));
  const load = () => loading || (loading = (async () => { for (const p of PARTS) await part(p); })().catch(e => { loading = null; throw e; }));

  const VIEWS = [
    ['timeline', 'Timeline', '⟷', 'A zoomable line of everything dated'],
    ['calendar', 'Calendar', '▦', 'Months of the world calendar with moons and seasons'],
    ['chronology', 'Chronology', '☰', 'Everything dated, as a printable list'],
    ['annals', 'Annals', '⧉', 'The history of one entry'],
    ['succession', 'Succession', '♛', 'Who ruled a place or faction, and when'],
    ['ages', 'Ages', '⌛', 'Who is alive on a date, and how old'],
    ['eras', 'Eras', '◫', 'Calendar eras and named periods'],
  ];

  /* ---------------- the public part (other screens use these without opening the Chronicle) ---------------- */
  const CH = WB.chronicle = {
    views: {},
    VIEWS,
    load,
    /** the history of an entry as a compact panel (Codex shows it in the History section) */
    annalsPanel(entry, opts) {
      const id = typeof entry === 'string' ? entry : entry && entry.id;
      const box = h('div.ch-annals-panel', [h('div.gk-small.gk-muted.ch-loading', { text: 'Gathering history…' })]);
      if (!id) { box.replaceChildren(h('div.gk-small.gk-muted', { text: 'Nothing to show.' })); return box; }
      load().then(() => CH.renderAnnals(box, id, Object.assign({ compact: true }, opts || {})))
        .catch(e => box.replaceChildren(h('div.gk-small.gk-muted', { text: 'The history could not be loaded: ' + e.message })));
      return box;
    },
    /** entries with an anniversary on a day (same month and day, any year), as lite entries with .anniversary {which, years, date} */
    async onThisDay(day) {
      if (!WB.worldId) return [];
      const d = day == null ? WB.now.day : typeof day === 'object' ? day.day : day;
      const list = await WB.api('chronicle.onThisDay', WB.worldId, d).catch(() => []);
      return list.filter(x => x && x.entry && WB.visible(x.entry))
        .map(x => Object.assign({}, x.entry, { anniversary: { which: x.which, years: x.years, date: x.date } }));
    },
    /** an entry's history as Markdown or as a printable HTML page (for exports and the published site) */
    async annalsMarkdown(entryId) { await load(); return CH.annalsText(entryId, 'md'); },
    async annalsHtml(entryId) { await load(); return CH.annalsText(entryId, 'html'); },
    /** opens the Chronicle at a view: { view, entryId, day, fit } */
    open: params => WB.go('chronicle', params || {}),
  };

  /* ---------------- palette commands ---------------- */
  const hasWorld = () => !!WB.worldId;
  WB.commands.add({ id: 'chronicle:goto', label: 'Go to a date on the timeline…', icon: '⟷', group: 'Chronicle', when: hasWorld, words: 'chronicle time history jump date',
    run: async () => { await load(); const d = await CH.askDate({ title: 'Go to a date', ok: 'Go' }); if (d) CH.open({ view: 'timeline', day: d.day, prec: d.prec }); } });
  WB.commands.add({ id: 'chronicle:advance', label: 'Advance world time…', icon: '⏩', group: 'Chronicle', when: hasWorld, words: 'chronicle time passes now today calendar days months years',
    run: async () => { await load(); CH.advanceDialog(); } });
  WB.commands.add({ id: 'chronicle:event', label: 'New event at a date…', icon: '✷', group: 'Chronicle', when: hasWorld, words: 'chronicle timeline history happen',
    run: async () => { await load(); const d = await CH.askDate({ title: 'When did it happen?', ok: 'Next' }); if (d) CH.createAt(d, { type: 'event' }); } });
  WB.commands.add({ id: 'chronicle:annals', label: 'History of an entry (annals)…', icon: '⧉', group: 'Chronicle', when: hasWorld, words: 'chronicle annals history records timeline of',
    run: async () => { const p = await WB.ui.pickEntry({ title: 'Whose history?' }); if (p) CH.open({ view: 'annals', entryId: p.id }); } });
  WB.commands.add({ id: 'chronicle:succession', label: 'Succession of rulers…', icon: '♛', group: 'Chronicle', when: hasWorld, words: 'chronicle rulers kings queens reign lords leaders',
    run: () => CH.open({ view: 'succession' }) });
  WB.commands.add({ id: 'chronicle:today', label: 'On this day — who lives, what happened', icon: '⌛', group: 'Chronicle', when: hasWorld, words: 'chronicle ages alive anniversary',
    run: () => CH.open({ view: 'ages' }) });
  WB.commands.add({ id: 'chronicle:calendar', label: 'World calendar', icon: '▦', group: 'Chronicle', when: hasWorld, words: 'chronicle month moons seasons',
    run: () => CH.open({ view: 'calendar' }) });

  /* ---------------- the screen ---------------- */
  GK.modules.register({
    id: 'chronicle',
    title: 'Chronicle',
    icon: '⧗',
    order: 50,
    subtitle: "Timelines on your world's own calendar, annals and ages.",
    async mount(page, ctx) {
      page.classList.add('ch-page');
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '⧗', title: 'No world yet', text: 'The Chronicle lays out the history of a world on its own calendar. Create a world to begin.',
          actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      const params = WB.params('chronicle') || {};
      const loadingNote = page.appendChild(h('div.gk-muted.ch-loading', { text: 'Opening the Chronicle…' }));
      await load();
      loadingNote.remove();
      return CH.mountScreen(page, ctx, params);
    },
  });

  /* ---------------- smoke steps (run after the example world exists) ---------------- */
  const smoke = { items: 0, days: 0, records: 0 };
  WB.smoke('chronicle-timeline', async () => {
    await CH.open({ view: 'timeline', fit: true });
    await WB.wait(700);
    smoke.items = document.querySelectorAll('.ch-tl .ch-it').length;
    const ticks = document.querySelectorAll('.ch-tl .ch-tick').length;
    return smoke.items && ticks ? 'ok: ' + smoke.items + ' items, ' + ticks + ' ticks' : 'error: the timeline drew ' + smoke.items + ' items and ' + ticks + ' ticks';
  });
  WB.smoke('chronicle-calendar', async () => {
    await CH.open({ view: 'calendar', day: WB.now.day });
    await WB.wait(500);
    smoke.days = document.querySelectorAll('.ch-cal .ch-day:not(.out)').length;
    const entries = document.querySelectorAll('.ch-cal .ch-cal-it').length;
    return smoke.days ? 'ok: ' + smoke.days + ' days, ' + entries + ' entries' : 'error: the calendar drew no days';
  });
  WB.smoke('chronicle-annals', async () => {
    const e = (await WB.api('entries.find', WB.worldId, 'Gullhaven').catch(() => null)) || (await WB.api('chronicle.dated', WB.worldId))[0];
    if (!e) return 'error: no entry to show annals for';
    await CH.open({ view: 'annals', entryId: e.id });
    await WB.wait(600);
    smoke.records = document.querySelectorAll('.ch-annals .ch-rec').length;
    return smoke.records ? 'ok: ' + smoke.records + ' records for ' + e.title : 'error: no annals records for ' + e.title;
  });
  WB.check('chronicle: the timeline drew items', () => smoke.items > 0);
  WB.check('chronicle: the calendar drew a month', () => smoke.days >= 20);
  WB.check('chronicle: annals found history records', () => smoke.records > 0);
})();
