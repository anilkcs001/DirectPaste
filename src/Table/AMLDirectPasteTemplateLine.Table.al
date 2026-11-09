/// <summary>One field of a Direct Paste template: the pasted header that feeds it and/or its default value.</summary>
table 87302 "AML Direct Paste Template Line"
{
    Caption = 'Direct Paste Template Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Template Entry No."; Integer)
        {
            Caption = 'Template Entry No.';
            TableRelation = "AML Direct Paste Template"."Entry No.";
        }
        field(2; "Field No."; Integer)
        {
            Caption = 'Field No.';
        }
        field(3; "Field Caption"; Text[80])
        {
            Caption = 'Field';
            FieldClass = FlowField;
            CalcFormula = lookup(Field."Field Caption" where(TableNo = field("Table No."), "No." = field("Field No.")));
            Editable = false;
        }
        field(4; "Table No."; Integer)
        {
            Caption = 'Table No.';
        }
        field(10; "Source Header"; Text[250])
        {
            Caption = 'Pasted Column Header';
        }
        field(11; "Default Value"; Text[250])
        {
            Caption = 'Default Value';
        }
    }

    keys
    {
        key(PK; "Template Entry No.", "Field No.")
        {
            Clustered = true;
        }
    }
}
