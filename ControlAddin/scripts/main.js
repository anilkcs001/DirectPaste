/*!
 * AK Direct Paste - main.js
 * One script, two modes (set by AL through Init):
 *   paste  - FactBox paste zone. Parses the paste and raises OnDataPasted.
 *   mapper - Dialog with templates, drag-to-link mapping, defaults and preview. Raises OnImportRequested.
 *
 * AL -> JS : Init(config), Refresh(), LoadData(payload), ShowRowErrors(errors), RequestImport(),
 *            SetStatus(text, isError), LoadTemplates(payload)
 * JS -> AL : ControlAddInReady (startup.js), AddInFrameReady, OnDataPasted(payload), OnImportRequested(importSet),
 *            OnSaveTemplate(template), OnDeleteTemplate(templateId), OnError(text)
 */
(function () {
  'use strict';

  var H = window.AKMP;
  var PREVIEW_ROWS = 50;
  var MAX_ERRORS_SHOWN = 200;
  var TEMPLATE_MATCH = 0.6;   // share of a template's headers that must be present to auto-apply it

  var ICON = {
    spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".6"/></svg>'
  };
  var TYPE_GLYPH = { number: '#', date: '31', boolean: '✓', text: 'Aa', empty: '∅' };

  // BC loads Scripts in the page <head>, before <body> and #controlAddIn exist,
  // so the container is looked up when it is needed, never at load time.
  var rootEl = null;
  var placeholder = document.createElement('div');
  var resizeObs = null;
  function R() {
    if (!rootEl || !rootEl.isConnected) {
      rootEl = document.getElementById('controlAddIn') || document.body || null;
      if (rootEl && resizeObs) resizeObs.observe(rootEl);
    }
    return rootEl || placeholder;
  }

  var S = {
    mode: 'paste', config: {}, initDone: false,
    fields: [], fieldByNo: {}, fixed: [], saved: [],
    templates: [], templateId: 0, savingTemplate: false, confirmDelete: false,
    grid: [], data: [], headers: [], colTypes: [], firstRowHeader: true,
    links: {},          // colIndex -> { fieldNo, auto, score, tpl }
    defaults: {},       // fieldNo -> text
    remember: true,
    search: '', showMode: 'all',
    selectedCol: null, newLinkField: null,
    errors: [],         // [{ row, message }]  row = data row index, -1 = defaults
    status: { text: '', isError: false },
    busy: false, busyText: ''
  };

  var listeners = [];
  var destroyed = false;
  var drag = null;
  var renderPending = false;
  var confirmTimer = 0;
  var scheduleDraw = H.rafThrottle(function () { drawLines(null); });

  /* ------------------------------------------------------ AL bridge + errors */

  function invoke(name, args) {
    try {
      if (window.Microsoft && Microsoft.Dynamics && Microsoft.Dynamics.NAV) {
        Microsoft.Dynamics.NAV.InvokeExtensibilityMethod(name, args || []);
      } else {
        console.info('[DirectPaste] ' + name, args);
      }
    } catch (e) {
      console.error('[DirectPaste] Could not raise AL event ' + name, e);
    }
  }

  function fail(err) {
    var msg = err && err.message ? err.message : String(err);
    console.error('[DirectPaste]', err);
    S.busy = false;
    try {
      R().innerHTML = '<div class="mp-root"><div class="mp-crash"><strong>Direct Paste hit a problem.</strong>' +
        '<span>' + H.esc(msg) + '</span><button type="button" class="mp-btn" data-act="reset">Reload view</button></div></div>';
    } catch (ignore) { /* nothing more we can do */ }
    invoke('OnError', [msg]);
  }

  function guard(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { fail(e); }
    };
  }

  function listen(target, evt, fn, opts) {
    var g = guard(fn);
    target.addEventListener(evt, g, opts);
    listeners.push([target, evt, g, opts]);
  }

  function el(id) { return document.getElementById(id); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ------------------------------------------------------------ AL -> JS API */

  window.Init = guard(function (config) {
    window.AKDirectPasteInitReceived = true;
    S.initDone = true;
    S.config = config || {};
    S.mode = S.config.mode === 'mapper' ? 'mapper' : 'paste';
    render();
    invoke('AddInFrameReady', []);
  });

  window.Refresh = guard(function () { render(); });

  window.LoadData = guard(function (payload) {
    payload = payload || {};
    S.fields = (payload.fields || []).map(function (f) {
      return {
        no: +f.no, name: String(f.name || ''), caption: String(f.caption || f.name || ''),
        type: String(f.type || 'text'), len: +f.len || 0, pk: !!f.pk, options: f.options || null
      };
    });
    S.fieldByNo = {};
    S.fields.forEach(function (f) { S.fieldByNo[f.no] = f; });
    S.fixed = payload.fixed || [];
    S.saved = payload.saved || [];
    S.templates = normaliseTemplates(payload.templates);
    S.templateId = 0;
    loadRememberedDefaults();
    var p = payload.paste || {};
    if (p.rows && p.rows.length) setGrid(p.rows, p.firstRowHeader);
    else { resetGrid(); render(); }
    if (!S.fields.length) setStatus('No importable fields were found for this table.', true);
  });

  window.LoadTemplates = guard(function (payload) {
    payload = payload || {};
    S.templates = normaliseTemplates(payload.templates);
    var sel = +payload.selectedId || 0;
    if (sel && templateById(sel)) S.templateId = sel;
    else if (!templateById(S.templateId)) S.templateId = 0;
    S.savingTemplate = false;
    S.confirmDelete = false;
    S.busy = false;
    render();
    if (payload.status) setStatus(String(payload.status), false);
  });

  window.ShowRowErrors = guard(function (errors) {
    setBusy(false);
    S.errors = (errors || []).map(function (e) { return { row: +e.row, message: String(e.message || '') }; });
    renderPreviewOnly();
    if (S.errors.length) {
      setStatus(plural(S.errors.length, 'row fails', 'rows fail') +
        ' the Business Central checks. Nothing was inserted. Fix the data, links or defaults, then press OK again.', true);
    }
  });

  window.RequestImport = guard(function () {
    if (S.mode !== 'mapper' || S.busy) return;
    if (!S.grid.length) { setStatus('Paste some rows first.', true); return; }

    var linkCols = linkedCols();
    var errors = [];
    var defaults = normalisedDefaults(errors);

    if (!linkCols.length && !defaults.length) {
      setStatus('Link at least one column to a field (drag a dot), or give a default value.', true);
      return;
    }

    var rows = [];
    S.data.forEach(function (r, i) {
      var v = [];
      linkCols.forEach(function (c) {
        var f = S.fieldByNo[S.links[c].fieldNo], raw = r[c] == null ? '' : r[c];
        var res = H.normalize(raw, f);
        if (!res.ok) errors.push({ row: i, message: f.caption + ': "' + raw + '" is ' + res.error });
        v.push(res.ok ? res.value : '');
      });
      rows.push({ n: i, v: v });
    });

    if (errors.length) {
      S.errors = errors;
      renderPreviewOnly();
      setStatus(plural(errors.length, 'value needs', 'values need') + ' fixing before import.', true);
      return;
    }

    S.errors = [];
    renderPreviewOnly();
    setBusy(true, 'Checking ' + plural(rows.length, 'row', 'rows') + ' against Business Central rules...');
    invoke('OnImportRequested', [{
      remember: S.remember, templateId: S.templateId,
      links: linkPayload(linkCols), defaults: defaults, rows: rows
    }]);
  });

  window.SetStatus = guard(function (text, isError) {
    setBusy(false);
    setStatus(String(text || ''), !!isError);
  });

  /* ------------------------------------------------------------- state ops */

  function resetGrid() {
    S.grid = []; S.data = []; S.headers = []; S.colTypes = []; S.links = {}; S.errors = []; S.selectedCol = null;
  }

  function setGrid(rows, firstRowHeader) {
    S.grid = rows.map(function (r) { return r.map(function (c) { return c == null ? '' : String(c); }); });
    S.firstRowHeader = firstRowHeader === undefined || firstRowHeader === null ? H.guessHeader(S.grid) : !!firstRowHeader;
    computeHeaders();
    runAutoMap();
    S.errors = [];
    S.selectedCol = null;
    var best = bestTemplate();
    if (best) {
      applyTemplate(best, true);
    } else {
      render();
    }
  }

  function computeHeaders() {
    var width = S.grid.length ? S.grid[0].length : 0, i;
    S.headers = [];
    for (i = 0; i < width; i++) {
      var h = S.firstRowHeader ? S.grid[0][i] : '';
      S.headers.push(h || 'Column ' + H.colLetter(i));
    }
    S.data = S.firstRowHeader ? S.grid.slice(1) : S.grid.slice(0);
    S.colTypes = S.headers.map(function (h, c) {
      return H.inferColumnType(S.data.slice(0, 50).map(function (r) { return r[c]; }));
    });
  }

  function runAutoMap() {
    var cols = S.headers.map(function (h, i) {
      return { header: h, values: S.data.slice(0, 50).map(function (r) { return r[i]; }) };
    });
    S.links = {};
    H.autoMap(cols, S.fields, S.saved).forEach(function (l) {
      S.links[l.col] = { fieldNo: l.fieldNo, auto: true, score: l.score };
    });
  }

  function loadRememberedDefaults() {
    S.defaults = {};
    S.saved.forEach(function (s) {
      var f = S.fieldByNo[s.fieldNo];
      if (f && s.defaultValue) S.defaults[f.no] = displayDefault(f, String(s.defaultValue));
    });
  }

  function linkedCols() {
    return Object.keys(S.links).map(Number).sort(function (a, b) { return a - b; });
  }

  function linkPayload(cols) {
    return cols.map(function (c) { return { fieldNo: S.links[c].fieldNo, header: S.headers[c] }; });
  }

  function normalisedDefaults(errors) {
    var out = [];
    Object.keys(S.defaults).forEach(function (no) {
      var raw = S.defaults[no], f = S.fieldByNo[no];
      if (!f || raw === '' || raw == null) return;
      var r = H.normalize(raw, f);
      if (!r.ok) errors.push({ row: -1, message: f.caption + ': default "' + raw + '" is ' + r.error });
      else out.push({ fieldNo: f.no, value: r.value });
    });
    return out;
  }

  function reverseLinks() {
    var rev = {};
    Object.keys(S.links).forEach(function (k) { rev[S.links[k].fieldNo] = +k; });
    return rev;
  }

  function link(col, fieldNo) {
    if (!S.fieldByNo[fieldNo] || col < 0 || col >= S.headers.length) return;
    Object.keys(S.links).forEach(function (k) { if (S.links[k].fieldNo === fieldNo) delete S.links[k]; });
    S.links[col] = { fieldNo: fieldNo, auto: false, score: 100 };
    S.selectedCol = null;
    S.newLinkField = fieldNo;
    S.errors = [];
    render();
    setStatus('Linked "' + S.headers[col] + '" to ' + S.fieldByNo[fieldNo].caption + '.', false);
  }

  function unlink(fieldNo) {
    Object.keys(S.links).forEach(function (k) { if (S.links[k].fieldNo === fieldNo) delete S.links[k]; });
    S.errors = [];
    render();
  }

  function setDefault(fieldNo, value, inputEl) {
    if (value) S.defaults[fieldNo] = value; else delete S.defaults[fieldNo];
    var row = inputEl && inputEl.closest('.mp-field');
    if (row) row.classList.toggle('has-default', !!value);
    updateProgress();
  }

  function displayDefault(f, v) {
    if (f.type === 'boolean') return v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
    return v;
  }

  /* ------------------------------------------------------------- templates */

  function normaliseTemplates(list) {
    return (list || []).map(function (t) {
      return {
        id: +t.id, name: String(t.name || ''), createdBy: String(t.createdBy || ''), mine: !!t.mine,
        useCount: +t.useCount || 0,
        lines: (t.lines || []).map(function (l) {
          return { fieldNo: +l.fieldNo, header: String(l.header || ''), defaultValue: String(l.defaultValue || '') };
        })
      };
    });
  }

  function templateById(id) {
    for (var i = 0; i < S.templates.length; i++) if (S.templates[i].id === id) return S.templates[i];
    return null;
  }

  function templateMatch(t) {
    var wanted = t.lines.filter(function (l) { return l.header && S.fieldByNo[l.fieldNo]; });
    if (!wanted.length) return { score: 0, matched: 0, total: 0 };
    var have = S.headers.map(H.compact);
    var matched = wanted.filter(function (l) { return have.indexOf(H.compact(l.header)) >= 0; }).length;
    return { score: matched / wanted.length, matched: matched, total: wanted.length };
  }

  function bestTemplate() {
    var best = null, bestScore = 0;
    S.templates.forEach(function (t) {
      var m = templateMatch(t);
      if (m.matched === 0 || m.score < TEMPLATE_MATCH) return;
      if (m.score > bestScore || (m.score === bestScore && best && t.useCount > best.useCount)) { best = t; bestScore = m.score; }
    });
    return best;
  }

  function applyTemplate(t, automatic) {
    var have = S.headers.map(H.compact), matched = 0;
    t.lines.forEach(function (l) {
      if (!l.header || !S.fieldByNo[l.fieldNo]) return;
      var col = have.indexOf(H.compact(l.header));
      if (col < 0) return;
      Object.keys(S.links).forEach(function (k) { if (S.links[k].fieldNo === l.fieldNo || +k === col) delete S.links[k]; });
      S.links[col] = { fieldNo: l.fieldNo, auto: false, score: 100, tpl: true };
      matched++;
    });
    S.defaults = {};
    t.lines.forEach(function (l) {
      var f = S.fieldByNo[l.fieldNo];
      if (f && l.defaultValue) S.defaults[f.no] = displayDefault(f, l.defaultValue);
    });
    S.templateId = t.id;
    S.errors = [];
    render();
    var total = t.lines.filter(function (l) { return l.header; }).length;
    setStatus((automatic ? 'Recognised your columns: template "' : 'Template "') + t.name + '" applied, ' +
      matched + ' of ' + total + ' columns matched.', false);
  }

  function clearTemplate() {
    S.templateId = 0;
    runAutoMap();
    loadRememberedDefaults();
    S.errors = [];
    render();
    setStatus('Template removed. Columns were auto-mapped again.', false);
  }

  function saveTemplate() {
    var input = el('mpTplName');
    var name = input ? input.value.trim() : '';
    if (!name) { if (input) input.focus(); setStatus('Give the template a name.', true); return; }
    var errors = [];
    var defaults = normalisedDefaults(errors);
    if (errors.length) { S.errors = errors; renderPreviewOnly(); setStatus(errors[0].message, true); return; }
    var links = linkPayload(linkedCols());
    if (!links.length && !defaults.length) { setStatus('Link some columns or set defaults before saving a template.', true); return; }
    setBusy(true, 'Saving template "' + name + '"...');
    invoke('OnSaveTemplate', [{ name: name, links: links, defaults: defaults }]);
  }

  /* ------------------------------------------------------------- paste input */

  function handleText(text) {
    if (S.busy) return;
    var grid = H.parseClipboard(text || '');
    var max = +S.config.maxRows || 5000;
    if (!grid.length) { setStatus('Nothing to read. Copy some rows in Excel, then paste here.', true); return; }
    if (grid.length > max + 1) {
      setStatus('That paste has ' + grid.length + ' rows. The limit is ' + max + ' per paste, so split it into smaller batches.', true);
      return;
    }
    if (grid[0].length > 200) { setStatus('That paste has more than 200 columns. Copy only the columns you need.', true); return; }
    var hdr = H.guessHeader(grid);
    if (S.mode === 'paste') {
      setStatus('Read ' + plural(grid.length - (hdr ? 1 : 0), 'row', 'rows') + ' × ' + plural(grid[0].length, 'column', 'columns') + '. Opening the mapper...', false);
      invoke('OnDataPasted', [{ rows: grid, firstRowHeader: hdr }]);
    } else {
      setGrid(grid, hdr);
      if (!S.templateId) setStatus('Read ' + plural(S.data.length, 'row', 'rows') + '. Check the links, then press OK.', false);
    }
  }

  /* ------------------------------------------------------------- rendering */

  function render() {
    if (destroyed) return;
    if (R() === placeholder) {
      if (!renderPending) {
        renderPending = true;
        document.addEventListener('DOMContentLoaded', function () { renderPending = false; render(); }, { once: true });
      }
      return;
    }
    var keep = { src: el('mpSrc') ? el('mpSrc').scrollTop : 0, dst: el('mpDst') ? el('mpDst').scrollTop : 0 };
    R().innerHTML = S.mode === 'mapper' ? mapperHtml() : pasteHtml();
    if (el('mpSrc')) el('mpSrc').scrollTop = keep.src;
    if (el('mpDst')) el('mpDst').scrollTop = keep.dst;
    R().classList.toggle('mp-selecting', S.selectedCol !== null);
    if (S.savingTemplate && el('mpTplName')) { el('mpTplName').focus(); el('mpTplName').select(); }
    scheduleDraw();
  }

  function zoneHtml(title, subHtml, extraClass) {
    return '<label class="mp-zone' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<textarea class="mp-catch" aria-label="' + H.esc(title) + '" spellcheck="false" autocomplete="off"></textarea>' +
      '<span class="mp-orb">' + ICON.spark + '</span>' +
      '<span class="mp-zone-title">' + H.esc(title) + '</span>' +
      '<span class="mp-zone-sub">' + subHtml + '</span>' +
      '</label>';
  }

  var KBD = 'Click here, then press <kbd>Ctrl</kbd> + <kbd>V</kbd>';

  function statusHtml() {
    return '<div class="mp-status' + (S.status.isError ? ' is-error' : '') + (S.status.text ? '' : ' is-empty') +
      '" role="status" aria-live="polite">' + H.esc(S.status.text) + '</div>';
  }

  function busyHtml() {
    return '<div class="mp-busy' + (S.busy ? '' : ' is-hidden') + '"><div class="mp-busy-box">' +
      '<span class="mp-busy-orb">' + ICON.spark + '</span><span class="mp-busy-text">' + H.esc(S.busyText) + '</span>' +
      '<button type="button" class="mp-link" data-act="unbusy">Hide</button></div></div>';
  }

  function pasteHtml() {
    var meta;
    if (!S.initDone) meta = '<span class="mp-pill is-muted">Connecting to Business Central...</span>';
    else if (!S.config.target) meta = '<span class="mp-pill is-warn">Not connected to a table on this page</span>';
    else {
      var n = +S.config.templateCount || 0;
      meta = '<span class="mp-pill">→ ' + H.esc(S.config.target) + '</span>' +
        (n ? '<span class="mp-pill is-soft">' + ICON.layers + plural(n, 'template', 'templates') + '</span>' : '');
    }
    return '<div class="mp-root mp-mode-paste">' +
      zoneHtml('Paste from Excel', KBD + '<br><span class="mp-zone-hint">or drop a CSV file</span>', 'mp-zone-fb') +
      '<div class="mp-meta">' + meta + '</div>' +
      statusHtml() + '</div>';
  }

  function templateBarHtml() {
    var t = templateById(S.templateId);
    var opts = '<option value="0">' + (S.templates.length ? 'No template' : 'No saved templates yet') + '</option>' +
      S.templates.map(function (x) {
        var m = S.grid.length ? templateMatch(x) : null;
        var hint = m && m.total ? '  ·  ' + m.matched + '/' + m.total + ' match' : '';
        return '<option value="' + x.id + '"' + (x.id === S.templateId ? ' selected' : '') + '>' +
          H.esc(x.name) + (x.mine ? '' : '  (' + H.esc(x.createdBy) + ')') + hint + '</option>';
      }).join('');
    var h = '<div class="mp-tpl">' +
      '<span class="mp-tpl-icon">' + ICON.layers + '</span>' +
      '<select class="mp-tpl-select" data-act="tpl" aria-label="Template"' + (S.templates.length ? '' : ' disabled') + '>' + opts + '</select>';
    if (t && t.mine) {
      h += '<button type="button" class="mp-icon-btn' + (S.confirmDelete ? ' is-danger' : '') + '" data-act="tpl-del" title="Delete this template">' +
        ICON.trash + (S.confirmDelete ? '<span>Delete?</span>' : '') + '</button>';
    }
    h += '<button type="button" class="mp-btn mp-btn-primary" data-act="tpl-save"' + (S.grid.length ? '' : ' disabled') + '>' +
      ICON.save + '<span>Save as template</span></button>';
    if (S.savingTemplate) {
      h += '<div class="mp-pop" role="dialog" aria-label="Save template">' +
        '<div class="mp-pop-title">Save this mapping as a template</div>' +
        '<div class="mp-pop-sub">Links and defaults are saved for everyone in the company. Same name = overwrite.</div>' +
        '<input id="mpTplName" class="mp-input" maxlength="100" placeholder="e.g. Vendor price list" value="' + H.esc(t ? t.name : '') + '">' +
        '<div class="mp-pop-actions"><button type="button" class="mp-btn" data-act="tpl-cancel">Cancel</button>' +
        '<button type="button" class="mp-btn mp-btn-primary" data-act="tpl-confirm">Save template</button></div></div>';
    }
    return h + '</div>';
  }

  function progressHtml() {
    var linked = Object.keys(S.links).length, total = S.headers.length || 1;
    var defs = Object.keys(S.defaults).length;
    var pct = Math.round(linked / total * 100);
    return '<div class="mp-progress"><div class="mp-progress-track"><span id="mpProgressBar" style="width:' + pct + '%"></span></div>' +
      '<span class="mp-progress-text" id="mpProgressText">' + progressText(linked, defs) + '</span></div>';
  }

  function progressText(linked, defs) {
    return '<b>' + linked + '</b> of ' + S.headers.length + ' columns linked · <b>' + defs + '</b> ' +
      (defs === 1 ? 'default' : 'defaults') + ' · ' + plural(S.data.length, 'row', 'rows');
  }

  function updateProgress() {
    var t = el('mpProgressText'), b = el('mpProgressBar');
    var linked = Object.keys(S.links).length;
    if (t) t.innerHTML = progressText(linked, Object.keys(S.defaults).length);
    if (b) b.style.width = Math.round(linked / (S.headers.length || 1) * 100) + '%';
  }

  function switchHtml(act, checked, label) {
    return '<label class="mp-switch"><input type="checkbox" data-act="' + act + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="mp-switch-track"><span></span></span>' + H.esc(label) + '</label>';
  }

  function mapperHtml() {
    var hasData = S.grid.length > 0;
    var h = '<div class="mp-root mp-mode-mapper">';

    h += '<header class="mp-head">' +
      '<div class="mp-brand"><span class="mp-logo">' + ICON.spark + '</span><div>' +
        '<div class="mp-h1">Direct Paste</div>' +
        '<div class="mp-h2">into <b>' + H.esc(S.config.target || 'Business Central') + '</b>' +
        (hasData ? ' · ' + plural(S.data.length, 'row', 'rows') + ' · ' + plural(S.headers.length, 'column', 'columns') : '') +
        '</div></div></div>' +
      templateBarHtml() +
      '</header>';

    if (hasData) {
      h += '<div class="mp-subbar">' + progressHtml() + '<div class="mp-tools">' +
        switchHtml('hdr', S.firstRowHeader, 'First row is header') +
        switchHtml('remember', S.remember, 'Remember for me') +
        '<button type="button" class="mp-btn mp-btn-ghost" data-act="auto">' + ICON.spark + '<span>Auto-map</span></button>' +
        '<button type="button" class="mp-btn mp-btn-ghost" data-act="clear">Clear</button>' +
        '<button type="button" class="mp-btn mp-btn-ghost" data-act="repaste">New paste</button>' +
        '</div></div>';
    }

    if (S.fixed.length) {
      h += '<div class="mp-fixed"><span class="mp-fixed-label">' + ICON.lock + 'Set automatically</span>' + S.fixed.map(function (f) {
        return '<span class="mp-chip">' + H.esc(f.caption) + ' <b>' + H.esc(f.value) + '</b></span>';
      }).join('') + '</div>';
    }

    if (!hasData) {
      h += '<div class="mp-empty">' + zoneHtml('Paste your rows here',
        'Copy a range in Excel, with or without a header row. ' + KBD + '<br><span class="mp-zone-hint">Saved templates are recognised automatically.</span>',
        'mp-zone-big') + '</div>';
    } else {
      h += '<div class="mp-main">' +
        '<div class="mp-map" id="mpMap">' +
          '<section class="mp-col"><div class="mp-col-head"><span class="mp-col-title">Your columns</span>' +
            '<span class="mp-hint">Drag a dot onto a field — or click a column, then a field</span></div>' +
            '<div class="mp-list" id="mpSrc">' + srcHtml() + '</div></section>' +
          '<div class="mp-gutter" aria-hidden="true"></div>' +
          '<section class="mp-col"><div class="mp-col-head"><span class="mp-col-title">Business Central fields</span>' +
            '<input type="search" class="mp-search" data-act="search" placeholder="Search fields..." value="' + H.esc(S.search) + '">' +
            '<div class="mp-seg" role="group" aria-label="Which fields to show">' +
              '<button type="button" data-act="show" data-value="all" class="' + (S.showMode === 'all' ? 'is-on' : '') + '">All</button>' +
              '<button type="button" data-act="show" data-value="used" class="' + (S.showMode === 'used' ? 'is-on' : '') + '">In use</button>' +
            '</div></div>' +
            '<div class="mp-list" id="mpDst">' + dstHtml() + '</div></section>' +
          '<svg class="mp-lines" id="mpLines" aria-hidden="true"></svg>' +
        '</div>' +
        '<div class="mp-preview" id="mpPreview">' + previewHtml() + '</div>' +
      '</div>' +
      '<div class="mp-legend"><span class="mp-key is-manual"></span>Your link / template' +
        '<span class="mp-key is-auto"></span>Auto-matched<span class="mp-key is-weak"></span>Unsure, please check' +
        '<span class="mp-legend-tip">Click a line to remove it</span></div>';
    }

    h += statusHtml() + busyHtml() + '</div>';
    return h;
  }

  function sampleValues(col) {
    var seen = [], i, v;
    for (i = 0; i < S.data.length && seen.length < 3; i++) {
      v = S.data[i][col];
      if (v && seen.indexOf(v) < 0) seen.push(v);
    }
    var s = seen.join(', ');
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  }

  function linkTag(l) {
    if (l.tpl) return '<span class="mp-tag is-tpl">template</span>';
    if (l.auto) return '<span class="mp-tag' + (l.score < 75 ? ' is-weak' : '') + '">auto ' + Math.min(100, l.score) + '%</span>';
    return '';
  }

  function srcHtml() {
    return S.headers.map(function (hd, i) {
      var l = S.links[i], f = l ? S.fieldByNo[l.fieldNo] : null, samples = sampleValues(i), kind = S.colTypes[i] || 'text';
      return '<div class="mp-src-card' + (f ? ' is-linked' : '') + (S.selectedCol === i ? ' is-selected' : '') +
        '" data-col="' + i + '" title="Drag to a field, or click here and then click a field">' +
        '<span class="mp-letter">' + H.colLetter(i) + '</span>' +
        '<div class="mp-card-body">' +
          '<div class="mp-card-title">' + H.esc(hd) + '<span class="mp-glyph" title="' + kind + '">' + TYPE_GLYPH[kind] + '</span></div>' +
          '<div class="mp-card-sub">' + (samples ? H.esc(samples) : '<em>empty column</em>') + '</div>' +
          '<div class="mp-card-link">' + (f ? '→ ' + H.esc(f.caption) + ' ' + linkTag(l) : 'Not imported') + '</div>' +
        '</div>' +
        '<span class="mp-dot" data-side="src" data-col="' + i + '"></span></div>';
    }).join('');
  }

  function rank(f, rev) {
    if (rev[f.no] !== undefined) return 0;
    if (S.defaults[f.no]) return 1;
    if (f.pk) return 2;
    return 3;
  }

  function visibleFields() {
    var q = S.search.trim().toLowerCase(), rev = reverseLinks();
    return S.fields
      .filter(function (f) {
        if (S.showMode === 'used' && rev[f.no] === undefined && !S.defaults[f.no]) return false;
        if (!q) return true;
        return f.caption.toLowerCase().indexOf(q) >= 0 || f.name.toLowerCase().indexOf(q) >= 0 || String(f.no) === q;
      })
      .map(function (f, i) { return { f: f, i: i }; })
      .sort(function (a, b) {
        var ra = rank(a.f, rev), rb = rank(b.f, rev);
        if (ra !== rb) return ra - rb;
        return ra === 0 ? rev[a.f.no] - rev[b.f.no] : a.i - b.i;
      })
      .map(function (x) { return x.f; });
  }

  function typeLabel(f) {
    switch (f.type) {
      case 'code': return 'Code[' + f.len + ']';
      case 'text': return 'Text[' + f.len + ']';
      case 'boolean': return 'Yes/No';
      case 'biginteger': return 'BigInteger';
      case 'datetime': return 'DateTime';
      case 'dateformula': return 'DateFormula';
      default: return f.type.charAt(0).toUpperCase() + f.type.slice(1);
    }
  }

  function defaultInputHtml(f, dv, linked) {
    var ph = linked ? 'If blank...' : 'Default';
    var common = ' class="mp-default" data-act="default" data-field="' + f.no + '" aria-label="Default for ' + H.esc(f.caption) +
      '" title="' + (linked ? 'Used when the pasted cell is blank' : 'Applied to every row') + '"';
    if (f.type === 'option' && f.options) {
      return '<select' + common + '><option value="">' + ph + '</option>' + f.options.map(function (o) {
        var t = String(o).trim();
        return t ? '<option value="' + H.esc(t) + '"' + (t === dv ? ' selected' : '') + '>' + H.esc(t) + '</option>' : '';
      }).join('') + '</select>';
    }
    if (f.type === 'boolean') {
      return '<select' + common + '><option value="">' + ph + '</option>' +
        '<option value="Yes"' + (dv === 'Yes' ? ' selected' : '') + '>Yes</option>' +
        '<option value="No"' + (dv === 'No' ? ' selected' : '') + '>No</option></select>';
    }
    return '<input type="text"' + common + ' placeholder="' + ph + '" value="' + H.esc(dv) + '" maxlength="' + (f.len || 250) + '">';
  }

  function fieldHtml(f, rev) {
    var col = rev[f.no], linked = col !== undefined, dv = S.defaults[f.no] || '';
    return '<div class="mp-field' + (linked ? ' is-linked' : '') + (dv ? ' has-default' : '') + '" data-field="' + f.no + '">' +
      '<span class="mp-dot" data-side="dst" data-field="' + f.no + '"></span>' +
      '<div class="mp-field-main"><div class="mp-field-title">' + H.esc(f.caption) +
        (f.pk ? ' <span class="mp-badge">KEY</span>' : '') + '</div>' +
        '<div class="mp-field-sub">' + (linked
          ? '<span class="mp-from">' + H.colLetter(col) + '</span>' + H.esc(S.headers[col])
          : H.esc(typeLabel(f)) + (f.name !== f.caption ? ' · ' + H.esc(f.name) : '')) + '</div></div>' +
      '<div class="mp-field-side">' + defaultInputHtml(f, dv, linked) +
        (linked ? '<button type="button" class="mp-x" data-act="unlink" data-field="' + f.no + '" title="Remove link" aria-label="Remove link">&times;</button>' : '') +
      '</div></div>';
  }

  function dstHtml() {
    var rev = reverseLinks(), list = visibleFields();
    if (!list.length) return '<div class="mp-none">No fields match.</div>';
    return list.map(function (f) { return fieldHtml(f, rev); }).join('');
  }

  function previewHtml() {
    var off = S.firstRowHeader ? 2 : 1, n = Math.min(S.data.length, PREVIEW_ROWS), errs = {}, h = '', r;
    S.errors.forEach(function (e) { (errs[e.row] = errs[e.row] || []).push(e.message); });

    if (S.errors.length) {
      h += '<div class="mp-errors"><div class="mp-errors-head">' + plural(S.errors.length, 'problem', 'problems') + ' to fix before import</div><ul>' +
        S.errors.slice(0, MAX_ERRORS_SHOWN).map(function (e) {
          return '<li data-act="goto" data-row="' + e.row + '"><b>' + (e.row < 0 ? 'Defaults' : 'Row ' + (e.row + off)) +
            '</b> ' + H.esc(e.message) + '</li>';
        }).join('') + '</ul></div>';
    }

    h += '<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th class="mp-rn">#</th>';
    S.headers.forEach(function (hd, i) {
      var l = S.links[i], f = l && S.fieldByNo[l.fieldNo];
      h += '<th class="' + (f ? '' : 'is-off') + '"><div><span class="mp-th-letter">' + H.colLetter(i) + '</span>' + H.esc(hd) + '</div><small>' +
        (f ? '→ ' + H.esc(f.caption) : 'not imported') + '</small></th>';
    });
    h += '</tr></thead><tbody>';
    for (r = 0; r < n; r++) {
      var bad = errs[r];
      h += '<tr data-row="' + r + '"' + (bad ? ' class="is-error" title="' + H.esc(bad.join(' | ')) + '"' : '') + '>' +
        '<td class="mp-rn">' + (r + off) + '</td>';
      S.data[r].forEach(function (c, i) { h += '<td class="' + (S.links[i] ? '' : 'is-off') + '">' + H.esc(c) + '</td>'; });
      h += '</tr>';
    }
    h += '</tbody></table></div><div class="mp-foot">' + (S.data.length > n
      ? 'Showing the first ' + n + ' of ' + S.data.length + ' rows. All rows are imported.'
      : plural(S.data.length, 'row', 'rows') + ' will be imported.') + '</div>';
    return h;
  }

  function renderPreviewOnly() {
    var p = el('mpPreview');
    if (p) p.innerHTML = previewHtml();
  }

  function refreshDst() {
    var d = el('mpDst');
    if (d) { d.innerHTML = dstHtml(); scheduleDraw(); }
    R().querySelectorAll('.mp-seg button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.value === S.showMode); });
  }

  function updateSelection() {
    R().querySelectorAll('.mp-src-card').forEach(function (c) {
      c.classList.toggle('is-selected', +c.dataset.col === S.selectedCol);
    });
    R().classList.toggle('mp-selecting', S.selectedCol !== null);
    if (S.selectedCol !== null) setStatus('Now click the field for "' + S.headers[S.selectedCol] + '". Press Esc to cancel.', false);
    else setStatus('', false);
  }

  function setStatus(text, isError) {
    S.status = { text: text, isError: isError };
    var s = R().querySelector('.mp-status');
    if (!s) return;
    s.textContent = text;
    s.classList.toggle('is-error', !!isError);
    s.classList.toggle('is-empty', !text);
  }

  function setBusy(on, text) {
    S.busy = !!on;
    S.busyText = text || '';
    var b = R().querySelector('.mp-busy');
    if (!b) return;
    b.classList.toggle('is-hidden', !on);
    b.querySelector('.mp-busy-text').textContent = S.busyText;
  }

  /* ----------------------------------------------------------------- lines */

  function centre(node) {
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function curve(x1, y1, x2, y2) {
    var dx = Math.max(30, Math.abs(x2 - x1) / 2);
    var f = function (n) { return Math.round(n * 10) / 10; };
    return 'M' + f(x1) + ' ' + f(y1) + ' C' + f(x1 + dx) + ' ' + f(y1) + ' ' + f(x2 - dx) + ' ' + f(y2) + ' ' + f(x2) + ' ' + f(y2);
  }

  function drawLines(temp) {
    var map = el('mpMap'), svg = el('mpLines'), src = el('mpSrc'), dst = el('mpDst');
    if (!map || !svg || !src || !dst) return;
    var mr = map.getBoundingClientRect(), sr = src.getBoundingClientRect(), dr = dst.getBoundingClientRect();
    svg.setAttribute('width', mr.width);
    svg.setAttribute('height', mr.height);
    svg.setAttribute('viewBox', '0 0 ' + mr.width + ' ' + mr.height);

    // userSpaceOnUse: a perfectly horizontal line has a zero-height bounding box and would vanish otherwise.
    var out = ['<defs><linearGradient id="mpGrad" gradientUnits="userSpaceOnUse" x1="' + (sr.right - mr.left) + '" y1="0" x2="' +
      (dr.left - mr.left) + '" y2="0"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#1a8cff"/></linearGradient></defs>'];
    Object.keys(S.links).forEach(function (k) {
      var l = S.links[k];
      var a = src.querySelector('.mp-dot[data-col="' + k + '"]');
      var b = dst.querySelector('.mp-dot[data-field="' + l.fieldNo + '"]');
      if (!a || !b) return; // field hidden by search/filter
      var p1 = centre(a), p2 = centre(b);
      var y1 = clamp(p1.y, sr.top + 6, sr.bottom - 6), y2 = clamp(p2.y, dr.top + 6, dr.bottom - 6);
      var clipped = y1 !== p1.y || y2 !== p2.y;
      var d = curve(p1.x - mr.left, y1 - mr.top, p2.x - mr.left, y2 - mr.top);
      var cls = l.auto ? (l.score < 75 ? 'is-weak' : 'is-auto') : 'is-manual';
      if (S.newLinkField === l.fieldNo) cls += ' is-new';
      out.push('<path class="mp-hit" data-act="unlink" data-field="' + l.fieldNo + '" d="' + d + '"><title>Click to remove this link</title></path>');
      out.push('<path class="mp-line ' + cls + (clipped ? ' is-clipped' : '') + '" d="' + d + '"/>');
    });
    if (!temp) S.newLinkField = null;

    if (temp && temp.anchor) {
      var c = centre(temp.anchor), ax = c.x - mr.left, ay = c.y - mr.top, px = temp.x - mr.left, py = temp.y - mr.top;
      out.push('<path class="mp-line is-temp" d="' + (temp.fromSrc ? curve(ax, ay, px, py) : curve(px, py, ax, ay)) + '"/>');
      out.push('<circle class="mp-cursor" cx="' + px + '" cy="' + py + '" r="5"/>');
    }
    svg.innerHTML = out.join('');
  }

  /* -------------------------------------------------------- drag to link */

  function onPointerDown(e) {
    if (!e.target || !e.target.closest) return;
    if (S.mode !== 'mapper' || S.busy || e.button > 0) return;
    if (e.target.closest('input,select,button,textarea,a')) return;
    var card = e.target.closest('.mp-src-card'), dot = e.target.closest('.mp-dot');
    if (card) drag = { side: 'src', key: +card.dataset.col, anchor: card.querySelector('.mp-dot') };
    else if (dot && dot.dataset.side === 'dst') drag = { side: 'dst', key: +dot.dataset.field, anchor: dot };
    else return;
    drag.x0 = e.clientX; drag.y0 = e.clientY; drag.moved = false; drag.over = null;
    e.preventDefault();
  }

  function dropTargetAt(x, y) {
    var t = document.elementFromPoint(x, y);
    if (!t) return null;
    return drag.side === 'src' ? t.closest('.mp-field') : t.closest('.mp-src-card');
  }

  function autoScroll(y) {
    var list = el(drag.side === 'src' ? 'mpDst' : 'mpSrc');
    if (!list) return;
    var r = list.getBoundingClientRect();
    if (y < r.top + 28) list.scrollTop -= 14;
    else if (y > r.bottom - 28) list.scrollTop += 14;
  }

  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      R().classList.add('mp-dragging');
      if (drag.anchor) drag.anchor.classList.add('is-active');
    }
    var t = dropTargetAt(e.clientX, e.clientY);
    if (drag.over !== t) {
      if (drag.over) drag.over.classList.remove('is-drop');
      drag.over = t;
      if (t) t.classList.add('is-drop');
    }
    autoScroll(e.clientY);
    drawLines({ anchor: drag.anchor, x: e.clientX, y: e.clientY, fromSrc: drag.side === 'src' });
  }

  function endDrag() {
    var d = drag;
    drag = null;
    if (!d) return null;
    R().classList.remove('mp-dragging');
    if (d.anchor) d.anchor.classList.remove('is-active');
    if (d.over) d.over.classList.remove('is-drop');
    return d;
  }

  function onPointerUp() {
    var d = endDrag();
    if (!d) return;
    if (d.moved) {
      if (d.over) {
        if (d.side === 'src') link(d.key, +d.over.dataset.field);
        else link(+d.over.dataset.col, d.key);
      } else {
        scheduleDraw();
      }
      return;
    }
    if (d.side === 'src') { S.selectedCol = S.selectedCol === d.key ? null : d.key; updateSelection(); }
    else if (S.selectedCol !== null) link(S.selectedCol, d.key);
  }

  /* ---------------------------------------------------------------- events */

  function onClick(e) {
    if (!e.target || !e.target.closest) return;
    var a = e.target.closest('[data-act]'), act = a ? a.dataset.act : '';
    if (a && a.disabled) return;
    switch (act) {
      case 'unlink': unlink(+a.dataset.field); return;
      case 'auto':
        runAutoMap(); S.errors = []; render();
        setStatus('Auto-map linked ' + Object.keys(S.links).length + ' of ' + S.headers.length + ' columns.', false);
        return;
      case 'clear': S.links = {}; S.errors = []; render(); return;
      case 'repaste': resetGrid(); S.templateId = 0; render(); setStatus('', false); return;
      case 'show': S.showMode = a.dataset.value; refreshDst(); return;
      case 'tpl-save': S.savingTemplate = !S.savingTemplate; S.confirmDelete = false; render(); return;
      case 'tpl-cancel': S.savingTemplate = false; render(); return;
      case 'tpl-confirm': saveTemplate(); return;
      case 'tpl-del':
        if (!S.confirmDelete) {
          S.confirmDelete = true; render();
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(guard(function () { if (S.confirmDelete) { S.confirmDelete = false; render(); } }), 3500);
          return;
        }
        S.confirmDelete = false;
        setBusy(true, 'Deleting template...');
        invoke('OnDeleteTemplate', [S.templateId]);
        return;
      case 'goto': {
        var tr = R().querySelector('tr[data-row="' + a.dataset.row + '"]');
        if (tr) tr.scrollIntoView({ block: 'nearest' });
        return;
      }
      case 'unbusy': setBusy(false); return;
      case 'reset': render(); return;
      default: break;
    }
    if (S.savingTemplate && !e.target.closest('.mp-pop,[data-act="tpl-save"]')) { S.savingTemplate = false; render(); return; }
    if (S.selectedCol !== null && !e.target.closest('input,select,button,.mp-dot')) {
      var f = e.target.closest('.mp-field');
      if (f) link(S.selectedCol, +f.dataset.field);
    }
  }

  function onChange(e) {
    var t = e.target, act = t.dataset ? t.dataset.act : '';
    if (act === 'hdr') {
      S.firstRowHeader = t.checked; computeHeaders(); runAutoMap(); S.errors = [];
      var tpl = templateById(S.templateId);
      if (tpl) applyTemplate(tpl, false); else render();
    } else if (act === 'remember') S.remember = t.checked;
    else if (act === 'tpl') {
      var chosen = templateById(+t.value);
      if (chosen) applyTemplate(chosen, false); else clearTemplate();
    } else if (act === 'default' && t.tagName === 'SELECT') setDefault(+t.dataset.field, t.value, t);
  }

  function onInput(e) {
    var t = e.target, act = t.dataset ? t.dataset.act : '';
    if (t.classList && t.classList.contains('mp-catch')) {
      if (e.inputType === 'insertFromPaste' && t.value) handleText(t.value);
      t.value = '';
      return;
    }
    if (act === 'search') { S.search = t.value; refreshDst(); }
    else if (act === 'default') setDefault(+t.dataset.field, t.value, t);
  }

  function onPaste(e) {
    if (!e.target.classList || !e.target.classList.contains('mp-catch')) return;
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    e.preventDefault();
    handleText(cd.getData('text/plain') || cd.getData('Text') || '');
  }

  function zoneOf(e) { return e.target && e.target.closest ? e.target.closest('.mp-zone') : null; }

  function onDragOver(e) {
    var z = zoneOf(e);
    if (!z) return;
    e.preventDefault();
    z.classList.add('is-over');
  }

  function onDragLeave(e) {
    var z = zoneOf(e);
    if (z) z.classList.remove('is-over');
  }

  function onDrop(e) {
    var z = zoneOf(e);
    if (!z) return;
    e.preventDefault();
    z.classList.remove('is-over');
    var dt = e.dataTransfer, file = dt && dt.files && dt.files[0];
    if (file) {
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
        setStatus('Only CSV, TSV or TXT files can be dropped. For Excel, copy the cells and paste them.', true);
        return;
      }
      var reader = new FileReader();
      reader.onload = guard(function () { handleText(String(reader.result || '')); });
      reader.onerror = guard(function () { setStatus('Could not read that file.', true); });
      reader.readAsText(file);
      return;
    }
    handleText(dt ? dt.getData('text/plain') : '');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'mpTplName') { e.preventDefault(); saveTemplate(); return; }
    if (e.key !== 'Escape') return;
    if (S.savingTemplate) { S.savingTemplate = false; render(); return; }
    if (drag) { endDrag(); scheduleDraw(); }
    if (S.selectedCol !== null) { S.selectedCol = null; updateSelection(); }
  }

  /* --------------------------------------------------------- lifecycle */

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    listeners = [];
    if (resizeObs) resizeObs.disconnect();
    scheduleDraw.cancel();
    clearTimeout(confirmTimer);
    drag = null;
  }

  // Listeners go on document: it exists even while BC is still loading the page head.
  listen(document, 'click', onClick);
  listen(document, 'change', onChange);
  listen(document, 'input', onInput);
  listen(document, 'paste', onPaste);
  listen(document, 'dragover', onDragOver);
  listen(document, 'dragleave', onDragLeave);
  listen(document, 'drop', onDrop);
  listen(document, 'pointerdown', onPointerDown);
  listen(document, 'pointermove', onPointerMove);
  listen(document, 'pointerup', onPointerUp);
  listen(document, 'pointercancel', function () { endDrag(); scheduleDraw(); });
  listen(document, 'scroll', scheduleDraw, true);
  listen(document, 'keydown', onKeyDown);
  listen(window, 'resize', scheduleDraw);
  listen(window, 'error', function (e) { fail(e.error || e.message); });
  listen(window, 'unhandledrejection', function (e) { fail(e.reason); });
  if (window.ResizeObserver) {
    resizeObs = new ResizeObserver(function () { scheduleDraw(); });
    if (R() !== placeholder) resizeObs.observe(R());
  }
  window.addEventListener('pagehide', destroy);
  window.addEventListener('beforeunload', destroy);

  // Draw straight away so the FactBox is never blank; ControlAddInReady is raised by startup.js.
  render();
})();
