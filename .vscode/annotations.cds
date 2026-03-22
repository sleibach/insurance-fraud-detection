using ClaimService as service from '../../srv/ClaimService';

// ─── List Report ─────────────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.SelectionFields: [ status_code, claimType_code ],
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: title,            Label: 'Title' },
    { $Type: 'UI.DataField', Value: claimType.name,   Label: 'Type' },
    { $Type: 'UI.DataField', Value: claimAmount,      Label: 'Amount' },
    { $Type: 'UI.DataField', Value: currency_code,    Label: 'Currency' },
    { $Type: 'UI.DataField', Value: status.name,      Label: 'Status', Criticality: status.criticality },
    { $Type: 'UI.DataField', Value: createdAt,        Label: 'Created' }
  ]
);

// ─── Object Page Header ───────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.HeaderInfo: {
    TypeName:       'Claim',
    TypeNamePlural: 'Claims',
    Title:          { Value: title },
    Description:    { Value: status.name }
  },
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status', ID: 'StatusHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Amount', ID: 'AmountHeader' }
  ],
  UI.DataPoint#Status: {
    Value:       status.name,
    Title:       'Status',
    Criticality: status.criticality
  },
  UI.DataPoint#Amount: {
    Value: claimAmount,
    Title: 'Claim Amount'
  }
);

// ─── Object Page Facets ───────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'General Information',
      Target: '@UI.FieldGroup#General',
      ID:     'GeneralFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Attachments',
      Target: 'attachments/@UI.LineItem',
      ID:     'AttachmentsFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'Structured Data',
      Target: 'structuredData/@UI.FieldGroup#StructuredDataGroup',
      ID:     'StructuredDataFacet'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Label:  'AI Analysis',
      Target: '@UI.FieldGroup#AIAnalysis',
      ID:     'AIAnalysisFacet'
    }
  ],
  UI.FieldGroup#General: {
    Label: 'Claim Details',
    Data: [
      { $Type: 'UI.DataField', Value: title,          Label: 'Title' },
      { $Type: 'UI.DataField', Value: description,    Label: 'Description' },
      { $Type: 'UI.DataField', Value: claimType_code, Label: 'Claim Type' },
      { $Type: 'UI.DataField', Value: claimAmount,    Label: 'Amount' },
      { $Type: 'UI.DataField', Value: currency_code,  Label: 'Currency' },
      { $Type: 'UI.DataField', Value: status_code,    Label: 'Status', Criticality: status.criticality }
    ]
  },
  UI.FieldGroup#AIAnalysis: {
    Label: 'AI Evaluation',
    Data: [
      { $Type: 'UI.DataField', Value: evaluation.riskLevel,      Label: 'Risk Level' },
      { $Type: 'UI.DataField', Value: evaluation.summary,        Label: 'Summary' },
      { $Type: 'UI.DataField', Value: evaluation.recommendation, Label: 'Recommendation' },
      { $Type: 'UI.DataField', Value: prediction.fraudScore,     Label: 'Fraud Score (0–1)' },
      { $Type: 'UI.DataField', Value: prediction.modelVersion,   Label: 'Model' }
    ]
  }
);

// ─── Object Page Actions ──────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.structureClaim', Label: 'Extract Documents' },
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.predictFraud',   Label: 'Predict Fraud' },
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.evaluateClaim',  Label: 'Evaluate Claim' },
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.processClaim',   Label: 'Run Full Pipeline' }
  ]
);

// ─── Attachments Sub-Entity ───────────────────────────────────────────────────

annotate service.Attachments with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: filename,  Label: 'File Name' },
    { $Type: 'UI.DataField', Value: mediaType, Label: 'Type' },
    { $Type: 'UI.DataField', Value: createdAt, Label: 'Uploaded' }
  ]
);

// ─── StructuredData Sub-Entity ────────────────────────────────────────────────

annotate service.StructuredData with @(
  UI.FieldGroup#StructuredDataGroup: {
    Label: 'Extracted Fields',
    Data: [
      { $Type: 'UI.DataField', Value: claimType,            Label: 'Extracted Claim Type' },
      { $Type: 'UI.DataField', Value: incidentDate,         Label: 'Incident Date' },
      { $Type: 'UI.DataField', Value: claimAmount,          Label: 'Extracted Amount' },
      { $Type: 'UI.DataField', Value: extractionConfidence, Label: 'Confidence Score' }
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
