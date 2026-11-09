/// <summary>
/// Example host: Direct Paste on the Sales Order adds Sales Lines to the current order.
/// Copy this pattern to wire Direct Paste onto any other page:
///   1. add the FactBox part
///   2. in OnAfterGetCurrRecord, call SetContext(target table, fields the header fixes)
///   3. optionally add the action, which opens the mapper directly and refreshes the page afterwards
/// </summary>
pageextension 87300 "AML Sales Order Direct Paste" extends "Sales Order"
{
    layout
    {
        addfirst(factboxes)
        {
            part(AMLDirectPaste; "AML Direct Paste FactBox")
            {
                ApplicationArea = All;
                Caption = 'Direct Paste';
            }
        }
    }

    actions
    {
        addlast(processing)
        {
            action(AMLDirectPasteLines)
            {
                ApplicationArea = All;
                Caption = 'Direct Paste Lines';
                ToolTip = 'Paste rows copied from Excel, map the columns to sales line fields and add them to this order.';
                Image = Import;

                trigger OnAction()
                var
                    Mapper: Page "AML Direct Paste Mapper";
                    EmptyPaste: JsonObject;
                    Context: Dictionary of [Integer, Text];
                begin
                    CurrPage.SaveRecord();
                    GetDirectPasteContext(Context);
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
        GetDirectPasteContext(Context);
        CurrPage.AMLDirectPaste.Page.SetContext(Database::"Sales Line", Context);
    end;

    local procedure GetDirectPasteContext(var Context: Dictionary of [Integer, Text])
    var
        SalesLine: Record "Sales Line";
        DirectPasteMgt: Codeunit "AML Direct Paste Mgt.";
        RecRef: RecordRef;
    begin
        SalesLine."Document Type" := Rec."Document Type";
        SalesLine."Document No." := Rec."No.";
        RecRef.GetTable(SalesLine);
        DirectPasteMgt.AddContextField(Context, RecRef, SalesLine.FieldNo("Document Type"));
        DirectPasteMgt.AddContextField(Context, RecRef, SalesLine.FieldNo("Document No."));
    end;
}
