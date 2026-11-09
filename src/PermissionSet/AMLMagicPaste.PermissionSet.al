/// <summary>
/// Access to Magic Paste. Users also need their normal rights on the target tables (for example Sales Line),
/// which this permission set does not grant.
/// </summary>
permissionset 87300 "AML Magic Paste"
{
    Assignable = true;
    Caption = 'Magic Paste';

    Permissions =
        tabledata "AML Magic Paste Field Map" = RIMD,
        table "AML Magic Paste Field Map" = X,
        tabledata "AML Magic Paste Template" = RIMD,
        table "AML Magic Paste Template" = X,
        tabledata "AML Magic Paste Template Line" = RIMD,
        table "AML Magic Paste Template Line" = X,
        codeunit "AML Magic Paste Mgt." = X,
        codeunit "AML Magic Paste Row Check" = X,
        page "AML Magic Paste FactBox" = X,
        page "AML Magic Paste Mapper" = X,
        page "AML Magic Paste Templates" = X,
        page "AML Magic Paste Template" = X,
        page "AML Magic Paste Template Lines" = X;
}
