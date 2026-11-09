/// <summary>
/// Dry run for one pasted row. Builds and inserts the record exactly like the real import
/// (Validate on every field, Insert(true), GST/Tax Engine subscribers included), then raises a
/// known sentinel error so the platform rolls everything back.
/// The caller runs this with "if not RowCheck.Run()" and treats the sentinel as success.
/// Because every run ends in a rollback, no write transaction stays open between rows,
/// which Codeunit.Run with a return value requires.
/// </summary>
codeunit 87301 "AML Direct Paste Row Check"
{
    Access = Internal;

    trigger OnRun()
    var
        RecRef: RecordRef;
    begin
        RecRef.Open(TargetTableNo);
        DirectPasteMgt.ProcessRow(RecRef, Context, FieldOrder, Values, AutoNoFieldNo, AutoNoValue);
        Error(DryRunOkErr);
    end;

    var
        DirectPasteMgt: Codeunit "AML Direct Paste Mgt.";
        Context: Dictionary of [Integer, Text];
        FieldOrder: List of [Integer];
        Values: Dictionary of [Integer, Text];
        TargetTableNo: Integer;
        AutoNoFieldNo: Integer;
        AutoNoValue: Integer;
        DryRunOkErr: Label 'AML-Direct-PASTE-DRY-RUN-OK', Locked = true;

    procedure SetRow(NewTableNo: Integer; NewContext: Dictionary of [Integer, Text]; NewFieldOrder: List of [Integer]; NewValues: Dictionary of [Integer, Text]; NewAutoNoFieldNo: Integer; NewAutoNoValue: Integer)
    begin
        TargetTableNo := NewTableNo;
        Context := NewContext;
        FieldOrder := NewFieldOrder;
        Values := NewValues;
        AutoNoFieldNo := NewAutoNoFieldNo;
        AutoNoValue := NewAutoNoValue;
    end;

    /// <summary>Field and value that was being validated when the row failed (kept after the rollback).</summary>
    procedure GetLastFieldText(): Text
    begin
        exit(DirectPasteMgt.GetLastFieldText());
    end;

    procedure IsDryRunSuccess(LastErrorText: Text): Boolean
    begin
        exit(LastErrorText = DryRunOkErr);
    end;
}
