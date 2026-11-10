/// <summary>
/// Direct Paste paste zone, sized for a FactBox.
/// Shares its scripts and stylesheet with "AK Direct Paste Mapper"; the mode is set through Init().
/// </summary>
controladdin "AK Direct Paste"
{
    Scripts = 'ControlAddin/scripts/helper.js',
              'ControlAddin/scripts/main.js';
    StartupScript = 'ControlAddin/scripts/startup.js';
    StyleSheets = 'ControlAddin/stylesheets/style.css';

    RequestedHeight = 190;
    MinimumHeight = 150;
    VerticalStretch = true;
    VerticalShrink = true;
    HorizontalStretch = true;
    HorizontalShrink = true;

    /// <summary>Raised when the scripts are loaded. AL answers with Init().</summary>
    event ControlAddInReady();
    /// <summary>Raised after Init() has rendered the UI.</summary>
    event AddInFrameReady();
    /// <summary>Raised when rows are pasted or dropped. Payload: { rows: [[text]], firstRowHeader: bool }.</summary>
    event OnDataPasted(Payload: JsonObject);
    /// <summary>Raised by the mapper after RequestImport(). See README for the ImportSet shape.</summary>
    event OnImportRequested(ImportSet: JsonObject);
    /// <summary>Raised when the JavaScript error boundary catches an error.</summary>
    event OnError(ErrorText: Text);
    /// <summary>Mapper: save the current mapping as a named template. { name, links: [{ fieldNo, header }], defaults: [{ fieldNo, value }] }.</summary>
    event OnSaveTemplate(Template: JsonObject);
    /// <summary>Mapper: delete a template the current user saved.</summary>
    event OnDeleteTemplate(TemplateId: Integer);

    /// <summary>Config: { mode: 'paste' | 'mapper', target: table caption, maxRows: integer }.</summary>
    procedure Init(Config: JsonObject);
    /// <summary>Re-renders the current view.</summary>
    procedure Refresh();
    /// <summary>Mapper only. Payload: { fields, fixed, saved, paste }.</summary>
    procedure LoadData(Payload: JsonObject);
    /// <summary>Mapper only. Errors: [{ row, message }].</summary>
    procedure ShowRowErrors(Errors: JsonArray);
    /// <summary>Mapper only. Asks the add-in to send the mapping and rows through OnImportRequested.</summary>
    procedure RequestImport();
    /// <summary>Shows a status line under the paste zone or mapper.</summary>
    procedure SetStatus(StatusText: Text; IsError: Boolean);
    /// <summary>Mapper: refreshed template list after a save or delete. { templates: [...], selectedId: integer }.</summary>
    procedure LoadTemplates(Payload: JsonObject);
}
