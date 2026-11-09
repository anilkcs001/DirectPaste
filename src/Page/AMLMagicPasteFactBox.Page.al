/// <summary>
/// Magic Paste FactBox. Shows the paste zone; a paste opens the mapper dialog.
/// The host page tells it where rows go by calling SetContext() (see "AML Sales Order Magic Paste").
/// </summary>
page 87300 "AML Magic Paste FactBox"
{
    PageType = CardPart;
    Caption = 'Magic Paste';
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            usercontrol(MagicPaste; "AML Magic Paste")
            {
                ApplicationArea = All;

                trigger ControlAddInReady()
                begin
                    AddInReady := true;
                    InitAddIn();
                end;

                trigger AddInFrameReady()
                begin
                    AddInRendered := true;
                end;

                trigger OnDataPasted(Payload: JsonObject)
                begin
                    OpenMapper(Payload);
                end;

                trigger OnError(ErrorText: Text)
                begin
                    Message(AddInErrorMsg, ErrorText);
                end;
            }
        }
    }

    var
        MagicPasteMgt: Codeunit "AML Magic Paste Mgt.";
        Context: Dictionary of [Integer, Text];
        TargetTableNo: Integer;
        AddInReady: Boolean;
        AddInRendered: Boolean;
        NotConnectedMsg: Label 'Magic Paste is not connected to a table on this page.';
        InsertedMsg: Label '%1 rows added to %2.', Comment = '%1 = number of records, %2 = table caption';
        CancelledMsg: Label 'Import cancelled. Nothing was added.';
        AddInErrorMsg: Label 'Magic Paste: %1', Comment = '%1 = error text from the add-in';

    /// <summary>Called by the host page whenever its current record changes.</summary>
    procedure SetContext(NewTableNo: Integer; NewContext: Dictionary of [Integer, Text])
    var
        FieldNo: Integer;
        TableChanged: Boolean;
    begin
        TableChanged := NewTableNo <> TargetTableNo;
        TargetTableNo := NewTableNo;
        Clear(Context);
        foreach FieldNo in NewContext.Keys() do
            Context.Add(FieldNo, NewContext.Get(FieldNo));
        if AddInReady and TableChanged then
            InitAddIn();
    end;

    local procedure InitAddIn()
    var
        Config: JsonObject;
    begin
        Config.Add('mode', 'paste');
        if TargetTableNo <> 0 then begin
            Config.Add('target', MagicPasteMgt.GetTableCaption(TargetTableNo));
            Config.Add('templateCount', MagicPasteMgt.CountTemplates(TargetTableNo));
        end else
            Config.Add('target', '');
        Config.Add('maxRows', 5000);
        CurrPage.MagicPaste.Init(Config);
    end;

    local procedure OpenMapper(Payload: JsonObject)
    var
        Mapper: Page "AML Magic Paste Mapper";
        InsertedCount: Integer;
    begin
        if TargetTableNo = 0 then begin
            CurrPage.MagicPaste.SetStatus(NotConnectedMsg, true);
            exit;
        end;
        Mapper.SetData(TargetTableNo, Context, Payload);
        Mapper.RunModal();
        InsertedCount := Mapper.GetInsertedCount();
        if InsertedCount > 0 then
            CurrPage.MagicPaste.SetStatus(StrSubstNo(InsertedMsg, InsertedCount, MagicPasteMgt.GetTableCaption(TargetTableNo)), false)
        else
            CurrPage.MagicPaste.SetStatus(CancelledMsg, false);
    end;
}
