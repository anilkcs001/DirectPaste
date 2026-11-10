/// <summary>
/// Direct Paste mapper dialog. Shows the drag-to-link mapper, defaults and preview.
/// OK asks the add-in for the mapping (RequestImport), dry-runs every row, and only when all rows
/// pass inserts them and closes. If any row fails, the errors are shown and the dialog stays open.
/// </summary>
page 87301 "AK Direct Paste Mapper"
{
    PageType = StandardDialog;
    Caption = 'Direct Paste';
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            usercontrol(DirectPaste; "AK Direct Paste Mapper")
            {
                ApplicationArea = All;

                trigger ControlAddInReady()
                begin
                    InitAddIn();
                end;

                trigger AddInFrameReady()
                begin
                    CurrPage.DirectPaste.LoadData(DirectPasteMgt.BuildMapperPayload(TargetTableNo, Context, PastePayload));
                end;

                trigger OnImportRequested(ImportSet: JsonObject)
                begin
                    RunImport(ImportSet);
                end;

                trigger OnError(ErrorText: Text)
                begin
                    Message(AddInErrorMsg, ErrorText);
                end;

                trigger OnSaveTemplate(Template: JsonObject)
                var
                    SavedId: Integer;
                begin
                    SavedId := DirectPasteMgt.SaveTemplate(TargetTableNo, Context, Template);
                    Commit(); // the dry run later needs no open write transaction
                    SendTemplates(SavedId, TemplateSavedMsg);
                end;

                trigger OnDeleteTemplate(TemplateId: Integer)
                begin
                    DirectPasteMgt.DeleteTemplate(TargetTableNo, TemplateId);
                    Commit();
                    SendTemplates(0, TemplateDeletedMsg);
                end;
            }
        }
    }

    trigger OnOpenPage()
    begin
        if TargetTableNo = 0 then
            Error(NoTargetErr);
        CurrPage.Caption := StrSubstNo(PageCaptionTxt, DirectPasteMgt.GetTableCaption(TargetTableNo));
    end;

    trigger OnQueryClosePage(CloseAction: Action): Boolean
    begin
        if (CloseAction = Action::OK) and not ImportDone then begin
            // The add-in answers through OnImportRequested; RunImport closes the page when the import succeeds.
            CurrPage.DirectPaste.RequestImport();
            exit(false);
        end;
        exit(true);
    end;

    var
        DirectPasteMgt: Codeunit "AK Direct Paste Mgt.";
        Context: Dictionary of [Integer, Text];
        PastePayload: JsonObject;
        TargetTableNo: Integer;
        InsertedCount: Integer;
        ImportDone: Boolean;
        NoTargetErr: Label 'Direct Paste needs a target table. Call SetData before opening the mapper.';
        PageCaptionTxt: Label 'Direct Paste - %1', Comment = '%1 = table caption';
        AddInErrorMsg: Label 'Direct Paste: %1', Comment = '%1 = error text from the add-in';
        TemplateSavedMsg: Label 'Template saved. Everyone in the company can now use it.';
        TemplateDeletedMsg: Label 'Template deleted.';

    /// <summary>Target table, context fields from the host page, and the pasted rows (empty object = paste inside the dialog).</summary>
    procedure SetData(NewTableNo: Integer; NewContext: Dictionary of [Integer, Text]; NewPastePayload: JsonObject)
    var
        FieldNo: Integer;
    begin
        TargetTableNo := NewTableNo;
        Clear(Context);
        foreach FieldNo in NewContext.Keys() do
            Context.Add(FieldNo, NewContext.Get(FieldNo));
        PastePayload := NewPastePayload;
    end;

    procedure GetInsertedCount(): Integer
    begin
        exit(InsertedCount);
    end;

    local procedure InitAddIn()
    var
        Config: JsonObject;
    begin
        Config.Add('mode', 'mapper');
        Config.Add('userId', UserId());
        Config.Add('target', DirectPasteMgt.GetTableCaption(TargetTableNo));
        Config.Add('maxRows', 5000);
        CurrPage.DirectPaste.Init(Config);
    end;

    local procedure SendTemplates(SelectedId: Integer; StatusText: Text)
    var
        Payload: JsonObject;
    begin
        Payload.Add('templates', DirectPasteMgt.BuildTemplatesJson(TargetTableNo));
        Payload.Add('selectedId', SelectedId);
        Payload.Add('status', StatusText);
        CurrPage.DirectPaste.LoadTemplates(Payload);
    end;

    local procedure RunImport(ImportSet: JsonObject)
    var
        Errors: JsonArray;
    begin
        if not DirectPasteMgt.DryRun(TargetTableNo, Context, ImportSet, Errors) then begin
            CurrPage.DirectPaste.ShowRowErrors(Errors);
            exit;
        end;
        InsertedCount := DirectPasteMgt.Import(TargetTableNo, Context, ImportSet);
        if DirectPasteMgt.IsRememberRequested(ImportSet) then
            DirectPasteMgt.SaveMapping(TargetTableNo, ImportSet);
        DirectPasteMgt.MarkTemplateUsed(ImportSet);
        ImportDone := true;
        CurrPage.Close();
    end;
}
