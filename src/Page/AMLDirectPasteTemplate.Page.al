/// <summary>One Direct Paste template with its field lines.</summary>
page 87303 "AML Direct Paste Template"
{
    PageType = Card;
    Caption = 'Direct Paste Template';
    SourceTable = "AML Direct Paste Template";
    UsageCategory = None;
    InsertAllowed = false;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the template name shown in the Direct Paste mapper.';
                }
                field("Table Caption"; Rec."Table Caption")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the table the template inserts into.';
                }
                field("Created By"; Rec."Created By")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies who saved the template.';
                }
                field("Use Count"; Rec."Use Count")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies how many imports have used the template.';
                }
                field("Last Used At"; Rec."Last Used At")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies when the template was last used.';
                }
            }
            part(Lines; "AMLDirect Paste Template Lines")
            {
                ApplicationArea = All;
                SubPageLink = "Template Entry No." = field("Entry No.");
            }
        }
    }
}
