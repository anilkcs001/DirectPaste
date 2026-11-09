/// <summary>
/// Generic engine behind Direct Paste. Works on any table through RecordRef:
///   - builds the field metadata the mapper shows
///   - dry-runs every pasted row (real insert with triggers, then rolled back) to collect errors
///   - inserts the rows for real, committing every 100 records
///   - saves and loads the per-user mapping
/// The host page supplies the target table and "context" fields (for example Document Type and
/// Document No. of the current Sales Header). Context fields are set on every row and hidden from mapping.
/// </summary>
codeunit 87300 "AML Direct Paste Mgt."
{
    Access = Public;
    Permissions = tabledata "AML Direct Paste Field Map" = RIMD,
                  tabledata "AML Direct Paste Template" = RIMD,
                  tabledata "AML Direct Paste Template Line" = RIMD;

    var
        TooLongErr: Label '%1: the value is longer than %2 characters.', Comment = '%1 = field caption, %2 = maximum length';
        InvalidValueErr: Label '%1: ''%2'' is not a valid value.', Comment = '%1 = field caption, %2 = pasted value';
        UnknownOptionErr: Label '%1: ''%2'' is not a valid option. Use one of: %3', Comment = '%1 = field caption, %2 = pasted value, %3 = list of options';
        FieldNotAllowedErr: Label 'Field %1 cannot be imported with Direct Paste.', Comment = '%1 = field number';
        AutoNumberTxt: Label 'Automatic (steps of 10000)';
        TemplateNameErr: Label 'Give the template a name.';
        NotYourTemplateErr: Label 'Template %1 was saved by %2. Only that user can delete it here; an administrator can delete it on the Direct Paste Templates page.', Comment = '%1 = template name, %2 = user ID';
        FieldValueTxt: Label '%1 ''%2''', Comment = '%1 = field caption, %2 = value being validated';
        LastFieldText: Text;
        RowErrorTxt: Label '%1: %2', Comment = '%1 = field caption and value, %2 = error message', Locked = true;

    /// <summary>Adds one field of RecRef to the context dictionary that the host page passes to Direct Paste.</summary>
    procedure AddContextField(var Context: Dictionary of [Integer, Text]; var RecRef: RecordRef; FieldNo: Integer)
    var
        FldRef: FieldRef;
    begin
        FldRef := RecRef.Field(FieldNo);
        if FldRef.Type = FieldType::Option then
            Context.Set(FieldNo, Format(FldRef.Value)) // option caption; applied back through SetOptionValue
        else
            Context.Set(FieldNo, Format(FldRef.Value, 0, 9));
    end;

    /// <summary>Everything the mapper needs: importable fields, fixed context values, saved mapping and the pasted rows.</summary>
    procedure BuildMapperPayload(TableNo: Integer; Context: Dictionary of [Integer, Text]; PastePayload: JsonObject) Payload: JsonObject
    begin
        Payload.Add('fields', BuildFieldsJson(TableNo, Context));
        Payload.Add('fixed', BuildFixedJson(TableNo, Context));
        Payload.Add('saved', BuildSavedMapJson(TableNo));
        Payload.Add('templates', BuildTemplatesJson(TableNo));
        Payload.Add('paste', PastePayload.Clone());
    end;

    /// <summary>All templates for the table: [{ id, name, createdBy, mine, useCount, lines: [{ fieldNo, header, defaultValue }] }].</summary>
    procedure BuildTemplatesJson(TableNo: Integer) TemplatesJson: JsonArray
    var
        Template: Record "AML Direct Paste Template";
    begin
        Template.SetCurrentKey("Table No.", Name);
        Template.SetRange("Table No.", TableNo);
        if Template.FindSet() then
            repeat
                TemplatesJson.Add(TemplateToJson(Template));
            until Template.Next() = 0;
    end;

    procedure CountTemplates(TableNo: Integer): Integer
    var
        Template: Record "AML Direct Paste Template";
    begin
        Template.SetRange("Table No.", TableNo);
        exit(Template.Count());
    end;

    /// <summary>
    /// Saves a template from the mapper: { name, links: [{ fieldNo, header }], defaults: [{ fieldNo, value }] }.
    /// A template with the same name for the same table is overwritten. Returns its Entry No.
    /// </summary>
    procedure SaveTemplate(TableNo: Integer; Context: Dictionary of [Integer, Text]; TemplateJson: JsonObject): Integer
    var
        Template: Record "AML Direct Paste Template";
        TemplateLine: Record "AML Direct Paste Template Line";
        Token: JsonToken;
        Item: JsonToken;
        TemplateName: Text[100];
        AutoNoFieldNo: Integer;
        FieldNo: Integer;
    begin
        TemplateName := CopyStr(DelChr(GetJsonText(TemplateJson, 'name'), '<>', ' '), 1, MaxStrLen(TemplateName));
        if TemplateName = '' then
            Error(TemplateNameErr);
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);

        Template.SetRange("Table No.", TableNo);
        Template.SetRange(Name, TemplateName);
        if not Template.FindFirst() then begin
            Template.Init();
            Template."Table No." := TableNo;
            Template.Name := TemplateName;
            Template.Insert(true);
        end;
        TemplateLine.SetRange("Template Entry No.", Template."Entry No.");
        TemplateLine.DeleteAll();

        if TemplateJson.Get('links', Token) then
            foreach Item in Token.AsArray() do begin
                FieldNo := GetJsonInt(Item.AsObject(), 'fieldNo');
                CheckFieldAllowed(TableNo, FieldNo, Context, AutoNoFieldNo);
                SetTemplateLine(Template, FieldNo, GetJsonText(Item.AsObject(), 'header'), false);
            end;
        if TemplateJson.Get('defaults', Token) then
            foreach Item in Token.AsArray() do begin
                FieldNo := GetJsonInt(Item.AsObject(), 'fieldNo');
                CheckFieldAllowed(TableNo, FieldNo, Context, AutoNoFieldNo);
                SetTemplateLine(Template, FieldNo, GetJsonText(Item.AsObject(), 'value'), true);
            end;
        exit(Template."Entry No.");
    end;

    /// <summary>Deletes a template. Only the user who saved it can delete it from the mapper; others use the Templates list page.</summary>
    procedure DeleteTemplate(TableNo: Integer; TemplateId: Integer)
    var
        Template: Record "AML Direct Paste Template";
    begin
        if not Template.Get(TemplateId) then
            exit;
        if Template."Table No." <> TableNo then
            exit;
        if Template."Created By" <> CopyStr(UserId(), 1, MaxStrLen(Template."Created By")) then
            Error(NotYourTemplateErr, Template.Name, Template."Created By");
        Template.Delete(true);
    end;

    /// <summary>Counts a use of the template named in the ImportSet ("templateId"), if any.</summary>
    procedure MarkTemplateUsed(ImportSet: JsonObject)
    var
        Template: Record "AML Direct Paste Template";
        TemplateId: Integer;
    begin
        TemplateId := GetJsonInt(ImportSet, 'templateId');
        if TemplateId = 0 then
            exit;
        if not Template.Get(TemplateId) then
            exit;
        Template."Use Count" += 1;
        Template."Last Used At" := CurrentDateTime();
        Template.Modify();
    end;

    local procedure SetTemplateLine(var Template: Record "AML Direct Paste Template"; FieldNo: Integer; ValueText: Text; IsDefault: Boolean)
    var
        TemplateLine: Record "AML Direct Paste Template Line";
    begin
        if not TemplateLine.Get(Template."Entry No.", FieldNo) then begin
            TemplateLine.Init();
            TemplateLine."Template Entry No." := Template."Entry No.";
            TemplateLine."Field No." := FieldNo;
            TemplateLine."Table No." := Template."Table No.";
            TemplateLine.Insert();
        end;
        if IsDefault then
            TemplateLine."Default Value" := CopyStr(ValueText, 1, MaxStrLen(TemplateLine."Default Value"))
        else
            TemplateLine."Source Header" := CopyStr(ValueText, 1, MaxStrLen(TemplateLine."Source Header"));
        TemplateLine.Modify();
    end;

    local procedure TemplateToJson(var Template: Record "AML Direct Paste Template") Item: JsonObject
    var
        TemplateLine: Record "AML Direct Paste Template Line";
        Lines: JsonArray;
    begin
        Item.Add('id', Template."Entry No.");
        Item.Add('name', Template.Name);
        Item.Add('createdBy', Template."Created By");
        Item.Add('mine', Template."Created By" = CopyStr(UserId(), 1, MaxStrLen(Template."Created By")));
        Item.Add('useCount', Template."Use Count");
        TemplateLine.SetRange("Template Entry No.", Template."Entry No.");
        if TemplateLine.FindSet() then
            repeat
                Lines.Add(TemplateLineToJson(TemplateLine));
            until TemplateLine.Next() = 0;
        Item.Add('lines', Lines);
    end;

    local procedure TemplateLineToJson(var TemplateLine: Record "AML Direct Paste Template Line") Item: JsonObject
    begin
        Item.Add('fieldNo', TemplateLine."Field No.");
        Item.Add('header', TemplateLine."Source Header");
        Item.Add('defaultValue', TemplateLine."Default Value");
    end;

    /// <summary>
    /// Runs every row through the full insert (Validate + Insert(true)) inside its own Codeunit.Run and rolls it back.
    /// Returns true when all rows pass. Errors: [{ row, message }], at most 200.
    /// </summary>
    procedure DryRun(TableNo: Integer; Context: Dictionary of [Integer, Text]; ImportSet: JsonObject; var Errors: JsonArray): Boolean
    var
        RowCheck: Codeunit "AML Direct Paste Row Check";
        Rows: JsonArray;
        RowToken: JsonToken;
        Links: List of [Integer];
        Defaults: Dictionary of [Integer, Text];
        Values: Dictionary of [Integer, Text];
        FieldOrder: List of [Integer];
        AutoNoFieldNo: Integer;
        NextAutoNo: Integer;
        RowNo: Integer;
    begin
        ReadImportSet(TableNo, Context, ImportSet, Links, Defaults, Rows);
        BuildFieldOrder(TableNo, Links, Defaults, FieldOrder);
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);
        if AutoNoFieldNo <> 0 then
            NextAutoNo := GetNextAutoNo(TableNo, Context, AutoNoFieldNo);

        foreach RowToken in Rows do begin
            ReadRow(RowToken.AsObject(), Links, Defaults, RowNo, Values);
            Clear(RowCheck);
            RowCheck.SetRow(TableNo, Context, FieldOrder, Values, AutoNoFieldNo, NextAutoNo);
            ClearLastError();
            if not RowCheck.Run() then
                if not RowCheck.IsDryRunSuccess(GetLastErrorText()) then begin
                    Errors.Add(ErrorItem(RowNo, FormatRowError(RowCheck.GetLastFieldText(), GetLastErrorText())));
                    if Errors.Count() >= 200 then
                        exit(false);
                end;
            NextAutoNo += 10000;
        end;
        exit(Errors.Count() = 0);
    end;

    /// <summary>Inserts all rows for real. Commits every 100 records. Returns the number of records inserted.</summary>
    procedure Import(TableNo: Integer; Context: Dictionary of [Integer, Text]; ImportSet: JsonObject) InsertedCount: Integer
    var
        RecRef: RecordRef;
        Rows: JsonArray;
        RowToken: JsonToken;
        Links: List of [Integer];
        Defaults: Dictionary of [Integer, Text];
        Values: Dictionary of [Integer, Text];
        FieldOrder: List of [Integer];
        AutoNoFieldNo: Integer;
        NextAutoNo: Integer;
        RowNo: Integer;
    begin
        ReadImportSet(TableNo, Context, ImportSet, Links, Defaults, Rows);
        BuildFieldOrder(TableNo, Links, Defaults, FieldOrder);
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);
        if AutoNoFieldNo <> 0 then
            NextAutoNo := GetNextAutoNo(TableNo, Context, AutoNoFieldNo);

        foreach RowToken in Rows do begin
            ReadRow(RowToken.AsObject(), Links, Defaults, RowNo, Values);
            RecRef.Open(TableNo);
            ProcessRow(RecRef, Context, FieldOrder, Values, AutoNoFieldNo, NextAutoNo);
            RecRef.Close();
            NextAutoNo += 10000;
            InsertedCount += 1;
            if InsertedCount mod 100 = 0 then
                Commit();
        end;
    end;

    /// <summary>Replaces the current user's saved mapping and defaults for the table with the ones in ImportSet.</summary>
    procedure SaveMapping(TableNo: Integer; ImportSet: JsonObject)
    var
        FieldMap: Record "AML Direct Paste Field Map";
        Token: JsonToken;
        Item: JsonToken;
        CurrUserId: Code[50];
    begin
        CurrUserId := CopyStr(UserId(), 1, MaxStrLen(CurrUserId));
        FieldMap.SetRange("User ID", CurrUserId);
        FieldMap.SetRange("Table No.", TableNo);
        FieldMap.DeleteAll();

        if ImportSet.Get('links', Token) then
            foreach Item in Token.AsArray() do
                SetMapLine(CurrUserId, TableNo, GetJsonInt(Item.AsObject(), 'fieldNo'), GetJsonText(Item.AsObject(), 'header'), false);
        if ImportSet.Get('defaults', Token) then
            foreach Item in Token.AsArray() do
                SetMapLine(CurrUserId, TableNo, GetJsonInt(Item.AsObject(), 'fieldNo'), GetJsonText(Item.AsObject(), 'value'), true);
    end;

    procedure IsRememberRequested(ImportSet: JsonObject): Boolean
    var
        Token: JsonToken;
    begin
        if ImportSet.Get('remember', Token) then
            if Token.IsValue() then
                exit(Token.AsValue().AsBoolean());
        exit(false);
    end;

    procedure GetTableCaption(TableNo: Integer): Text
    var
        AllObjWithCaption: Record AllObjWithCaption;
    begin
        if AllObjWithCaption.Get(AllObjWithCaption."Object Type"::Table, TableNo) then
            exit(AllObjWithCaption."Object Caption");
        exit(Format(TableNo));
    end;

    /// <summary>Builds and inserts one record. Called by Import and, for the dry run, by "AML Direct Paste Row Check".</summary>
    internal procedure ProcessRow(var RecRef: RecordRef; Context: Dictionary of [Integer, Text]; FieldOrder: List of [Integer]; Values: Dictionary of [Integer, Text]; AutoNoFieldNo: Integer; AutoNoValue: Integer)
    var
        FldRef: FieldRef;
        FieldNo: Integer;
        ValueText: Text;
    begin
        LastFieldText := '';
        RecRef.Init();
        foreach FieldNo in Context.Keys() do
            ApplyRaw(RecRef, FieldNo, Context.Get(FieldNo));
        if AutoNoFieldNo <> 0 then begin
            FldRef := RecRef.Field(AutoNoFieldNo);
            FldRef.Value := AutoNoValue;
        end;
        foreach FieldNo in FieldOrder do
            if Values.Get(FieldNo, ValueText) then
                ApplyAndValidate(RecRef, FieldNo, ValueText);
        LastFieldText := ''; // an Insert error is not caused by one field
        RecRef.Insert(true);
    end;

    /// <summary>The field and value validated last, so a dry-run error can say which cell caused it.</summary>
    internal procedure GetLastFieldText(): Text
    begin
        exit(LastFieldText);
    end;

    local procedure ApplyRaw(var RecRef: RecordRef; FieldNo: Integer; ValueText: Text)
    var
        FldRef: FieldRef;
    begin
        FldRef := RecRef.Field(FieldNo);
        if FldRef.Type = FieldType::Option then
            SetOptionValue(FldRef, ValueText)
        else
            if not Evaluate(FldRef, ValueText, 9) then
                Error(InvalidValueErr, FldRef.Caption, ValueText);
    end;

    local procedure ApplyAndValidate(var RecRef: RecordRef; FieldNo: Integer; ValueText: Text)
    var
        FldRef: FieldRef;
    begin
        FldRef := RecRef.Field(FieldNo);
        LastFieldText := StrSubstNo(FieldValueTxt, FldRef.Caption, ValueText);
        case FldRef.Type of
            FieldType::Code, FieldType::Text:
                begin
                    if StrLen(ValueText) > FldRef.Length then
                        Error(TooLongErr, FldRef.Caption, FldRef.Length);
                    if FldRef.Type = FieldType::Code then
                        ValueText := UpperCase(ValueText);
                    FldRef.Value := ValueText;
                end;
            FieldType::Option:
                SetOptionValue(FldRef, ValueText);
            else
                // The add-in sends dates, numbers, booleans and times in XML format (format 9).
                if not Evaluate(FldRef, ValueText, 9) then
                    Error(InvalidValueErr, FldRef.Caption, ValueText);
        end;
        FldRef.Validate();
    end;

    /// <summary>Matches the text against option names and captions (case-insensitive). Works for options and enums.</summary>
    local procedure SetOptionValue(var FldRef: FieldRef; ValueText: Text)
    var
        Wanted: Text;
        OptionIndex: Integer;
        OptCount: Integer;
        CaptionCount: Integer;
        i: Integer;
    begin
        Wanted := LowerCase(DelChr(ValueText, '<>', ' '));
        OptCount := OptionCount(FldRef.OptionMembers);
        CaptionCount := OptionCount(FldRef.OptionCaption);
        for i := 1 to OptCount do
            if OptionIndex = 0 then
                if Wanted = LowerCase(DelChr(SelectStr(i, FldRef.OptionMembers), '<>', ' ')) then
                    OptionIndex := i
                else
                    // Separate if: AL does not short-circuit, and a caption may contain a comma.
                    if i <= CaptionCount then
                        if Wanted = LowerCase(DelChr(SelectStr(i, FldRef.OptionCaption), '<>', ' ')) then
                            OptionIndex := i;
        if OptionIndex = 0 then
            Error(UnknownOptionErr, FldRef.Caption, ValueText, FldRef.OptionCaption);
        if FldRef.IsEnum() then
            FldRef.Value := FldRef.GetEnumValueOrdinal(OptionIndex)
        else
            FldRef.Value := OptionIndex - 1;
    end;

    local procedure OptionCount(OptionString: Text): Integer
    begin
        exit(StrLen(OptionString) - StrLen(DelChr(OptionString, '=', ',')) + 1);
    end;

    local procedure ReadImportSet(TableNo: Integer; Context: Dictionary of [Integer, Text]; ImportSet: JsonObject; var Links: List of [Integer]; var Defaults: Dictionary of [Integer, Text]; var Rows: JsonArray)
    var
        Token: JsonToken;
        Item: JsonToken;
        FieldNo: Integer;
        AutoNoFieldNo: Integer;
    begin
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);
        if ImportSet.Get('links', Token) then
            foreach Item in Token.AsArray() do begin
                FieldNo := GetJsonInt(Item.AsObject(), 'fieldNo');
                CheckFieldAllowed(TableNo, FieldNo, Context, AutoNoFieldNo);
                Links.Add(FieldNo);
            end;
        if ImportSet.Get('defaults', Token) then
            foreach Item in Token.AsArray() do begin
                FieldNo := GetJsonInt(Item.AsObject(), 'fieldNo');
                CheckFieldAllowed(TableNo, FieldNo, Context, AutoNoFieldNo);
                Defaults.Set(FieldNo, GetJsonText(Item.AsObject(), 'value'));
            end;
        if ImportSet.Get('rows', Token) then
            Rows := Token.AsArray();
    end;

    /// <summary>Values for one row: defaults first, then non-blank pasted cells override them.</summary>
    local procedure ReadRow(RowObj: JsonObject; Links: List of [Integer]; Defaults: Dictionary of [Integer, Text]; var RowNo: Integer; var Values: Dictionary of [Integer, Text])
    var
        Token: JsonToken;
        Cells: JsonArray;
        FieldNo: Integer;
        CellText: Text;
        i: Integer;
    begin
        Clear(Values);
        foreach FieldNo in Defaults.Keys() do
            Values.Add(FieldNo, Defaults.Get(FieldNo));
        RowNo := GetJsonInt(RowObj, 'n');
        if not RowObj.Get('v', Token) then
            exit;
        Cells := Token.AsArray();
        for i := 1 to Links.Count() do
            if Cells.Get(i - 1, Token) then begin
                CellText := Token.AsValue().AsText();
                if CellText <> '' then
                    Values.Set(Links.Get(i), CellText);
            end;
    end;

    /// <summary>
    /// Validation order: key fields in key order, then every other field by ascending field number
    /// (on Sales/Purchase Line: Type 5 before No. 6 before Location Code 7 before Quantity 15).
    /// Sorted here explicitly rather than relying on the order the Field table returns.
    /// </summary>
    local procedure BuildFieldOrder(TableNo: Integer; Links: List of [Integer]; Defaults: Dictionary of [Integer, Text]; var FieldOrder: List of [Integer])
    var
        KeyFieldNos: List of [Integer];
        OtherFieldNos: List of [Integer];
        FieldNo: Integer;
    begin
        GetPrimaryKeyFieldNos(TableNo, KeyFieldNos);
        foreach FieldNo in KeyFieldNos do
            if Links.Contains(FieldNo) or Defaults.ContainsKey(FieldNo) then
                FieldOrder.Add(FieldNo);
        foreach FieldNo in Links do
            if not KeyFieldNos.Contains(FieldNo) and not OtherFieldNos.Contains(FieldNo) then
                OtherFieldNos.Add(FieldNo);
        foreach FieldNo in Defaults.Keys() do
            if not KeyFieldNos.Contains(FieldNo) and not OtherFieldNos.Contains(FieldNo) then
                OtherFieldNos.Add(FieldNo);
        SortAscending(OtherFieldNos);
        FieldOrder.AddRange(OtherFieldNos);
    end;

    local procedure SortAscending(var Numbers: List of [Integer])
    var
        i: Integer;
        j: Integer;
        Current: Integer;
        Shifting: Boolean;
    begin
        // Insertion sort: lists here are a few dozen field numbers at most.
        // AL evaluates both sides of 'and', so the bounds check and Get(j) must be separate statements.
        for i := 2 to Numbers.Count() do begin
            Current := Numbers.Get(i);
            j := i - 1;
            Shifting := true;
            while Shifting do
                if j < 1 then
                    Shifting := false
                else
                    if Numbers.Get(j) > Current then begin
                        Numbers.Set(j + 1, Numbers.Get(j));
                        j -= 1;
                    end else
                        Shifting := false;
            Numbers.Set(j + 1, Current);
        end;
    end;

    local procedure BuildFieldsJson(TableNo: Integer; Context: Dictionary of [Integer, Text]) FieldsJson: JsonArray
    var
        Field: Record Field;
        RecRef: RecordRef;
        KeyFieldNos: List of [Integer];
        FieldNo: Integer;
        AutoNoFieldNo: Integer;
    begin
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);
        GetPrimaryKeyFieldNos(TableNo, KeyFieldNos);
        RecRef.Open(TableNo);

        foreach FieldNo in KeyFieldNos do
            if Field.Get(TableNo, FieldNo) then
                if IsMappable(Field, Context, AutoNoFieldNo) then
                    FieldsJson.Add(FieldToJson(RecRef, Field, true));

        Field.SetRange(TableNo, TableNo);
        Field.SetRange(IsPartOfPrimaryKey, false);
        if Field.FindSet() then
            repeat
                if IsMappable(Field, Context, AutoNoFieldNo) then
                    FieldsJson.Add(FieldToJson(RecRef, Field, false));
            until Field.Next() = 0;
        RecRef.Close();
    end;

    local procedure FieldToJson(var RecRef: RecordRef; var Field: Record Field; IsKey: Boolean) FieldJson: JsonObject
    var
        FldRef: FieldRef;
        Options: JsonArray;
        OptionCaptions: Text;
        i: Integer;
    begin
        FldRef := RecRef.Field(Field."No.");
        FieldJson.Add('no', Field."No.");
        FieldJson.Add('name', Field.FieldName);
        FieldJson.Add('caption', FldRef.Caption);
        FieldJson.Add('type', GetTypeCode(Field));
        FieldJson.Add('len', Field.Len);
        FieldJson.Add('pk', IsKey);
        if Field.Type = Field.Type::Option then begin
            OptionCaptions := FldRef.OptionCaption;
            for i := 1 to OptionCount(OptionCaptions) do
                Options.Add(SelectStr(i, OptionCaptions));
            FieldJson.Add('options', Options);
        end;
    end;

    local procedure BuildFixedJson(TableNo: Integer; Context: Dictionary of [Integer, Text]) FixedJson: JsonArray
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        FieldNo: Integer;
        AutoNoFieldNo: Integer;
    begin
        RecRef.Open(TableNo);
        RecRef.Init();
        foreach FieldNo in Context.Keys() do begin
            ApplyRaw(RecRef, FieldNo, Context.Get(FieldNo));
            FldRef := RecRef.Field(FieldNo);
            FixedJson.Add(FixedItem(FldRef.Caption, Format(FldRef.Value)));
        end;
        AutoNoFieldNo := GetAutoNumberFieldNo(TableNo, Context);
        if AutoNoFieldNo <> 0 then begin
            FldRef := RecRef.Field(AutoNoFieldNo);
            FixedJson.Add(FixedItem(FldRef.Caption, AutoNumberTxt));
        end;
        RecRef.Close();
    end;

    local procedure BuildSavedMapJson(TableNo: Integer) SavedJson: JsonArray
    var
        FieldMap: Record "AML Direct Paste Field Map";
    begin
        FieldMap.SetRange("User ID", CopyStr(UserId(), 1, MaxStrLen(FieldMap."User ID")));
        FieldMap.SetRange("Table No.", TableNo);
        if FieldMap.FindSet() then
            repeat
                SavedJson.Add(SavedItem(FieldMap));
            until FieldMap.Next() = 0;
    end;

    local procedure SetMapLine(UserIdCode: Code[50]; TableNo: Integer; FieldNo: Integer; ValueText: Text; IsDefault: Boolean)
    var
        FieldMap: Record "AML Direct Paste Field Map";
    begin
        if not FieldMap.Get(UserIdCode, TableNo, FieldNo) then begin
            FieldMap.Init();
            FieldMap."User ID" := UserIdCode;
            FieldMap."Table No." := TableNo;
            FieldMap."Field No." := FieldNo;
            FieldMap.Insert();
        end;
        if IsDefault then
            FieldMap."Default Value" := CopyStr(ValueText, 1, MaxStrLen(FieldMap."Default Value"))
        else
            FieldMap."Source Header" := CopyStr(ValueText, 1, MaxStrLen(FieldMap."Source Header"));
        FieldMap.Modify();
    end;

    local procedure IsMappable(var Field: Record Field; Context: Dictionary of [Integer, Text]; AutoNoFieldNo: Integer): Boolean
    begin
        if Context.ContainsKey(Field."No.") or (Field."No." = AutoNoFieldNo) then
            exit(false);
        if (Field.Class <> Field.Class::Normal) or (not Field.Enabled) or (Field.ObsoleteState <> Field.ObsoleteState::No) then
            exit(false);
        if Field."No." >= 2000000000 then
            exit(false);
        exit(not (Field.Type in [Field.Type::BLOB, Field.Type::Media, Field.Type::MediaSet, Field.Type::RecordID, Field.Type::TableFilter]));
    end;

    local procedure CheckFieldAllowed(TableNo: Integer; FieldNo: Integer; Context: Dictionary of [Integer, Text]; AutoNoFieldNo: Integer)
    var
        Field: Record Field;
    begin
        if not Field.Get(TableNo, FieldNo) then
            Error(FieldNotAllowedErr, FieldNo);
        if not IsMappable(Field, Context, AutoNoFieldNo) then
            Error(FieldNotAllowedErr, FieldNo);
    end;

    local procedure GetPrimaryKeyFieldNos(TableNo: Integer; var KeyFieldNos: List of [Integer])
    var
        RecRef: RecordRef;
        KeyRef: KeyRef;
        i: Integer;
    begin
        RecRef.Open(TableNo);
        KeyRef := RecRef.KeyIndex(1);
        for i := 1 to KeyRef.FieldCount() do
            KeyFieldNos.Add(KeyRef.FieldIndex(i).Number());
        RecRef.Close();
    end;

    /// <summary>The last primary-key field, when it is an Integer that the host does not supply (Line No., Entry No.).</summary>
    local procedure GetAutoNumberFieldNo(TableNo: Integer; Context: Dictionary of [Integer, Text]): Integer
    var
        RecRef: RecordRef;
        KeyRef: KeyRef;
        FldRef: FieldRef;
    begin
        RecRef.Open(TableNo);
        KeyRef := RecRef.KeyIndex(1);
        FldRef := KeyRef.FieldIndex(KeyRef.FieldCount());
        if (FldRef.Type = FieldType::Integer) and not Context.ContainsKey(FldRef.Number) then
            exit(FldRef.Number);
        exit(0);
    end;

    /// <summary>Last existing value + 10000 within the context (for example the last Line No. of this document).</summary>
    local procedure GetNextAutoNo(TableNo: Integer; Context: Dictionary of [Integer, Text]; AutoNoFieldNo: Integer): Integer
    var
        RecRef: RecordRef;
        KeyRef: KeyRef;
        FldRef: FieldRef;
        KeyFieldNo: Integer;
        LastValue: Integer;
        i: Integer;
    begin
        RecRef.Open(TableNo);
        KeyRef := RecRef.KeyIndex(1);
        for i := 1 to KeyRef.FieldCount() - 1 do begin
            KeyFieldNo := KeyRef.FieldIndex(i).Number();
            if Context.ContainsKey(KeyFieldNo) then begin
                ApplyRaw(RecRef, KeyFieldNo, Context.Get(KeyFieldNo));
                FldRef := RecRef.Field(KeyFieldNo);
                FldRef.SetRange(FldRef.Value);
            end;
        end;
        if RecRef.FindLast() then begin
            LastValue := RecRef.Field(AutoNoFieldNo).Value;
            exit(LastValue + 10000);
        end;
        exit(10000);
    end;

    local procedure GetTypeCode(var Field: Record Field): Text
    begin
        case Field.Type of
            Field.Type::Code:
                exit('code');
            Field.Type::Text:
                exit('text');
            Field.Type::Decimal:
                exit('decimal');
            Field.Type::Integer:
                exit('integer');
            Field.Type::BigInteger:
                exit('biginteger');
            Field.Type::Date:
                exit('date');
            Field.Type::Time:
                exit('time');
            Field.Type::DateTime:
                exit('datetime');
            Field.Type::Boolean:
                exit('boolean');
            Field.Type::Option:
                exit('option');
            Field.Type::Duration:
                exit('duration');
            Field.Type::GUID:
                exit('guid');
            Field.Type::DateFormula:
                exit('dateformula');
        end;
        exit('other');
    end;

    local procedure FixedItem(Caption: Text; ValueText: Text) Item: JsonObject
    begin
        Item.Add('caption', Caption);
        Item.Add('value', ValueText);
    end;

    local procedure SavedItem(var FieldMap: Record "AML Direct Paste Field Map") Item: JsonObject
    begin
        Item.Add('fieldNo', FieldMap."Field No.");
        Item.Add('header', FieldMap."Source Header");
        Item.Add('defaultValue', FieldMap."Default Value");
    end;

    local procedure FormatRowError(FieldText: Text; ErrorText: Text): Text
    begin
        if FieldText = '' then
            exit(ErrorText);
        exit(StrSubstNo(RowErrorTxt, FieldText, ErrorText));
    end;

    local procedure ErrorItem(RowNo: Integer; ErrorText: Text) Item: JsonObject
    begin
        Item.Add('row', RowNo);
        Item.Add('message', ErrorText);
    end;

    local procedure GetJsonInt(Obj: JsonObject; KeyName: Text): Integer
    var
        Token: JsonToken;
    begin
        if Obj.Get(KeyName, Token) then
            if Token.IsValue() then
                if not Token.AsValue().IsNull() then
                    exit(Token.AsValue().AsInteger());
        exit(0);
    end;

    local procedure GetJsonText(Obj: JsonObject; KeyName: Text): Text
    var
        Token: JsonToken;
    begin
        if Obj.Get(KeyName, Token) then
            if Token.IsValue() then
                if not Token.AsValue().IsNull() then
                    exit(Token.AsValue().AsText());
        exit('');
    end;
}
