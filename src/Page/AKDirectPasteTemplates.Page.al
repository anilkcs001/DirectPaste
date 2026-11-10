/// <summary>Company-wide list of Direct Paste templates. Rename, review or delete them here.</summary>
page 87302 "AK Direct Paste Templates"
{
    PageType = List;
    Caption = 'Direct Paste Templates';
    SourceTable = "AK Direct Paste Template";
    UsageCategory = Lists;
    ApplicationArea = All;
    InsertAllowed = false;
    CardPageId = "AK Direct Paste Template";

    layout
    {
        area(Content)
        {
            repeater(Templates)
            {
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
                field("No. of Lines"; Rec."No. of Lines")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies how many fields the template links or defaults.';
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
                field("Created By"; Rec."Created By")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies who saved the template.';
                }
            }
        }
    }
}
