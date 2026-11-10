/// <summary>
/// A named, company-wide Direct Paste template for one target table:
/// which pasted headers feed which fields, plus default values (lines in "AK Direct Paste Template Line").
/// </summary>
table 87301 "AK Direct Paste Template"
{
    Caption = 'Direct Paste Template';
    DataClassification = CustomerContent;
    LookupPageId = "AK Direct Paste Templates";
    DrillDownPageId = "AK Direct Paste Templates";

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            Editable = false;
        }
        field(2; "Table No."; Integer)
        {
            Caption = 'Table No.';
            Editable = false;
        }
        field(3; "Table Caption"; Text[249])
        {
            Caption = 'Table';
            FieldClass = FlowField;
            CalcFormula = lookup(AllObjWithCaption."Object Caption" where("Object Type" = const(Table), "Object ID" = field("Table No.")));
            Editable = false;
        }
        field(4; Name; Text[100])
        {
            Caption = 'Name';
            NotBlank = true;
        }
        field(5; "Created By"; Code[50])
        {
            Caption = 'Created By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
        field(6; "Use Count"; Integer)
        {
            Caption = 'Times Used';
            Editable = false;
        }
        field(7; "Last Used At"; DateTime)
        {
            Caption = 'Last Used At';
            Editable = false;
        }
        field(8; "No. of Lines"; Integer)
        {
            Caption = 'No. of Fields';
            FieldClass = FlowField;
            CalcFormula = count("AK Direct Paste Template Line" where("Template Entry No." = field("Entry No.")));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(TableName; "Table No.", Name)
        {
        }
    }

    trigger OnInsert()
    begin
        if "Created By" = '' then
            "Created By" := CopyStr(UserId(), 1, MaxStrLen("Created By"));
    end;

    trigger OnDelete()
    var
        TemplateLine: Record "AK Direct Paste Template Line";
    begin
        TemplateLine.SetRange("Template Entry No.", "Entry No.");
        TemplateLine.DeleteAll();
    end;
}
