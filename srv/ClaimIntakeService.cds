@protocol: 'rest'
@path    : '/api/intake'
@impl    : 'srv/ClaimIntakeService.ts'
service ClaimIntakeService {

  type AttachmentInput {
    filename  : String(255) not null;
    mediaType : String(100) not null;
    content   : LargeBinary not null;
  }

  type EvaluationRunInput {
    model             : String(50);
    inputPredictModel : String(50);
  }

  // Submit a new claim from an external insurer system.
  // At least one of rawText or attachments must be provided.
  // The Structure Agent will extract structured fields; no pre-structured data is expected.
  //
  // Optional run configuration controls the multi-model pipeline:
  //   predictModels — which predict models run in parallel (default: sap-rpt-1-large + gbc)
  //   evaluations   — which LLMs evaluate, each paired to one prediction (isolated tracks)
  //   actualFraud   — optional ground-truth label for demo/labeled cases
  // Returns the generated claim ID and initial status.
  action submitClaim(
    externalRef    : String(100),
    rawText        : LargeString,
    attachments    : array of AttachmentInput,
    predictModels  : array of String,
    evaluations    : array of EvaluationRunInput,
    actualFraud    : Boolean
  ) returns {
    ID     : UUID;
    status : String(20);
  };
}
