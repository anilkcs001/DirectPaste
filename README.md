# AML Direct Paste

## 1. Extension name and purpose

**AML Direct Paste** (Per-Tenant Extension, Business Central 2024 Wave 2 / v25, IN localisation)

Users copy rows from Excel (or a CSV file, or a table on a web page) and paste them into a FactBox. Direct Paste then:

1. Parses the paste into rows and columns and detects whether the first row is a header.
2. Matches each column to a Business Central field automatically (names, captions, synonyms such as Qty, Rate, UOM, HSN, Godown, and data type).
3. Opens a mapper where the user can re-link columns by dragging a line from a column to a field, remove links, and type default values for fields that have no column.
4. On **OK**, checks every row against Business Central's own rules (all `OnValidate` triggers, `Insert(true)`, GST/Tax Engine subscribers) without saving anything. If any row fails, the errors are listed per row and nothing is inserted.
5. When every row passes, inserts the records, committing every 100 records.

The engine is generic (it works on any table through `RecordRef`). The host page decides the target table and which fields it fixes. The extension ships with one example: **Sales Order → Sales Lines**.

## 2. Object list

| ID | Type | Name | Purpose |
|---|---|---|---|
| 87300 | Table | AML Direct Paste Field Map | Remembered mapping and defaults per user and target table |
| 87301 | Table | AML Direct Paste Template | Named, company-wide templates per target table |
| 87302 | Table | AML Direct Paste Template Line | Template fields: pasted header and/or default value |
| 87300 | Codeunit | AML Direct Paste Mgt. | Generic engine: field metadata, dry run, insert, saved mappings, templates |
| 87301 | Codeunit | AML Direct Paste Row Check | Dry run of one row (insert, then forced rollback) |
| 87300 | Page (CardPart) | AML Direct Paste FactBox | Paste zone; opens the mapper |
| 87301 | Page (StandardDialog) | AML Direct Paste Mapper | Drag-to-link mapper, templates, defaults, preview, OK = import |
| 87302 | Page (List) | AML Direct Paste Templates | Review, rename and delete templates (search "Direct Paste Templates") |
| 87303 | Page (Card) | AML Direct Paste Template | One template with its fields |
| 87304 | Page (ListPart) | AML Direct Paste Template Lines | Template fields |
| 87300 | PageExtension | AML Sales Order Direct Paste | Example host on page 42 "Sales Order" |
| 87300 | PermissionSet | AML Direct Paste | Access to the objects above |
| n/a | ControlAddIn | AML Direct Paste | Paste zone sized for a FactBox |
| n/a | ControlAddIn | AML Direct Paste Mapper | Same scripts, sized for the dialog |

Folder layout:

```
AMLDirectPaste/
├── app.json
├── README.md
├── ControlAddin/
│   ├── AMLDirectPaste.al          ← FactBox add-in definition
│   ├── AMLDirectPasteMapper.al    ← dialog add-in definition (same scripts, larger size)
│   ├── README.md
│   ├── scripts/
│   │   ├── main.js               ← UI, drag-to-link, AL bridge, lifecycle
│   │   ├── startup.js            ← StartupScript: raises ControlAddInReady
│   │   └── helper.js             ← parsing, value normalisation, auto-mapping
│   └── stylesheets/
│       └── style.css
└── src/
    ├── Codeunit/  AMLDirectPasteMgt.Codeunit.al, AMLDirectPasteRowCheck.Codeunit.al
    ├── Page/      AMLDirectPasteFactBox.Page.al, AMLDirectPasteMapper.Page.al,
    │              AMLDirectPasteTemplates.Page.al, AMLDirectPasteTemplate.Page.al, AMLDirectPasteTemplateLines.Page.al
    ├── PageExt/   AMLSalesOrderDirectPaste.PageExt.al
    ├── PermissionSet/ AMLDirectPaste.PermissionSet.al
    └── Table/     AMLDirectPasteFieldMap.Table.al, AMLDirectPasteTemplate.Table.al, AMLDirectPasteTemplateLine.Table.al
```

## 3. Dependencies

- Base Application and System Application v25 (no extra extension dependencies).
- No external APIs and no Azure services. Everything runs inside the BC web client and server.
- India Tax Engine: not a dependency, but its subscribers run during the dry run and the import because Direct Paste uses `Validate` and `Insert(true)`.

## 4. Setup steps

