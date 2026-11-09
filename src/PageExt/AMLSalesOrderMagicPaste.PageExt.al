/// <summary>
/// Example host: Magic Paste on the Sales Order adds Sales Lines to the current order.
/// Copy this pattern to wire Magic Paste onto any other page:
///   1. add the FactBox part
///   2. in OnAfterGetCurrRecord, call SetContext(target table, fields the header fixes)
///   3. optionally add the action, which opens the mapper directly and refreshes the page afterwards
/// </summary>
pageextension 87300 "AML Sales Order Magic Paste" extends "Sales Order"
{
    layout
    {
        addfirst(factboxes)
        {
            part(AMLMagicPaste; "AML Magic Paste FactBox")
            {
                ApplicationArea = All;
                Caption = 'Magic Paste';
            }
        }
    }

    actions
    {
        addlast(processing)
        {
            action(AMLMagicPasteLines)
            {
                ApplicationArea = All;
                Caption = 'Magic Paste Lines';
                ToolTip = 'Paste rows copied from Excel, map the columns to sales line fields and add them to this order.';
                Image = Import;

                trigger OnAction()
                var
                    Mapper: Page "AML Magic Paste Mapper";
                    EmptyPaste: JsonObject;
                    Context: Dictionary of [Integer, Text];
                begin
                    CurrPage.SaveRecord();
                    GetMagicPasteContext(Context);
                    Mapper.SetData(Database::"Sales Line", Context, EmptyPaste);
                    Mapper.RunModal();
                    if Mapper.GetInsertedCount() > 0 then
                        CurrPage.Update(false);
                end;
            }
        }
    }

    trigger OnAfterGetCurrRecord()
    var
        Context: Dictionary of [Integer, Text];
    begin
        GetMagicPasteContext(Context);
        CurrPage.AMLMagicPaste.Page.SetContext(Database::"Sales Line", Context);
    end;

    local procedure GetMagicPasteContext(var Context: Dictionary of [Integer, Text])
    var
        SalesLine: Record "Sales Line";
        MagicPasteMgt: Codeunit "AML Magic Paste Mgt.";
        RecRef: RecordRef;
    begin
        SalesLine."Document Type" := Rec."Document Type";
        SalesLine."Document No." := Rec."No.";
        RecRef.GetTable(SalesLine);
        MagicPasteMgt.AddContextField(Context, RecRef, SalesLine.FieldNo("Document Type"));
        MagicPasteMgt.AddContextField(Context, RecRef, SalesLine.FieldNo("Document No."));
    end;
}
