using ClaimService as service from '../../srv/ClaimService';

// ─── List Report ─────────────────────────────────────────────────────────────

annotate service.Claims with @(
  Common.SideEffects #mailCreated: {
      SourceEvents : [
          'ClaimCreated',
      ],
      TargetEntities : [
          '/ClaimService.EntityContainer/Claims'
      ]
  },
  Common.SideEffects #mailChanged: {
      SourceEvents : [
          'ClaimChanged'
      ],
      TargetProperties : [
          '*',
      ],
      TargetEntities : [
          'attachments',
          'structuredData',
          'structuredData/fields',
          'predictions',
          'evaluations'
      ]
  },
  UI.SelectionFields: [ status_code, claimType_code, riskLevelProprietary, riskLevelOpenSource ],
  UI.LineItem: [
    // The "Submit Claim" toolbar button is a custom action (manifest
    // controlConfiguration -> @UI.LineItem -> actions) backed by the
    // ListReportExt controller extension, since Fiori Elements cannot
    // auto-generate a parameter dialog for an unbound action.
    { $Type: 'UI.DataField', Value: externalRef,           Label: '{i18n>ExternalRef}' },
    { $Type: 'UI.DataField', Value: title,                 Label: '{i18n>ClaimTitle}' },
    { $Type: 'UI.DataField', Value: claimType.name,        Label: '{i18n>ClaimType}' },
    { $Type: 'UI.DataField', Value: claimAmount,           Label: '{i18n>ClaimAmount}' },
    // Side-by-side comparison: proprietary vs custom/open-source tracks
    { $Type: 'UI.DataField', Value: fraudScoreProprietary, Label: '{i18n>FraudScoreProprietary}' },
    { $Type: 'UI.DataField', Value: fraudScoreCustom,      Label: '{i18n>FraudScoreCustom}' },
    { $Type: 'UI.DataField', Value: riskLevelProprietary,  Label: '{i18n>RiskLevelProprietary}' },
    { $Type: 'UI.DataField', Value: riskLevelOpenSource,   Label: '{i18n>RiskLevelOpenSource}' },
    { $Type: 'UI.DataField', Value: actualFraud,           Label: '{i18n>ActualFraud}' },
    { $Type: 'UI.DataField', Value: status.name,           Label: '{i18n>Status}', Criticality: status.criticality,
        ![@UI.Importance] : #High, },
    { $Type: 'UI.DataField', Value: createdAt,             Label: '{i18n>CreatedAt}',
        ![@UI.Importance] : #High, }
  ],
    UI.SelectionPresentationVariant #table : {
        $Type : 'UI.SelectionPresentationVariantType',
        PresentationVariant : {
            $Type : 'UI.PresentationVariantType',
            Visualizations : [
                '@UI.LineItem',
            ],
            SortOrder : [
                {
                    $Type : 'Common.SortOrderType',
                    Property : createdAt,
                    Descending : true,
                },
            ],
        },
        SelectionVariant : {
            $Type : 'UI.SelectionVariantType',
            SelectOptions : [
            ],
        },
    },
);

// ─── Object Page Header ───────────────────────────────────────────────────────

annotate service.Claims with @(
  UI.HeaderInfo: {
    TypeName:       '{i18n>Claim}',
    TypeNamePlural: '{i18n>Claims}',
    Title:          { Value: title },
    // Short identifier in the header — the full narrative lives in General Information.
    Description:    { Value: externalRef }
  },
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status',          ID: 'StatusHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#FraudScoreProp',   ID: 'FraudScorePropHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#FraudScoreCustom', ID: 'FraudScoreCustomHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#RiskProp',         ID: 'RiskPropHeader' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#RiskOSS',          ID: 'RiskOSSHeader' }
  ],
  UI.DataPoint#Status: {
    Value:       status.name,
    Title:       '{i18n>Status}',
    Criticality: status.criticality
  },
  UI.DataPoint#FraudScoreProp: {
    Value: fraudScoreProprietary,
    Title: '{i18n>FraudScoreProprietary}'
  },
  UI.DataPoint#FraudScoreCustom: {
    Value: fraudScoreCustom,
    Title: '{i18n>FraudScoreCustom}'
  },
  UI.DataPoint#RiskProp: {
    Value: riskLevelProprietary,
    Title: '{i18n>RiskLevelProprietary}'
  },
  UI.DataPoint#RiskOSS: {
    Value: riskLevelOpenSource,
    Title: '{i18n>RiskLevelOpenSource}'
  }
);

// ─── Object Page Actions (analyst review only) ────────────────────────────────