1. **Build and publish.** Open the folder in VS Code with the AL Language extension, download symbols for your sandbox, then publish (F5) or build the `.app` (Ctrl+Shift+B).
2. **Deploy to production.** BC Admin Center → Environments → your environment → Apps → *Upload extension*, or Extension Management → Upload Extension in the client. Choose *Per-Tenant Extension*.
3. **Permissions.** Assign the permission set **AML Direct Paste** to the users (or to a user group / security group). Users also need their normal insert rights on the target table, for example Sales Line. Direct Paste does not grant those.
4. **Try it.** Open a Sales Order with status Open. In the FactBox pane, click **Paste data here**, press Ctrl+V with some rows copied from Excel, check the links, and press OK.
5. **Wire it onto another page (optional).** Copy the pattern in `AMLSalesOrderDirectPaste.PageExt.al`:
   - add `part(...; "AML Direct Paste FactBox")` to the page's FactBoxes;
   - in `OnAfterGetCurrRecord`, build a context with `AddContextField` for each field the header fixes, then call `CurrPage.<Part>.Page.SetContext(Database::"<Target Table>", Context)`.

   For an Item Journal, for example, the context would be Journal Template Name and Journal Batch Name. Line No. is numbered automatically.

## 5. Key logic explained

**Paste (main.js, paste mode).** The paste zone is a transparent textarea, so Ctrl+V, right-click → Paste and long-press paste on touch devices all work. The `paste` event gives the clipboard text. Excel puts tab-separated rows on the clipboard, with quotes around cells that contain tabs, quotes or line breaks. `helper.parseClipboard` handles those quotes, falls back to comma or semicolon for CSV, drops empty rows and trailing empty columns, and pads short rows. The result is sent to AL through `OnDataPasted`. The FactBox then opens the mapper dialog with that data.

**Auto-mapping (helper.js).** Every pasted header is scored against every importable field:

| Rule | Score |
|---|---|
| Header matches what this user saved last time for this field | 110 |
| Exact caption match (ignoring case, spaces, punctuation) | 100 |
| Exact field name match | 95 |
| Synonym table (Qty → Quantity, Rate/MRP → Unit Price, UOM → Unit of Measure Code, HSN → HSN/SAC Code, Godown → Location Code …) | 85 |
| Header words contain the field's words ("Item Qty" contains Quantity) | 60–75 |
| Word overlap / spelling similarity | up to 70 / 60 |

The column's data type then adjusts the score: +10 when it fits (numbers to a Decimal field, dates to a Date field), −25 when it clearly doesn't. Row-counter headers such as *Sr No*, *Sl No* or *S.No* are never mapped. Links are assigned one-to-one, highest score first, with a minimum of 58. Lines below 75 are drawn in amber so the user checks them.

**Mapper (main.js, mapper mode).** Columns on the left, fields on the right, SVG curves between them. Drag from a column (or its dot) onto a field to link it, or click a column and then a field. Click a line or the × to remove it. Linked fields move to the top of the list. Every field has a default box. For unlinked fields the default fills every row; for linked fields it fills only blank cells. Option fields show a dropdown of their values, and Yes/No fields show Yes/No.

**Templates.** In the mapper, **Save as template** stores the current links (by pasted header) and defaults under a name, for everyone in the company. Saving with an existing name overwrites that template. When rows are pasted, every template for the target table is compared with the pasted headers. If at least 60% of a template's headers are present, the best match is applied automatically: its links override auto-mapping and its defaults replace the current ones, and the status line says which template was recognised. The template dropdown shows how many headers each template matches (for example 3/3). Choosing *No template* goes back to auto-mapping. Only the user who saved a template can delete it from the mapper (click the bin twice to confirm); anyone with access can manage templates on the **Direct Paste Templates** page. Each import counts a use and stamps *Last Used At*. Template saves and deletes are committed immediately, because the dry run that follows needs no open write transaction.

The per-user **Remember for me** switch still exists; it quietly remembers your last mapping and defaults and feeds the auto-mapping score. Templates are the named, shared version.

**Value normalisation (helper.js).** Before sending, each cell is converted to AL's XML format so it evaluates the same way whatever the user's regional settings are:
- numbers: `1,23,456.50` (Indian grouping), `1,234.50`, `1.234,50`, `(1,000)`, `₹ 450`, `12%`;
- dates: `dd-mm-yyyy`, `dd/mm/yyyy`, `dd.mm.yy`, `5 Nov 2026`, `Nov 5, 2026`, ISO, and Excel serial numbers. Ambiguous dates are read day-first;
- Yes/No: yes, y, true, 1, x;
- Code fields are upper-cased; Code and Text lengths are checked.

Values that can't be converted are reported in the preview before anything is sent to AL.

**Dry run (Mgt + Row Check codeunits).** When the user presses OK, `OnQueryClosePage` keeps the dialog open and calls `RequestImport()`. The add-in answers with `OnImportRequested(ImportSet)`. For each row, `AML Direct Paste Row Check` is run with `if not RowCheck.Run()`. Inside, the row is built exactly as the real import does it, then the codeunit raises a fixed sentinel error. The platform rolls back the insert and any tax records written by subscribers. The sentinel means "row OK"; any other error text is that row's problem. Because each run ends in a rollback, no write transaction stays open, which `Codeunit.Run` with a return value requires. Up to 200 errors are collected and shown against their row numbers.

