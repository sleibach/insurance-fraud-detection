using ClaimService as service from '../../srv/ClaimService';

// ─── List Report ─────────────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.SelectionFields: [ status_code, claimType_code, evaluation.riskLevel ],
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: externalRef,           Label: '{i18n>ExternalRef}' },
    { $Type: 'UI.DataField', Value: title,                 Label: '{i18n>ClaimTitle}' },
    { $Type: 'UI.DataField', Value: claimType.name,        Label: '{i18n>ClaimType}' },
    { $Type: 'UI.DataField', Value: claimAmount,           Label: '{i18n>ClaimAmount}' },
    { $Type: 'UI.DataField', Value: prediction.fraudScore, Label: '{i18n>FraudScore}' },
    { $Type: 'UI.DataField', Value: evaluation.riskLevel,  Label: '{i18n>RiskLevel}' },
    { $Type: 'UI.DataField', Value: status.name,           Label: '{i18n>Status}', Criticality: status.criticality },
    { $Type: 'UI.DataField', Value: createdAt,             Label: '{i18n>CreatedAt}' }
  ]
);

// ─── Object Page Header ───────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.HeaderInfo: {
    TypeName:       '{i18n>Claim}',
    TypeNamePlural: '{i18n>Claims}',
    Title:          { Value: title },
    Description:    { Value: status.name }
  },
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status',     ID: 'StatusHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Amount',     ID: 'AmountHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#FraudScore', ID: 'FraudScoreHeader' }
  ],
  UI.DataPoint#Status: {
    Value:       status.name,
    Title:       '{i18n>Status}',
    Criticality: status.criticality
  },
  UI.DataPoint#Amount: {
    Value: claimAmount,
    Title: '{i18n>ClaimAmount}'
  },
  UI.DataPoint#FraudScore: {
    Value: prediction.fraudScore,
    Title: '{i18n>FraudScore}'
  }
);

// ─── Object Page Actions (analyst review only) ────────────────────────────────

annotate service.Claims with @(
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.approveClaim', Label: '{i18n>ApproveClaim}' },
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.flagClaim',    Label: '{i18n>FlagClaim}' }
  ]
);

// ─── Object Page Facets ───────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  '{i18n>GeneralInformation}',
      Target: '@UI.FieldGroup#General',
      ID:     'GeneralFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  '{i18n>Attachments}',
      Target: 'attachments/@UI.LineItem',
      ID:     'AttachmentsFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  '{i18n>StructuredData}',
      Target: 'structuredData/@UI.FieldGroup#StructuredDataGroup',
      ID:     'StructuredDataFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  '{i18n>AIAnalysis}',
      Target: '@UI.FieldGroup#AIAnalysis',
      ID:     'AIAnalysisFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  '{i18n>ReviewDecision}',
      Target: '@UI.FieldGroup#Review',
      ID:     'ReviewFacet'
    }
  ],
  UI.FieldGroup#General: {
    Label: '{i18n>ClaimDetails}',
    Data: [
      { $Type: 'UI.DataField', Value: externalRef,    Label: '{i18n>ExternalRef}' },
      { $Type: 'UI.DataField', Value: title,          Label: '{i18n>ClaimTitle}' },
      { $Type: 'UI.DataField', Value: description,    Label: '{i18n>Description}' },
      { $Type: 'UI.DataField', Value: claimType_code, Label: '{i18n>ClaimType}' },
      { $Type: 'UI.DataField', Value: claimAmount,    Label: '{i18n>ClaimAmount}' },
      { $Type: 'UI.DataField', Value: currency_code,  Label: '{i18n>Currency}' },
      { $Type: 'UI.DataField', Value: status_code,    Label: '{i18n>Status}', Criticality: status.criticality }
    ]
  },
  UI.FieldGroup#AIAnalysis: {
    Label: '{i18n>AIEvaluation}',
    Data: [
      { $Type: 'UI.DataField', Value: evaluation.riskLevel,      Label: '{i18n>RiskLevel}' },
      { $Type: 'UI.DataField', Value: evaluation.summary,        Label: '{i18n>Summary}' },
      { $Type: 'UI.DataField', Value: evaluation.recommendation, Label: '{i18n>Recommendation}' },
      { $Type: 'UI.DataField', Value: prediction.fraudScore,     Label: '{i18n>FraudScore}' },
      { $Type: 'UI.DataField', Value: prediction.modelVersion,   Label: '{i18n>Model}' }
    ]
  },
  UI.FieldGroup#Review: {
    Label: '{i18n>ReviewDecision}',
    Data: [
      { $Type: 'UI.DataField', Value: reviewNotes, Label: '{i18n>ReviewNotes}' }
    ]
  }
);

// ─── Attachments Sub-Entity ───────────────────────────────────────────────────

annotate service.Attachments with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: filename,  Label: '{i18n>FileName}' },
    { $Type: 'UI.DataField', Value: mediaType, Label: '{i18n>MediaType}' },
    { $Type: 'UI.DataField', Value: createdAt, Label: '{i18n>Uploaded}' }
  ]
);

// ─── StructuredData Sub-Entity ────────────────────────────────────────────────

annotate service.StructuredData with @(
  UI.FieldGroup#StructuredDataGroup: {
    Label: '{i18n>ExtractedFields}',
    Data: [
      { $Type: 'UI.DataField', Value: claimType,            Label: '{i18n>ExtractedClaimType}' },
      { $Type: 'UI.DataField', Value: incidentDate,         Label: '{i18n>IncidentDate}' },
      { $Type: 'UI.DataField', Value: claimAmount,          Label: '{i18n>ExtractedAmount}' },
      { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>ConfidenceScore}' }
    ]
  }
);

// ─── Value Help ───────────────────────────────────────────────────────────────

annotate service.Claims with {
  status @(
    Common.ValueListWithFixedValues: true,
    Common.ValueList: {
      CollectionPath: 'ClaimStatuses',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',      LocalDataProperty: status_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly',                                ValueListProperty: 'name' }
      ]
    }
  );
  claimType @(
    Common.ValueListWithFixedValues: true,
    Common.ValueList: {
      CollectionPath: 'ClaimTypes',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',      LocalDataProperty: claimType_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly',                                   ValueListProperty: 'name' }
      ]
    }
  );
};

// ─── Text Annotations (show label instead of code in UI) ─────────────────────

annotate service.Claims with {
  status    @Common.Text: status.name    @Common.TextArrangement: #TextOnly;
  claimType @Common.Text: claimType.name @Common.TextArrangement: #TextOnly;
};
