# AML Direct Paste control add-in

## Purpose

Browser side of Direct Paste. One script set, two AL definitions:

| Add-in | Used on | Size |
|---|---|---|
| `AML Direct Paste` | Page 87300 "AML Direct Paste FactBox" | 190 px high, for a FactBox |
| `AML Direct Paste Mapper` | Page 87301 "AML Direct Paste Mapper" | 640 × 1100 px, for the dialog |

`Init(config)` sets the mode: `paste` shows the paste zone, `mapper` shows the drag-to-link mapper.

## Files

- `scripts/helper.js`: clipboard parsing, value normalisation to AL XML format, auto-mapping. No DOM state. Exposed as `window.AMLMP`.
- `scripts/startup.js`: StartupScript. Raises `ControlAddInReady` once BC has wired the add-in, and once more after 3 seconds if `Init()` has not arrived.
- `scripts/main.js`: rendering, drag-to-link (pointer events, works with mouse and touch), AL bridge, error boundary, resize and cleanup.
- `stylesheets/style.css`: styling for both modes.

## Events (JS → AL)

All raised with `Microsoft.Dynamics.NAV.InvokeExtensibilityMethod()`.

| Event | When | Payload |
|---|---|---|
| `ControlAddInReady()` | Raised by startup.js after all scripts load | none. AL answers with `Init()` |
| `AddInFrameReady()` | `Init()` has rendered | none. The mapper answers with `LoadData()` |
| `OnDataPasted(Payload)` | Rows pasted or a CSV dropped (paste mode) | `{ rows: [[text]], firstRowHeader: bool }` |
| `OnImportRequested(ImportSet)` | After `RequestImport()`, when all values convert | see below |
| `OnError(ErrorText)` | The error boundary caught a JS error | message text |
| `OnSaveTemplate(Template)` | User saved the mapping as a template | `{ name, links: [{ fieldNo, header }], defaults: [{ fieldNo, value }] }` |
| `OnDeleteTemplate(TemplateId)` | User deleted one of their templates | template Entry No. |

`ImportSet`:

```json
{
  "remember": true,
  "templateId": 3,
  "links":    [ { "fieldNo": 6, "header": "Item Code" }, { "fieldNo": 15, "header": "Qty" } ],
  "defaults": [ { "fieldNo": 7, "value": "MAIN" } ],
  "rows":     [ { "n": 0, "v": ["A-100", "10"] }, { "n": 1, "v": ["A-101", "5"] } ]
}
```

`v` follows the order of `links`. Values are already normalised (dates `yyyy-mm-dd`, decimals with a dot, booleans `true`/`false`). `n` is the data-row index used for error messages.

## Procedures (AL → JS)

| Procedure | Purpose |
|---|---|
| `Init(Config)` | `{ mode: 'paste' \| 'mapper', target: 'Sales Line', maxRows: 5000, templateCount: 2 }` |
| `Refresh()` | Re-render the current view |
| `LoadData(Payload)` | Mapper data: `{ fields: [{ no, name, caption, type, len, pk, options }], fixed: [{ caption, value }], saved: [{ fieldNo, header, defaultValue }], templates: [{ id, name, createdBy, mine, useCount, lines: [{ fieldNo, header, defaultValue }] }], paste: { rows, firstRowHeader } }` |
| `ShowRowErrors(Errors)` | `[{ row, message }]` from the AL dry run |
| `RequestImport()` | Ask the add-in to validate values and raise `OnImportRequested` |
| `SetStatus(Text, IsError)` | Status line under the paste zone or mapper |
| `LoadTemplates(Payload)` | Refreshed template list after a save/delete: `{ templates, selectedId, status }` |

## Robustness

- **Error boundary**: every entry point and event handler is wrapped. An uncaught error shows a "Reload view" panel and raises `OnError`. `window.error` and `unhandledrejection` are caught too.
- **Resize**: a `ResizeObserver` plus window resize and list scroll events redraw the link lines (throttled to one draw per animation frame). Lines whose ends are scrolled out of view fade.
- **Cleanup**: on `pagehide` / `beforeunload`, all listeners are removed, the observer is disconnected and pending frames are cancelled.

## How to deploy

The add-in is part of the extension; there is nothing to install separately. The `Scripts` and `StyleSheets` paths in the `.al` files are relative to the project root, so keep the folder structure as is. Publish the extension (see the main README).

To test the browser side without BC, load `helper.js` and `main.js` in a page that has `<div id="controlAddIn"></div>`, then call `Init({mode:'mapper'})` and `LoadData({...})` from the console. Without `Microsoft.Dynamics.NAV`, events are logged to the console.
