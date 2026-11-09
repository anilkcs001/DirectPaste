/// <summary>Field lines of a Magic Paste template.</summary>
page 87304 "AML Magic Paste Template Lines"
{
    PageType = ListPart;
    Caption = 'Fields';
    SourceTable = "AML Magic Paste Template Line";
    InsertAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Field No."; Rec."Field No.")
                {
                    ApplicationArea = All;
                    Editable = false;
                    ToolTip = 'Specifies the field number in the target table.';
                }
                field("Field Caption"; Rec."Field Caption")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the field in the target table.';
                }
                field("Source Header"; Rec."Source Header")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the pasted column header that fills this field.';
                }
                field("Default Value"; Rec."Default Value")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the value used when there is no column or the cell is blank. Dates as yyyy-mm-dd, decimals with a dot, Yes/No as true/false.';
                }
            }
        }
    }
}
