/// <summary>
/// Direct Paste mapper, sized for the modal dialog.
/// Same scripts, events and procedures as "AML Direct Paste"; only the requested size differs,
/// because a control add-in cannot change its own height at runtime.
/// </summary>
controladdin "AML Direct Paste Mapper"
{
    Scripts = 'ControlAddin/scripts/helper.js',
              'ControlAddin/scripts/main.js';
    StartupScript = 'ControlAddin/scripts/startup.js';
    StyleSheets = 'ControlAddin/stylesheets/style.css';

    RequestedHeight = 640;
    MinimumHeight = 480;
    RequestedWidth = 1100;
    MinimumWidth = 640;
    VerticalStretch = true;
    VerticalShrink = true;
    HorizontalStretch = true;
    HorizontalShrink = true;

    event ControlAddInReady();
    event AddInFrameReady();
    event OnDataPasted(Payload: JsonObject);
    event OnImportRequested(ImportSet: JsonObject);
    event OnError(ErrorText: Text);
    /// <summary>Mapper: save the current mapping as a named template. { name, links: [{ fieldNo, header }], defaults: [{ fieldNo, value }] }.</summary>
    event OnSaveTemplate(Template: JsonObject);
    /// <summary>Mapper: delete a template the current user saved.</summary>
    event OnDeleteTemplate(TemplateId: Integer);

    procedure Init(Config: JsonObject);
    procedure Refresh();
    procedure LoadData(Payload: JsonObject);
    procedure ShowRowErrors(Errors: JsonArray);
    procedure RequestImport();
    procedure SetStatus(StatusText: Text; IsError: Boolean);
    /// <summary>Mapper: refreshed template list after a save or delete. { templates: [...], selectedId: integer }.</summary>
    procedure LoadTemplates(Payload: JsonObject);
}
