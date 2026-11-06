/* Script of a published Worldbuilder site (copied to assets/site.js). Plain browser JavaScript, no libraries, works
   from a folder opened straight from disk: search (header and search page), the mobile menu, interactive maps
   (pan, zoom, pins and regions with pop-ups), filters on index and chronology pages. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement.getAttribute('data-root') || '';
  var INDEX = window.WB_SITE_INDEX || [];
  function $(s, el) { return (el || doc).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fold(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }

  /* ---------- mobile menu ---------- */
  var toggle = $('.nav-toggle'), nav = $('#site-nav');
  if (toggle && nav) toggle.addEventListener('click', function () { var o = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(o)); });
  doc.addEventListener('click', function (e) { $$('.nav-explore[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); }); });

  /* ---------- search ---------- */
  function search(q, limit) {
    q = fold(q).trim();
    if (!q) return [];
    var words = q.split(/\s+/), out = [];
    for (var i = 0; i < INDEX.length; i++) {
      var it = INDEX[i], t = fold(it.t), a = fold((it.a || []).join(' ')), s = fold(it.s), x = fold(it.x), score = 0, ok = true;
      for (var w = 0; w < words.length; w++) {
        var wd = words[w], sc = 0;
        if (t === wd) sc = 60; else if (t.indexOf(wd) === 0) sc = 40; else if ((' ' + t).indexOf(' ' + wd) >= 0) sc = 30; else if (t.indexOf(wd) >= 0) sc = 22;
        else if (a.indexOf(wd) >= 0) sc = 18; else if (s.indexOf(wd) >= 0) sc = 8; else if (x.indexOf(wd) >= 0) sc = 4;
        if (!sc) { ok = false; break; }
        score += sc;
      }
      if (ok) out.push([score, it]);
    }
    out.sort(function (p, r) { return r[0] - p[0] || p[1].t.localeCompare(r[1].t); });
    return out.slice(0, limit || 50).map(function (p) { return p[1]; });
  }
  function mark(text, q) {
    var s = esc(text), words = fold(q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return s;
    var low = fold(s), res = '', i = 0;
    while (i < s.length) {
      var hit = 0;
      for (var w = 0; w < words.length; w++) if (low.substr(i, words[w].length) === words[w] && words[w].length > hit) hit = words[w].length;
      if (hit) { res += '<mark>' + s.substr(i, hit) + '</mark>'; i += hit; } else { res += s[i]; i++; }
    }
    return res;
  }
  function resultHtml(it, q) {
    return '<a href="' + esc(root + it.u) + '"><span class="ti" style="--tc:' + esc(it.c || '') + '">' + esc(it.i || '◆') + '</span><span><span class="r-t">' + mark(it.t, q) + '</span><span class="r-s">' + esc(it.k) + (it.s ? ' · ' + esc(it.s.slice(0, 120)) : '') + '</span></span></a>';
  }
  var form = $('.site-search'), input = form && $('input', form), pop = form && $('.search-pop', form), sel = -1;
  if (input && pop) {
    var paint = function () {
      var q = input.value, res = search(q, 8);
      sel = -1;
      if (!q.trim()) { pop.hidden = true; return; }
      pop.innerHTML = res.length ? res.map(function (r) { return resultHtml(r, q); }).join('') + '<a href="' + esc(root + 'search.html?q=' + encodeURIComponent(q)) + '"><span class="r-s">See all results for “' + esc(q) + '” →</span></a>' : '<div class="none">Nothing matches “' + esc(q) + '”.</div>';
      pop.hidden = false;
    };
    input.addEventListener('input', paint);
    input.addEventListener('focus', paint);
    input.addEventListener('keydown', function (e) {
      var links = $$('a', pop);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = e.key === 'ArrowDown' ? Math.min(links.length - 1, sel + 1) : Math.max(0, sel - 1);
        links.forEach(function (l, i) { l.classList.toggle('sel', i === sel); });
      } else if (e.key === 'Enter' && sel >= 0 && links[sel]) { e.preventDefault(); location.href = links[sel].href; }
      else if (e.key === 'Escape') { pop.hidden = true; input.blur(); }
    });
    doc.addEventListener('click', function (e) { if (!form.contains(e.target)) pop.hidden = true; });
    doc.addEventListener('keydown', function (e) {
      var typing = e.target.closest && e.target.closest('input, textarea');
      if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
    });
  }
  var page = $('#search-page');
  if (page) {
    var big = $('input', page), list = $('.search-results', page), count = $('.search-count', page);
    var run = function () {
      var q = big.value, res = search(q, 200);
      list.innerHTML = res.map(function (r) { return resultHtml(r, q); }).join('');
      count.textContent = q.trim() ? (res.length ? res.length + (res.length === 1 ? ' result' : ' results') : 'Nothing matches “' + q + '”.') : 'Type to search every page.';
      if (history.replaceState) history.replaceState(null, '', '?q=' + encodeURIComponent(q));
    };
    var m = /[?&]q=([^&]*)/.exec(location.search);
    if (m) big.value = decodeURIComponent(m[1].replace(/\+/g, ' '));
    big.addEventListener('input', run);
    run();
    big.focus();
  }

  /* ---------- filters (index pages, chronology) ---------- */
  $$('[data-filter]').forEach(function (box) {
    var target = $(box.getAttribute('data-filter')), inp = $('input', box), chips = $$('.chip[data-type]', box);
    if (!target) return;
    var off = {};
    var apply = function () {
      var q = fold(inp ? inp.value : '');
      $$('[data-name]', target).forEach(function (el) {
        var show = (!q || fold(el.getAttribute('data-name')).indexOf(q) >= 0) && !off[el.getAttribute('data-type')];
        el.hidden = !show;
      });
      // a year heading hides when none of its items show
      $$('.chron-year', target).forEach(function (y) {
        var n = y.nextElementSibling, any = false;
        while (n && !n.classList.contains('chron-year') && !n.classList.contains('chron-era')) { if (n.classList.contains('chron-item') && !n.hidden) any = true; n = n.nextElementSibling; }
        y.hidden = !any;
      });
    };
    if (inp) inp.addEventListener('input', apply);
    chips.forEach(function (c) { c.addEventListener('click', function () { var t = c.getAttribute('data-type'); off[t] = !off[t]; c.classList.toggle('on', !off[t]); c.classList.toggle('off', !!off[t]); apply(); }); });
  });

  /* ---------- interactive maps ---------- */
  $$('.map-viewer').forEach(function (view) {
    var stage = $('.map-stage', view), dataEl = view.parentNode.querySelector('script.map-data');
    var data = {}; try { data = JSON.parse(dataEl ? dataEl.textContent : '{}'); } catch (err) { data = {}; }
    var pins = data.pins || [], k = 1, tx = 0, ty = 0, popEl = null;
    var fit = function () { k = 1; tx = 0; ty = 0; apply(); };
    var apply = function () {
      var vw = view.clientWidth, vh = view.clientHeight, sw = stage.offsetWidth * k, sh = stage.offsetHeight * k;
      // keep the map in view
      tx = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, tx));
      ty = sh <= vh ? (vh - sh) / 2 : Math.min(0, Math.max(vh - sh, ty));
      stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
      stage.style.setProperty('--ik', String(1 / k));
      if (popEl && popEl._at) place(popEl, popEl._at);
    };
    var zoomAt = function (f, cx, cy) {
      var nk = Math.max(1, Math.min(8, k * f));
      tx = cx - (cx - tx) * (nk / k); ty = cy - (cy - ty) * (nk / k); k = nk; apply();
    };
    var local = function (e) { var r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    view.addEventListener('wheel', function (e) { e.preventDefault(); var p = local(e); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y); }, { passive: false });
    var drag = null, moved = false;
    view.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.map-tools, .map-pop')) return;
      drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; moved = false;
    });
    view.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) { moved = true; view.classList.add('drag'); try { view.setPointerCapture(e.pointerId); } catch (err) { } }
      tx = drag.tx + dx; ty = drag.ty + dy; apply();
    });
    var end = function () { drag = null; view.classList.remove('drag'); };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    $$('.map-tools button', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var z = b.getAttribute('data-zoom'), cx = view.clientWidth / 2, cy = view.clientHeight / 2;
        if (z === 'in') zoomAt(1.4, cx, cy); else if (z === 'out') zoomAt(1 / 1.4, cx, cy); else fit();
      });
    });
    // the pop-up sits above its pin, or below when there is no room, and never leaves the map sideways
    var place = function (el, at) {
      var r = view.getBoundingClientRect(), a = at.getBoundingClientRect();
      var x = a.left + a.width / 2 - r.left, w = el.offsetWidth, hgt = el.offsetHeight;
      var below = a.top - r.top < hgt + 16;
      el.classList.toggle('below', below);
      el.style.left = Math.max(w / 2 + 8, Math.min(view.clientWidth - w / 2 - 8, x)) + 'px';   // check-ok: screen (plain browser page, no app zoom)
      el.style.top = (below ? a.bottom - r.top : a.top - r.top) + 'px';   // check-ok: screen
    };
    var close = function () { if (popEl) { popEl.remove(); popEl = null; } $$('.pin.sel', view).forEach(function (p) { p.classList.remove('sel'); }); };
    var open = function (i, at) {
      var p = pins[i]; if (!p) return;
      close();
      popEl = doc.createElement('div');
      popEl.className = 'map-pop';
      popEl.innerHTML = '<button class="x" type="button" aria-label="Close">✕</button><h4>' + esc(p.t) + '</h4>' + (p.k ? '<div class="small faint">' + esc(p.k) + '</div>' : '') + (p.s ? '<p>' + esc(p.s) + '</p>' : '') +
        (p.u ? '<a class="btn" href="' + esc(p.u) + '">Open page →</a>' : '') + (p.m ? ' <a class="btn ghost" href="' + esc(p.m) + '">Open map →</a>' : '');
      view.appendChild(popEl);
      popEl._at = at; place(popEl, at);
      $('.x', popEl).addEventListener('click', close);
      if (at.classList.contains('pin')) at.classList.add('sel');
    };
    $$('[data-i]', view).forEach(function (el) {
      el.addEventListener('click', function (e) { if (moved) { e.preventDefault(); return; } if (popEl && popEl._at === el) return; e.preventDefault(); open(+el.getAttribute('data-i'), el); });
    });
    view.addEventListener('click', function (e) { if (!moved && !e.target.closest('[data-i], .map-pop, .map-tools')) close(); });
    // scroll this page (only this page, never a frame around it) so the map is in view
    var reveal = function (smooth) {
      var r = view.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= window.innerHeight) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - Math.max(16, (window.innerHeight - r.height) / 2)), behavior: smooth ? 'smooth' : 'auto' });
    };
    // zoom to one pin or region and open its pop-up (legend buttons, "On the map" links ending in #pin-N)
    var focus = function (i) {
      var el = $('[data-i="' + i + '"]', view); if (!el) return;
      var vw = view.clientWidth, vh = view.clientHeight, cx, cy;
      if (el.classList.contains('pin')) { cx = el.offsetLeft; cy = el.offsetTop; }
      else if (el.getBBox) {
        var bb = el.getBBox(), vb = el.ownerSVGElement.viewBox.baseVal;
        cx = (bb.x + bb.width / 2) * stage.offsetWidth / (vb.width || 1); cy = (bb.y + bb.height / 2) * stage.offsetHeight / (vb.height || 1);
      } else return;
      k = Math.max(k, 2.2);
      tx = vw / 2 - cx * k; ty = vh / 2 - cy * k; apply();
      open(i, el);
    };
    $$('.map-legend [data-go]', view.parentNode).forEach(function (b) {
      b.addEventListener('click', function () { focus(+b.getAttribute('data-go')); reveal(true); });
    });
    var first = view === $('.map-viewer');
    var start = function () {
      fit();
      var hm = /^#pin-(\d+)$/.exec(location.hash);
      if (hm && first) { focus(+hm[1]); reveal(false); }
    };
    var img = $('.map-img', view);
    if (img && !img.complete) img.addEventListener('load', start); else start();
    if (first) window.addEventListener('hashchange', function () { var hm = /^#pin-(\d+)$/.exec(location.hash); if (hm) { focus(+hm[1]); reveal(false); } });
    window.addEventListener('resize', apply);   // check-ok: resize (the published site runs in a plain browser, outside the app)
  });
})();