annotate service.Claims with @(
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.Claims_approveClaim', Label: '{i18n>ApproveClaim}' },
    { $Type: 'UI.DataFieldForAction', Action: 'ClaimService.Claims_flagClaim',    Label: '{i18n>FlagClaim}' }
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
      $Type:  'UI.CollectionFacet',
      Label:  '{i18n>DocumentsAndStructure}',
      ID:     'DocumentsStructureFacet',
      Facets: [
        {
          $Type:  'UI.ReferenceFacet',
          Label:  '{i18n>Attachments}',
          Target: 'attachments/@UI.LineItem',
          ID:     'AttachmentsSubFacet'
        },
        {
          $Type:  'UI.ReferenceFacet',
          Label:  '{i18n>ExtractionSummary}',
          Target: 'structuredData/@UI.FieldGroup#StructuredDataGroup',
          ID:     'StructuredDataSummarySubFacet'
        },
        {
          $Type:  'UI.ReferenceFacet',
          Label:  '{i18n>ExtractedFields}',
          Target: 'structuredData/fields/@UI.LineItem',
          ID:     'ExtractedFieldsSubFacet'
        }
      ]
    },
    {
      $Type:  'UI.CollectionFacet',
      Label:  '{i18n>ModelComparison}',
      ID:     'ModelComparisonFacet',
      Facets: [
        {
          $Type:  'UI.ReferenceFacet',
          Label:  '{i18n>Predictions}',
          Target: 'predictions/@UI.LineItem',
          ID:     'PredictionsSubFacet'
        },
        {
          $Type:  'UI.ReferenceFacet',
          Label:  '{i18n>Evaluations}',
          Target: 'evaluations/@UI.LineItem',
          ID:     'EvaluationsSubFacet'
        }
      ]
    }
  ],
  UI.FieldGroup#General: {
    Label: '{i18n>ClaimDetails}',
    Data: [
      { $Type: 'UI.DataField', Value: externalRef,    Label: '{i18n>ExternalRef}' },
      { $Type: 'UI.DataField', Value: description,    Label: '{i18n>Description}' },
      { $Type: 'UI.DataField', Value: claimType_code, Label: '{i18n>ClaimType}' },
      { $Type: 'UI.DataField', Value: claimAmount,    Label: '{i18n>ClaimAmount}' },
      { $Type: 'UI.DataField', Value: currency_code,  Label: '{i18n>Currency}' },
      { $Type: 'UI.DataField', Value: actualFraud,    Label: '{i18n>ActualFraud}' },
      { $Type: 'UI.DataField', Value: reviewNotes,    Label: '{i18n>ReviewNotes}' },
      { $Type: 'UI.DataField', Value: rejectionReason, Label: '{i18n>RejectionReason}' }
    ]
  }
);

// ─── Predictions Sub-Entity (one row per predict model — comparison table) ─────

annotate service.Predictions with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: track,          Label: '{i18n>Track}' },
    { $Type: 'UI.DataField', Value: modelName,      Label: '{i18n>Model}' },
    { $Type: 'UI.DataField', Value: fraudScore,     Label: '{i18n>FraudScore}' },
    { $Type: 'UI.DataField', Value: predictedClass, Label: '{i18n>PredictedClass}' },
    { $Type: 'UI.DataField', Value: status,         Label: '{i18n>RunStatus}' }
  ],
  UI.PresentationVariant: {
    MaxItems: 10,
    Visualizations: ['@UI.LineItem']
  }
);

// ─── Evaluations Sub-Entity (one row per evaluate model — comparison table) ────

annotate service.Evaluations with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: track,                     Label: '{i18n>Track}' },
    { $Type: 'UI.DataField', Value: modelName,                 Label: '{i18n>Model}' },
    { $Type: 'UI.DataField', Value: basedOnPrediction.modelName, Label: '{i18n>InputPrediction}' },
    { $Type: 'UI.DataField', Value: riskLevel,                 Label: '{i18n>RiskLevel}' },
    { $Type: 'UI.DataField', Value: fraudProbability,          Label: '{i18n>FraudProbability}' },
    { $Type: 'UI.DataField', Value: fraudDecision,             Label: '{i18n>FraudDecision}', Criticality: decisionCriticality },
    { $Type: 'UI.DataField', Value: status,                    Label: '{i18n>RunStatus}' }
  ],
  UI.PresentationVariant: {
    MaxItems: 10,
    Visualizations: ['@UI.LineItem']
  },
  UI.FieldGroup#EvaluationDetail: {
    Label: '{i18n>AIEvaluation}',
    Data: [
      { $Type: 'UI.DataField', Value: modelName,      Label: '{i18n>Model}' },
      { $Type: 'UI.DataField', Value: riskLevel,      Label: '{i18n>RiskLevel}' },
      { $Type: 'UI.DataField', Value: summary,        Label: '{i18n>Summary}' },
      { $Type: 'UI.DataField', Value: recommendation, Label: '{i18n>Recommendation}' }
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
      { $Type: 'UI.DataField', Value: extractionConfidence, Label: '{i18n>ConfidenceScore}' },
      { $Type: 'UI.DataField', Value: totalTokens,          Label: '{i18n>TotalTokens}' }
    ]
  }
);

annotate service.StructuredData with {
  rawExtraction @UI.Hidden;
  promptTokens  @UI.Hidden;
  completionTokens @UI.Hidden;
  description   @UI.Hidden;
};

annotate service.StructuredDataFields with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: fieldName,  Label: '{i18n>FieldName}' },
    { $Type: 'UI.DataField', Value: fieldValue, Label: '{i18n>FieldValue}' }
  ],
  UI.PresentationVariant: {
    MaxItems: 15,
    Visualizations: ['@UI.LineItem']
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
