/// <summary>
/// Access to Direct Paste. Users also need their normal rights on the target tables (for example Sales Line),
/// which this permission set does not grant.
/// </summary>
permissionset 87300 "AK Direct Paste"
{
    Assignable = true;
    Caption = 'Direct Paste';

    Permissions =
        tabledata "AK Direct Paste Field Map" = RIMD,
        table "AK Direct Paste Field Map" = X,
        tabledata "AK Direct Paste Template" = RIMD,
        table "AK Direct Paste Template" = X,
        tabledata "AK Direct Paste Template Line" = RIMD,
        table "AK Direct Paste Template Line" = X,
        codeunit "AK Direct Paste Mgt." = X,
        codeunit "AK Direct Paste Row Check" = X,
        page "AK Direct Paste FactBox" = X,
        page "AK Direct Paste Mapper" = X,
        page "AK Direct Paste Templates" = X,
        page "AK Direct Paste Template" = X,
        page "AK Direct Paste Template Lines" = X;
}
