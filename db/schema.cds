namespace fraud;
using { cuid, managed, Currency, sap } from '@sap/cds/common';

// ─── Code Lists ───────────────────────────────────────────────────────────────

@cds.autoexpose
entity ClaimTypes : sap.common.CodeList {
  key code : String(20);
}

@cds.autoexpose
entity ClaimStatuses : sap.common.CodeList {
  key code : String(20);
  @title: 'Criticality'
  criticality : Integer;
}

// ─── Core Entities ────────────────────────────────────────────────────────────

entity Claims : cuid, managed {
  @title: '{i18n>RawText}'
  rawText        : LargeString;

  @title: 'Title'
  title          : String(255);

  @title: 'Description'
  description    : localized String(5000);

  @title: 'Claim Amount'
  claimAmount    : Decimal(15, 2);

  @title: 'Currency'
  currency       : Currency;

  @title: 'Claim Type'
  claimType      : Association to ClaimTypes;

  @title: 'Status'
  status         : Association to ClaimStatuses default 'new';

  @title: '{i18n>ExternalRef}'
  externalRef    : String(100);

  @title: '{i18n>ReviewNotes}'
  reviewNotes    : String(2000);

  @title: '{i18n>RejectionReason}'
  rejectionReason: LargeString;

  lastError      : LargeString;

  @title: '{i18n>ParentClaim}'
  parentClaim    : Association to Claims;

  attachments    : Composition of many Attachments    on attachments.claim    = $self;
  structuredData : Composition of one  StructuredData on structuredData.claim = $self;
  prediction     : Composition of one  Predictions    on prediction.claim     = $self;
  evaluation     : Composition of one  Evaluations    on evaluation.claim     = $self;
}

entity Attachments : cuid, managed {
  claim     : Association to Claims;

  @title: 'Filename'
  filename  : String(255) not null;

  @title: 'Media Type'
  mediaType : String(100) not null;

  @Core.MediaType               : mediaType
  @Core.ContentDisposition.Filename: filename
  content   : LargeBinary;
}

entity StructuredData : cuid, managed {
  claim                : Association to Claims;

  @title: 'Claim Type'
  claimType            : String(50);

  @title: 'Incident Date'
  incidentDate         : Date;

  @title: 'Claim Amount'
  claimAmount          : Decimal(15, 2);

  @title: 'Description'
  description          : LargeString;

  @title: 'Extraction Confidence'
  extractionConfidence : Decimal(3, 2);

  @title: 'Raw Extraction (JSON)'
  rawExtraction        : LargeString;
}

entity Predictions : cuid, managed {
  claim               : Association to Claims;

  @title: 'Fraud Score'
  fraudScore          : Decimal(5, 4);

  @title: 'Model Version'
  modelVersion        : String(50);

  @title: 'Prediction Timestamp'
  predictionTimestamp : DateTime;
}

entity Evaluations : cuid, managed {
  claim          : Association to Claims;

  @title: 'Summary'
  summary        : LargeString;

  @title: 'Risk Level'
  riskLevel      : String(20);   // low | medium | high | critical

  @title: 'Key Factors (JSON)'
  keyFactors     : LargeString;

  @title: 'Recommendation'
  recommendation : LargeString;
}
