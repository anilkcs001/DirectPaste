/*!
 * AML Magic Paste - helper.js
 * Pure utilities, no DOM state:
 *   - clipboard parsing (Excel TSV, CSV, quoted cells, multi-line cells)
 *   - value normalisation into AL XML format (Evaluate(FieldRef, Value, 9))
 *   - auto-mapping of pasted headers to Business Central fields
 * Exposed as window.AMLMP.
 */
(function (global) {
  'use strict';

  var THRESHOLD = 58;          // minimum score for an automatic link
  var SAMPLE_SIZE = 30;        // values inspected per column for type inference
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var STOP = { of: 1, the: 1, a: 1, an: 1, in: 1, for: 1, to: 1, and: 1 };

  // Headers that look like field names but are really row counters (common in Indian Excel sheets).
  var BLOCK = {};
  'sno srno slno sl sr sn srl srlno rowno index sequence seq'.split(' ').forEach(function (k) { BLOCK[k] = 1; });

  // Header (compacted) -> candidate BC field names (compacted). Field *names* are stable across languages.
  var SYN = {};
  function syn(keys, targets) { keys.split(' ').forEach(function (k) { SYN[k] = targets.split(' '); }); }
  syn('qty quantity qnty quantities orderqty orderquantity', 'quantity');
  syn('itemno itemcode item sku partno partnumber productcode product productno articleno materialcode material', 'no');
  syn('code', 'no code');
  syn('description desc itemdescription itemname productname particulars particular narration details', 'description');
  syn('name', 'name description');
  syn('description2 desc2 remarks remark additionaldescription', 'description2 comment');
  syn('rate price unitrate salesprice sellingprice mrp unitprice priceperunit', 'unitprice directunitcost');
  syn('cost unitcost purchaseprice purchaserate buyingprice', 'directunitcost unitcost');
  syn('uom unit unitofmeasure units measure', 'unitofmeasurecode');
  syn('location loc warehouse godown store storecode locationcode', 'locationcode');
  syn('discount disc discountpct discpct discountpercent discpercent linediscount', 'linediscount');
  syn('discountamount discamt discountamt', 'linediscountamount');
  syn('amount amt lineamount value total', 'lineamount amount');
  syn('hsn hsncode hsnsac hsnsaccode sac saccode', 'hsnsaccode');
  syn('gstgroup gstgroupcode gst gstcategory', 'gstgroupcode');
  syn('type linetype', 'type');
  syn('variant variantcode', 'variantcode');
  syn('lot lotno batch batchno', 'lotno');
  syn('serialno serial', 'serialno');
  syn('shipmentdate deliverydate dispatchdate', 'shipmentdate requesteddeliverydate');
  syn('postingdate date invoicedate docdate documentdate', 'postingdate documentdate');
  syn('duedate', 'duedate');
  syn('customer customerno customercode custno custcode party partycode', 'selltocustomerno customerno no');
  syn('vendor vendorno vendorcode supplier suppliercode', 'buyfromvendorno vendorno no');
  syn('gstin gstno gstregistrationno', 'gstregistrationno');
  syn('pan panno', 'panno');
  syn('email emailid mail', 'email email2');
  syn('phone phoneno contactno telephone', 'phoneno');
  syn('mobile mobileno cell', 'mobilephoneno phoneno');
  syn('pin pincode zip zipcode postcode postalcode', 'postcode');
  syn('state statecode', 'statecode county');
  syn('city town', 'city');
  syn('address address1 addressline1', 'address');
  syn('address2 addressline2', 'address2');
  syn('country countrycode', 'countryregioncode');
  syn('dept department costcentre costcenter', 'shortcutdimension1code');
  syn('project projectcode', 'shortcutdimension2code jobno');
  syn('glaccount account accountno ledger ledgercode', 'no accountno glaccountno');

  // Token-level expansions used for containment matching ("Item Qty" -> item quantity).
  var TOK = {
    qty: ['quantity'], qnty: ['quantity'], desc: ['description'], amt: ['amount'], disc: ['discount'],
    uom: ['unit', 'measure'], loc: ['location'], num: ['no'], nbr: ['no'], number: ['no'], cust: ['customer'],
    vend: ['vendor'], dt: ['date'], addr: ['address'], ph: ['phone'], mob: ['mobile'], grp: ['group'], dept: ['department']
  };

  /* ---------------------------------------------------------------- basics */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function colLetter(i) {
    var s = '';
    i += 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function compact(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  }

  function tokens(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/)
      .filter(function (t) { return t && !STOP[t]; });
  }

  function expandTokens(list) {
    var out = [];
    list.forEach(function (t) { (TOK[t] || [t]).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); });
    return out;
  }

  /* --------------------------------------------------------------- parsing */

  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 20);
    if (!lines.length) return '\t';
    if (lines[0].indexOf('\t') >= 0) return '\t';
    var pick = '\t';
    [';', ','].some(function (d) {
      var counts = lines.map(function (l) { return l.split(d).length - 1; });
      var same = counts.filter(function (c) { return c === counts[0]; }).length;
      // Most lines agree with the first line (quoted multi-line cells can break a few).
      var ok = counts[0] > 0 && same / counts.length >= 0.6;
      if (ok) pick = d;
      return ok;
    });
    return pick; // no consistent delimiter -> single column paste
  }

  function parseDelimited(text, d) {
    var rows = [], row = [], cell = '', i = 0, inQuotes = false, n = text.length, ch;
    while (i < n) {
      ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
      if (ch === d) { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /** Parse pasted text into a clean rectangular grid of trimmed strings. */
  function parseClipboard(text) {
    text = String(text || '').replace(/^﻿/, '');
    if (!text.trim()) return [];
    var rows = parseDelimited(text, detectDelimiter(text)).map(function (r) {
      return r.map(function (c) { return c.replace(/ /g, ' ').replace(/\r/g, '').trim(); });
    }).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    if (!rows.length) return [];
    var width = 0;
    rows.forEach(function (r) {
      for (var j = r.length - 1; j >= 0; j--) { if (r[j] !== '') { width = Math.max(width, j + 1); break; } }
    });
    return rows.map(function (r) {
      var out = r.slice(0, width);
      while (out.length < width) out.push('');
      return out;
    });
  }

  /** True when the first row looks like column headers rather than data. */
  function guessHeader(grid) {
    if (!grid || grid.length < 2) return false;
    var first = grid[0], seen = {};
    var texty = first.every(function (c) {
      if (c === '' || normDecimal(c) !== null || normDate(c, false)) return false;
      var k = c.toLowerCase();
      if (seen[k]) return false;
      seen[k] = 1;
      return c.length <= 60;
    });
    if (!texty) return false;
    var laterHasTyped = grid.slice(1, 20).some(function (r) {
      return r.some(function (c) { return c !== '' && (normDecimal(c) !== null || normDate(c, false)); });
    });
    return laterHasTyped || first.every(function (c) { return c.length <= 30; });
  }

  /* --------------------------------------------------------- normalisation */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function validYmd(y, m, d) {
    if (y < 1754 || y > 9998 || m < 1 || m > 12 || d < 1) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function year4(y) { return y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y; }

  /** Number text -> "1234.50" (handles Indian 1,23,456.50, western 1,234.50, 1.234,50, (neg), 12%, Rs/₹). */
  function normDecimal(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return '';
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/₹|rs\.?|inr|\$|€|£|%/gi, '').replace(/\s/g, '');
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (/^\+/.test(s)) s = s.slice(1);
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      s = ld > lc ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    } else if (lc >= 0) {
      if (/^\d{1,3}(,\d{3})+$/.test(s) || /^\d{1,2}(,\d{2})*,\d{3}$/.test(s)) s = s.replace(/,/g, '');
      else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
      else return null;
    }
    if (/^\.\d+$/.test(s)) s = '0' + s;
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return (neg && Number(s) !== 0 ? '-' : '') + s;
  }

  function normInteger(raw) {
    var d = normDecimal(raw);
    if (d === '' || d === null) return d;
    if (!/^-?\d+(\.0+)?$/.test(d)) return null;
    return d.split('.')[0];
  }

  /** Date text -> "yyyy-mm-dd". Day-first for ambiguous dates (India). Excel serials when allowSerial. */
  function normDate(raw, allowSerial) {
    var s = String(raw == null ? '' : raw).trim(), m, mon;
    if (s === '') return '';
    s = s.replace(/[T ]\d{1,2}[:.]\d{2}([:.]\d{2})?(\.\d+)?\s*(am|pm)?\s*Z?$/i, '').trim();
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) return validYmd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))) {
      var a = +m[1], b = +m[2], y = year4(+m[3]);
      if (b > 12 && a <= 12) return validYmd(y, a, b);   // clearly mm/dd/yyyy
      return validYmd(y, b, a);                          // dd/mm/yyyy (default)
    }
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-\/ .]?([a-z]{3,9})\.?[-\/ .,]*(\d{2}|\d{4})$/i))) {
      mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
      return mon ? validYmd(year4(+m[3]), mon, +m[1]) : null;
    }
    if ((m = s.match(/^([a-z]{3,9})\.?[-\/ .]?(\d{1,2})(?:st|nd|rd|th)?,?[-\/ .]?(\d{2}|\d{4})$/i))) {
      mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
      return mon ? validYmd(year4(+m[3]), mon, +m[2]) : null;
    }
    if (allowSerial && /^\d{5}(\.\d+)?$/.test(s)) {
      var n = Math.floor(+s);
      if (n > 20000 && n < 80000) {
        var dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
        return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
    }
    return null;
  }

  function normTime(raw) {
    var s = String(raw == null ? '' : raw).trim(), m;
    if (s === '') return '';
    m = s.match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = m[3] ? +m[3] : 0, ap = (m[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || mi > 59 || se > 59) return null;
    return pad(h) + ':' + pad(mi) + ':' + pad(se);
  }

  function normDateTime(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return '';
    var m = s.match(/^(.+?)[ T](\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:am|pm)?)$/i);
    var d = normDate(m ? m[1] : s, true), t = m ? normTime(m[2]) : '00:00:00';
    if (!d || !t) return null;
    var p = d.split('-'), q = t.split(':');
    var local = new Date(+p[0], +p[1] - 1, +p[2], +q[0], +q[1], +q[2]);
    return local.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function normBoolean(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (s === '') return '';
    if (['yes', 'y', 'true', '1', 'x', '✓', 'on'].indexOf(s) >= 0) return 'true';
    if (['no', 'n', 'false', '0', 'off', '-'].indexOf(s) >= 0) return 'false';
    return null;
  }

  /**
   * Normalise one value for a BC field. Returns { ok, value, error }.
   * Output is AL XML format so AL can Evaluate(FieldRef, Value, 9) regardless of user locale.
   */
  function normalize(raw, field) {
    var s = String(raw == null ? '' : raw).trim(), v, err;
    switch (field.type) {
      case 'decimal': v = normDecimal(s); err = 'not a valid number'; break;
      case 'integer':
      case 'biginteger': v = normInteger(s); err = 'not a whole number'; break;
      case 'date': v = normDate(s, true); err = 'not a valid date (use dd-mm-yyyy)'; break;
      case 'time': v = normTime(s); err = 'not a valid time (use hh:mm)'; break;
      case 'datetime': v = normDateTime(s); err = 'not a valid date and time'; break;
      case 'boolean': v = normBoolean(s); err = 'use Yes or No'; break;
      case 'code': v = s.toUpperCase(); break;
      default: v = s;
    }
    if (v === null) return { ok: false, value: '', error: err };
    if ((field.type === 'code' || field.type === 'text') && field.len && v.length > field.len) {
      return { ok: false, value: '', error: 'longer than ' + field.len + ' characters' };
    }
    return { ok: true, value: v };
  }

  /* ----------------------------------------------------------- auto-map */

  function inferColumnType(values) {
    var vals = (values || []).filter(function (v) { return v !== '' && v != null; }).slice(0, SAMPLE_SIZE);
    if (!vals.length) return 'empty';
    if (vals.every(function (v) { return /^(yes|no|true|false|y|n)$/i.test(String(v).trim()); })) return 'boolean';
    if (vals.every(function (v) { return /[^\d.,]/.test(v) && normDate(v, false); })) return 'date';
    if (vals.every(function (v) { return normDecimal(v) !== null; })) return 'number';
    return 'text';
  }

  function typeAdjust(kind, type) {
    if (kind === 'empty') return 0;
    if (type === 'decimal' || type === 'integer' || type === 'biginteger') return kind === 'number' ? 10 : -25;
    if (type === 'date' || type === 'datetime') return kind === 'date' ? 10 : -25;
    if (type === 'boolean') return kind === 'boolean' ? 10 : -10;
    if (kind === 'date' && (type === 'code' || type === 'text')) return -10;
    return 0;
  }

  function lev(a, b) {
    if (a === b) return 0;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    if (a.length < 3 || b.length < 3 || a.length > 40 || b.length > 40) return 0;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var inter = a.filter(function (t) { return b.indexOf(t) >= 0; }).length;
    return inter / (a.length + b.length - inter);
  }

  function containment(headerToks, fieldToks) {
    if (!fieldToks.length || fieldToks.length > headerToks.length) return 0;
    var all = fieldToks.every(function (t) { return headerToks.indexOf(t) >= 0; });
    return all ? 60 + 15 * (fieldToks.length / headerToks.length) : 0;
  }

  /**
   * cols:   [{ header, values[] }]
   * fields: [{ no, name, caption, type, len, pk }]
   * saved:  [{ fieldNo, header }]   remembered mapping for this user + table
   * Returns [{ col, fieldNo, score }] one-to-one, best score first.
   */
  function autoMap(cols, fields, saved) {
    var savedByField = {};
    (saved || []).forEach(function (s) { if (s.header) savedByField[s.fieldNo] = compact(s.header); });
    var prepared = fields.map(function (f) {
      return { f: f, c: compact(f.caption), n: compact(f.name), t: tokens(f.caption), tn: tokens(f.name) };
    });
    var pairs = [];
    cols.forEach(function (col, ci) {
      var s = compact(col.header);
      if (!s) return;
      var blocked = !!BLOCK[s];
      var st = expandTokens(tokens(col.header)), syns = SYN[s] || [], kind = inferColumnType(col.values);
      var expanded = st.join('');
      prepared.forEach(function (p) {
        var sc = 0;
        if (savedByField[p.f.no] && savedByField[p.f.no] === s) sc = 110;
        else if (blocked) sc = 0;
        else if (s === p.c) sc = 100;
        else if (s === p.n) sc = 95;
        else if (syns.indexOf(p.n) >= 0 || syns.indexOf(p.c) >= 0) sc = 85 - syns.indexOf(syns.indexOf(p.n) >= 0 ? p.n : p.c);
        else if (expanded === p.c || expanded === p.n) sc = 80;
        else {
          sc = Math.max(
            containment(st, p.t), containment(st, p.tn),
            jaccard(st, p.t) * 70,
            similarity(s, p.c) * 60, similarity(s, p.n) * 60
          );
        }
        if (sc > 0 && sc < 110) sc += typeAdjust(kind, p.f.type);
        if (sc >= THRESHOLD) pairs.push({ col: ci, fieldNo: p.f.no, score: Math.round(sc) });
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score || a.col - b.col; });
    var usedCol = {}, usedField = {}, out = [];
    pairs.forEach(function (p) {
      if (usedCol[p.col] || usedField[p.fieldNo]) return;
      usedCol[p.col] = usedField[p.fieldNo] = 1;
      out.push(p);
    });
    return out;
  }

  /* ---------------------------------------------------------------- misc */

  function rafThrottle(fn) {
    var id = 0;
    var wrapped = function () {
      if (id) return;
      id = global.requestAnimationFrame(function () { id = 0; fn(); });
    };
    wrapped.cancel = function () { if (id) global.cancelAnimationFrame(id); id = 0; };
    return wrapped;
  }

  global.AMLMP = {
    esc: esc,
    colLetter: colLetter,
    compact: compact,
    parseClipboard: parseClipboard,
    guessHeader: guessHeader,
    normalize: normalize,
    normDecimal: normDecimal,
    normDate: normDate,
    inferColumnType: inferColumnType,
    autoMap: autoMap,
    rafThrottle: rafThrottle
  };
})(typeof window !== 'undefined' ? window : globalThis);