**Building a record (`ProcessRow`).**
1. `Init()`.
2. Context fields from the host page are set without validation (e.g. Document Type, Document No.).
3. If the last primary-key field is an Integer that the host doesn't supply (Line No., Entry No.), it is numbered automatically: last existing value within the context + 10000, then +10000 per row.
4. Mapped and defaulted fields are evaluated and validated in a fixed order: key fields first, then by field number. On Sales Line that gives Type → No. → Location Code → Quantity → Unit Price, the same order as typing on the page.
5. Option and enum values are matched against option names and captions, case-insensitive.
6. `Insert(true)`.

**Import.** Same `ProcessRow` for real, `Commit()` every 100 records (`InsertedCount mod 100 = 0`). If "Remember mapping" is ticked, the links and defaults are saved per user and table, and the next paste with the same headers is mapped instantly.

**Security.** The add-in only offers normal, enabled, non-obsolete fields. AL re-checks every field number it receives, so a tampered payload can't write to FlowFields, system fields, context fields or the auto-numbered field.

## 6. Known limitations

- **FactBox refresh.** A FactBox can't refresh its host page. After a paste from the FactBox, the new lines appear when the page next refreshes (moving to another record and back, or reopening). The **Direct Paste Lines** action on the Sales Order opens the same mapper and refreshes the page afterwards.
- **Duplicates inside one paste.** Each row is dry-run on its own, so two pasted rows with the same non-automatic primary key (for example two customers with the same No.) both pass the dry run, and the second fails during the real insert.
- **Errors during the real insert.** The dry run catches almost everything. If a row still fails during the real insert (for example data changed by another user in between), records already committed in earlier batches of 100 stay in the table, and the error message comes from Business Central without a row number.
- **Speed.** The dry run inserts and rolls back every row, including tax calculation. A few hundred sales lines take seconds; several thousand can take minutes.
- **Confirm dialogs.** Field validations that ask a question (`Confirm`) will interrupt the dry run for each row. Map or default fields so that such questions don't arise.
- **Limits.** 5,000 rows and 200 columns per paste. Only plain-text clipboard content is read (no images or formulas; Excel copies the displayed values).
- **Excel files.** Dropping `.xlsx` files is not supported; copy the cells instead. CSV, TSV and TXT files can be dropped on the paste zone.
- **Ambiguous dates** such as `04-05-2026` are read as 4 May (day-first, Indian convention).
- **Auto-number tables.** Tables whose last key field is an AutoIncrement Integer still get numbers assigned by Direct Paste.
- The control add-in can't resize itself, so there are two add-in definitions (FactBox size and dialog size) sharing the same scripts.

## 7. Change log

| Version | Date | Change |
|---|---|---|
| 1.6.0.0 | 2026-10-24 | Document Reader moved to its own app, **AML Document Reader** (IDs 87350–87399). This app is Direct Paste only again: Document Reader objects, add-ins and scripts removed. |
| 1.2.1.0 | 2026-10-24 | Self-test: the internet check flagged Business Central's own add-in hosting (bc-cdn.dynamics.com and the tenant server). It now takes a snapshot before reading and fails only on new requests to non-Business Central hosts made while reading. |
| 1.1.0.0 | 2026-10-23 | Templates: save the mapping and defaults under a name, shared company-wide; auto-recognised from pasted headers; template list and card pages. New look for the FactBox and mapper: gradient brand, column letters and type glyphs, animated link lines, progress bar, switches, save popover. |
| 1.0.4.0 | 2026-10-23 | Fix: "An invalid argument was passed to a 'List' data type method" in SortAscending. AL evaluates both sides of `and`, so `(j >= 1) and (Numbers.Get(j) > Current)` called Get(0). Loop rewritten; option-caption matching guarded the same way. |
| 1.0.3.0 | 2026-10-23 | Dry-run errors now name the field and value that failed (e.g. `No. 'ITEM-001': You must select an existing item.`). Non-key fields are sorted by field number explicitly in code instead of relying on the Field table's read order. |
| 1.0.2.0 | 2026-10-23 | Fix: "Cannot set properties of null (setting 'innerHTML')". BC loads Scripts in the page head before #controlAddIn exists; the container is now looked up when drawing, listeners are attached to document, and drawing waits for DOMContentLoaded. |
| 1.0.1.0 | 2026-10-23 | Fix: FactBox stayed blank. ControlAddInReady now comes from a StartupScript (with one retry after 3 s), and the paste zone draws immediately instead of waiting for Init(). |
| 1.0.0.0 | 2026-10-23 | First version: FactBox paste, auto-mapping, drag-to-link mapper, defaults, dry run with per-row errors, import with commit every 100, remembered mappings, Sales Order example. |
