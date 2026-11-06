/* Publish › Devlog: Post entries as a devlog. A post is a draft, scheduled (a real publish date still ahead) or live
   (published, or its date has come); only live posts reach the website and its RSS feed. Written inline with the
   shared editor; everything autosaves. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const P = WB.pub;
  const STATE = { draft: ['Draft', 'warn'], scheduled: ['Scheduled', ''], published: ['Live', 'good'] };
  const daysTo = iso => Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(WB.today() + 'T12:00:00')) / 864e5);

  P.posts = async function (host, { store, params }) {
    const worldId = WB.worldId;
    const type = WB.type('post');
    if (!type) {
      host.appendChild(WB.ui.empty({ icon: '✦', title: 'This world has no Post type', text: 'The devlog is made of Post entries. Add the type back in World › Types to use it.' }));
      return;
    }
    let posts = [], sel = store.get().postId, filter = store.get().postFilter || 'all', alive = true, editor = null, editingId = null;
    const offs = [];
    const listBox = h('div.pub-post-list.gk-list', { role: 'listbox', 'aria-label': 'Posts' });
    const countBox = h('span.gk-small.gk-muted');
    const filterSeg = ui.segmented({ value: filter, options: [['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Live']], onChange: v => { filter = v; store.patch({ postFilter: v }); paintList(); } });
    const newBtn = ui.button({ label: 'New post', icon: '＋', kind: 'primary', title: 'Start a new draft', onClick: () => create() });
    const side = ui.panel({ title: 'Devlog', icon: '✦', cls: 'pub-post-side', actions: [newBtn], body: [filterSeg, listBox, h('div.pub-post-foot', [countBox])] });
    const edit = h('div.pub-post-edit');
    host.appendChild(h('div.pub-posts', [side, edit]));
    WB.ui.listKeys(listBox);

    async function load() {
      posts = (await WB.api('publish.posts', worldId).catch(WB.fail)) || [];
      if (!alive) return;
      if (sel && !posts.find(p => p.id === sel)) sel = null;
      paintList();
    }
    function label(p) {
      const st = STATE[p.state] || STATE.draft;
      let when = '';
      if (p.publish) { const d = daysTo(p.publish); when = p.state === 'scheduled' ? (d === 1 ? 'tomorrow' : 'in ' + d + ' days') : WB.fmt.real(p.publish); }
      return { text: st[0], tone: p.audience === 'private' ? 'bad' : st[1], when };
    }
    function paintList() {
      GK.clear(listBox);
      const list = posts.filter(p => filter === 'all' || p.state === filter);
      countBox.textContent = P.plural(posts.filter(p => p.state === 'published' && p.audience !== 'private').length, 'post') + ' live · ' + posts.filter(p => p.state === 'scheduled').length + ' scheduled · ' + posts.filter(p => p.state === 'draft').length + ' drafts';
      if (!list.length) {
        listBox.appendChild(WB.ui.empty({ icon: '✦', title: posts.length ? 'Nothing here' : 'No posts yet', text: posts.length ? 'No post matches this filter.' : 'Write news, progress notes and updates. Live posts appear on the website and in its RSS feed.' }));
        return;
      }
      for (const p of list) {
        const l = label(p);
        const row = WB.ui.row(p, {
          active: p.id === sel, sub: [l.when, p.tier === 'Supporters' ? 'supporters' : '', p.audience === 'private' ? 'private' : ''].filter(Boolean).join(' · ') || 'no date',
          trailing: WB.ui.badge(p.audience === 'private' ? 'Private' : l.text, l.tone),
          onClick: () => select(p.id),
        });
        listBox.appendChild(row);
      }
    }
    async function select(id) {
      if (editor) { editor.flush && editor.flush(); }
      sel = id; store.patch({ postId: id });
      paintList();
      await paintEditor();
    }
    async function create() {
      try {
        const e = await WB.api('entries.create', { worldId, typeId: type.id, title: 'New post', audience: 'public', fields: { status: 'Draft', publish: WB.today(), audience_tier: 'Everyone' } });
        filter = 'all'; store.patch({ postFilter: 'all' });
        filterSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
        await load();
        await select(e.id);
        const t = edit.querySelector('.pub-post-title');
        if (t) { t.focus(); t.select(); }
      } catch (err) { WB.fail(err); }
    }

    async function paintEditor() {
      if (editor) { editor.destroy(); editor = null; }
      GK.clear(edit);
      editingId = sel;
      if (!sel) {
        edit.appendChild(ui.panel({ cls: 'pub-post-blank', body: [WB.ui.empty({ icon: '✎', title: posts.length ? 'Pick a post to edit' : 'Your devlog starts here', text: 'Drafts stay private to you. Scheduled posts go live on their date; live posts appear on the website and in its RSS feed.', actions: [ui.button({ label: 'New post', icon: '＋', kind: 'primary', onClick: create })] })] }));
        return;
      }
      const e = await WB.api('entries.get', sel).catch(WB.fail);
      if (!e || !alive || editingId !== sel) return;
      const f = Object.assign({ status: 'Draft', publish: '', audience_tier: 'Everyone', excerpt: '' }, e.fields);
      const save = async patch => {
        try {
          await WB.api('entries.update', e.id, patch);
          if (patch.fieldsPatch) Object.assign(f, patch.fieldsPatch);
          if (patch.audience) e.audience = patch.audience;
          paintState();
          load();
        } catch (err) { WB.fail(err); }
      };
      const saveSoon = P.debounce(save, 500);
      const title = ui.input({ value: e.title, placeholder: 'Title', onInput: v => saveSoon({ title: v || 'Untitled post' }) });
      title.classList.add('pub-post-title');
      const status = ui.select({ value: f.status || 'Draft', options: [['Draft', 'Draft'], ['Scheduled', 'Scheduled'], ['Published', 'Published']], onChange: v => save({ fieldsPatch: { status: v } }) });
      const date = ui.input({ type: 'date', value: f.publish || '', onChange: v => save({ fieldsPatch: { publish: v } }) });
      const tier = ui.select({ value: f.audience_tier || 'Everyone', options: [['Everyone', 'Everyone'], ['Supporters', 'Supporters only']], onChange: v => save({ fieldsPatch: { audience_tier: v } }) });
      const aud = WB.ui.audience(e.audience, v => save({ audience: v }));
      const stateLine = h('div.pub-post-state');
      function paintState() {
        const ps = { status: f.status, publish: f.publish };
        const today = WB.today(), st = String(ps.status || '').toLowerCase();
        const live = st === 'published' || (st !== 'draft' && ps.publish && ps.publish <= today);
        let icon = '✎', text = 'Draft: only you can see it.', tone = 'warn';
        if (e.audience === 'private') { icon = '◐'; text = 'Private: it never reaches the website, whatever its status.'; tone = 'bad'; }
        else if (live) { icon = '✓'; text = 'Live on the website' + (ps.publish ? ' since ' + WB.fmt.real(ps.publish) : '') + (f.audience_tier === 'Supporters' ? ', as a teaser for supporters.' : ' and in the RSS feed.'); tone = 'good'; }
        else if (st === 'scheduled' && ps.publish) { const d = daysTo(ps.publish); icon = '◷'; text = 'Scheduled: goes live on ' + WB.fmt.real(ps.publish) + ' (' + (d === 1 ? 'tomorrow' : 'in ' + d + ' days') + ') the next time the site is built.'; tone = ''; }
        else if (st === 'scheduled') { icon = '◷'; text = 'Scheduled, but without a date: pick one.'; tone = 'warn'; }
        stateLine.className = 'pub-post-state ' + tone;
        stateLine.replaceChildren(h('span.pub-post-state-ico', { text: icon }), h('span', { text }));
        publishBtn.replaceChildren(live ? '✓ Live' : '⇪ Publish now');
        publishBtn.disabled = live && e.audience !== 'private';
        publishBtn.title = live ? 'This post is live' : 'Make it live today (and public if it was private)';
      }
      const publishBtn = ui.button({ label: 'Publish now', kind: 'primary', onClick: async () => {
        const patch = { fieldsPatch: { status: 'Published', publish: f.publish && f.publish <= WB.today() ? f.publish : WB.today() } };
        if (e.audience === 'private') patch.audience = 'public';
        await save(patch);
        status.value = 'Published'; date.value = patch.fieldsPatch.publish;
        ui.toast('“' + (title.value || e.title) + '” is live. Rebuild or update the website to publish it.', '⇪', 4000);
      } });
      const excerpt = ui.input({ multiline: true, rows: 2, value: f.excerpt || '', placeholder: 'One or two sentences for the devlog list and the RSS feed (empty = the start of the post)', onInput: v => saveSoon({ fieldsPatch: { excerpt: v } }) });
      const coverBox = h('div.pub-post-cover');
      const paintCover = () => {
        GK.clear(coverBox);
        GK.append(coverBox, [e.coverId ? WB.ui.thumb(e.coverId, { cls: 'pub-post-cover-img' }) : null, h('div.gk-row', [
          ui.button({ label: e.coverId ? 'Change image…' : 'Cover image…', icon: '▣', small: true, onClick: async () => { const m = await WB.ui.pickMedia({ kind: 'image' }); if (m) { e.coverId = m.id; await save({ coverId: m.id }); paintCover(); } } }),
          e.coverId ? ui.button({ label: 'Remove', small: true, kind: 'ghost', onClick: async () => { e.coverId = null; await save({ coverId: null }); paintCover(); } }) : null,
        ])]);
      };
      paintCover();
      const words = h('span.gk-small.gk-muted', { text: WB.fmt.words(e.wordCount || 0) });
      editor = WB.editor.create({ value: e.body || '', placeholder: 'Write the post… Type @ to link an entry: the link only shows on the site if readers may see that entry.', onChange: v => save({ body: v }), onWords: n => { words.textContent = WB.fmt.words(n); } });
      const panel = ui.panel({ cls: 'pub-post-panel', body: [
        h('div.pub-post-head', [title]),
        stateLine,
        h('div.pub-post-meta', [
          P.field({ label: 'Status', control: status }),
          P.field({ label: 'Publish on', control: date, hint: 'A real-world date' }),
          P.field({ label: 'For', control: tier }),
        ]),
        h('div.pub-post-row', [P.field({ label: 'Audience', control: aud, hint: 'Posts reach the public site only when Public; Shared posts appear on a player wiki.' }), coverBox]),
        P.field({ label: 'Excerpt', control: excerpt }),
        editor.el,
        h('div.pub-post-actions', [
          words, h('span.gk-grow'),
          ui.button({ label: 'Open in Codex', icon: '↗', small: true, kind: 'ghost', onClick: () => WB.open(e.id) }),
          ui.button({ label: 'See on the site', icon: '⌂', small: true, kind: 'ghost', title: 'Open this post in the website preview', onClick: () => { const st = String(f.status || '').toLowerCase(), live = e.audience !== 'private' && (st === 'published' || (st !== 'draft' && f.publish && f.publish <= WB.today())); if (!live) ui.toast('Not live yet: the devlog shows it once it is published.', '◷', 3600); if (P.show) P.show('site', live ? { entryId: e.id } : { page: 'devlog/index.html' }); } }),
          ui.button({ label: 'Delete', icon: '🗑', small: true, kind: 'ghost', title: 'Move to the trash (Undo in the toast)', onClick: async () => { await WB.trash(e); sel = null; store.patch({ postId: null }); await load(); paintEditor(); } }),
          publishBtn,
        ]),
      ] });
      edit.appendChild(panel);
      paintState();
    }

    offs.push(WB.onChange(['entries'], () => load(), 300));
    await load();
    if (params.run === 'new') await create();
    else {
      if (params.entryId && posts.find(p => p.id === params.entryId)) sel = params.entryId;
      if (!sel && posts.length) sel = posts[0].id;
      store.patch({ postId: sel });
      paintList();
      await paintEditor();
    }
    return () => { alive = false; offs.forEach(f => f()); if (editor) editor.destroy(); };
  };
})();
