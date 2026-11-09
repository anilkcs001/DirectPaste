/// <summary>
/// Magic Paste mapper dialog. Shows the drag-to-link mapper, defaults and preview.
/// OK asks the add-in for the mapping (RequestImport), dry-runs every row, and only when all rows
/// pass inserts them and closes. If any row fails, the errors are shown and the dialog stays open.
/// </summary>
page 87301 "AML Magic Paste Mapper"
{
    PageType = StandardDialog;
    Caption = 'Magic Paste';
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            usercontrol(MagicPaste; "AML Magic Paste Mapper")
            {
                ApplicationArea = All;

                trigger ControlAddInReady()
                begin
                    InitAddIn();
                end;

                trigger AddInFrameReady()
                begin
                    CurrPage.MagicPaste.LoadData(MagicPasteMgt.BuildMapperPayload(TargetTableNo, Context, PastePayload));
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
                    SavedId := MagicPasteMgt.SaveTemplate(TargetTableNo, Context, Template);
                    Commit(); // the dry run later needs no open write transaction
                    SendTemplates(SavedId, TemplateSavedMsg);
                end;

                trigger OnDeleteTemplate(TemplateId: Integer)
                begin
                    MagicPasteMgt.DeleteTemplate(TargetTableNo, TemplateId);
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
        CurrPage.Caption := StrSubstNo(PageCaptionTxt, MagicPasteMgt.GetTableCaption(TargetTableNo));
    end;

    trigger OnQueryClosePage(CloseAction: Action): Boolean
    begin
        if (CloseAction = Action::OK) and not ImportDone then begin
            // The add-in answers through OnImportRequested; RunImport closes the page when the import succeeds.
            CurrPage.MagicPaste.RequestImport();
            exit(false);
        end;
        exit(true);
    end;

    var
        MagicPasteMgt: Codeunit "AML Magic Paste Mgt.";
        Context: Dictionary of [Integer, Text];
        PastePayload: JsonObject;
        TargetTableNo: Integer;
        InsertedCount: Integer;
        ImportDone: Boolean;
        NoTargetErr: Label 'Magic Paste needs a target table. Call SetData before opening the mapper.';
        PageCaptionTxt: Label 'Magic Paste - %1', Comment = '%1 = table caption';
        AddInErrorMsg: Label 'Magic Paste: %1', Comment = '%1 = error text from the add-in';
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
        Config.Add('target', MagicPasteMgt.GetTableCaption(TargetTableNo));
        Config.Add('maxRows', 5000);
        CurrPage.MagicPaste.Init(Config);
    end;

    local procedure SendTemplates(SelectedId: Integer; StatusText: Text)
    var
        Payload: JsonObject;
    begin
        Payload.Add('templates', MagicPasteMgt.BuildTemplatesJson(TargetTableNo));
        Payload.Add('selectedId', SelectedId);
        Payload.Add('status', StatusText);
        CurrPage.MagicPaste.LoadTemplates(Payload);
    end;

    local procedure RunImport(ImportSet: JsonObject)
    var
        Errors: JsonArray;
    begin
        if not MagicPasteMgt.DryRun(TargetTableNo, Context, ImportSet, Errors) then begin
            CurrPage.MagicPaste.ShowRowErrors(Errors);
            exit;
        end;
        InsertedCount := MagicPasteMgt.Import(TargetTableNo, Context, ImportSet);
        if MagicPasteMgt.IsRememberRequested(ImportSet) then
            MagicPasteMgt.SaveMapping(TargetTableNo, ImportSet);
        MagicPasteMgt.MarkTemplateUsed(ImportSet);
        ImportDone := true;
        CurrPage.Close();
    end;
}
