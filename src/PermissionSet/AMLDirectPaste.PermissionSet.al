/// <summary>
/// Access to Direct Paste. Users also need their normal rights on the target tables (for example Sales Line),
/// which this permission set does not grant.
/// </summary>
permissionset 87300 "AML Direct Paste"
{
    Assignable = true;
    Caption = 'Direct Paste';

    Permissions =
        tabledata "AML Direct Paste Field Map" = RIMD,
        table "AML Direct Paste Field Map" = X,
        tabledata "AML Direct Paste Template" = RIMD,
        table "AML Direct Paste Template" = X,
        tabledata "AML Direct Paste Template Line" = RIMD,
        table "AML Direct Paste Template Line" = X,
        codeunit "AML Direct Paste Mgt." = X,
        codeunit "AML Direct Paste Row Check" = X,
        page "AML Direct Paste FactBox" = X,
        page "AML Direct Paste Mapper" = X,
        page "AML Direct Paste Templates" = X,
        page "AML Direct Paste Template" = X,
        page "AMLDirect Paste Template Lines" = X;
}
