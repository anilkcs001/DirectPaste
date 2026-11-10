/// <summary>
/// Remembered Direct Paste mapping per user and target table:
/// which pasted header feeds a field, and the default value for a field.
/// </summary>
table 87300 "AK Direct Paste Field Map"
{
    Caption = 'Direct Paste Field Map';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "User ID"; Code[50])
        {
            Caption = 'User ID';
            DataClassification = EndUserIdentifiableInformation;
        }
        field(2; "Table No."; Integer)
        {
            Caption = 'Table No.';
        }
        field(3; "Field No."; Integer)
        {
            Caption = 'Field No.';
        }
        field(10; "Source Header"; Text[250])
        {
            Caption = 'Source Header';
        }
        field(11; "Default Value"; Text[250])
        {
            Caption = 'Default Value';
        }
    }

    keys
    {
        key(PK; "User ID", "Table No.", "Field No.")
        {
            Clustered = true;
        }
    }
}
