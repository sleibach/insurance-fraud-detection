using { fraud as db } from '../db/schema';

@Common.WebSocketBaseURL : 'ws/WebSocketService'
@Common.WebSocketChannel #sideEffects : 'claimCreated, claimChanged'
@path    : '/service/ClaimService'
@requires: 'authenticated-user'
@impl    : 'srv/ClaimService.ts'
service ClaimService {

  // ─── Read-only monitoring entities ───────────────────────────────────────────

  @readonly entity Claims               as projection on db.Claims;
  @readonly entity Attachments          as projection on db.Attachments;
  @readonly entity StructuredData       as projection on db.StructuredData;
  @readonly entity StructuredDataFields as projection on db.StructuredDataFields;
  @readonly entity Predictions          as projection on db.Predictions;
  @readonly entity Evaluations          as projection on db.Evaluations;
  @readonly entity ModelRunConfig       as projection on db.ModelRunConfig;

  // ─── Fraud training/validation/test data (seeded from fraud_oracle.csv) ──────
  // One set of entities per claim type. Add a parallel FraudXxxTrainingData entity
  // and a matching entry in TRAINING_ENTITY_BY_TYPE (on-predictFraud-logic.ts)
  // to support a new claim type.

  @readonly entity FraudAutoTrainingData   as projection on db.FraudAutoTrainingData;
  @readonly entity FraudAutoValidationData as projection on db.FraudAutoValidationData;
  @readonly entity FraudAutoTestData       as projection on db.FraudAutoTestData;

  // ─── Review actions (bound to Claims, executed by fraud analysts) ─────────────

  action Claims.approveClaim(ID : UUID not null, notes  : String(2000)) returns Claims;
  action Claims.flagClaim   (ID : UUID not null, reason : String(2000)) returns Claims;

  // ─── Intake action (unbound, surfaced on the List Report toolbar) ─────────────
  // Lets analysts submit a claim narrative and/or attachments directly from the UI.
  // The custom Submit-Claim dialog renders an advanced "Pipeline Configuration"
  // panel and a FileUploader for claim documents / damage photos.
  type AttachmentInput {
    filename  : String(255) not null;
    mediaType : String(100) not null;
    content   : LargeBinary not null;
  }
  type EvaluationRunInput {
    model             : String(50);
    inputPredictModel : String(50);
  }
  action submitClaim(
    externalRef    : String(100),
    rawText        : LargeString,
    actualFraud    : Boolean,
    attachments    : array of AttachmentInput,
    predictModels  : array of String,
    evaluations    : array of EvaluationRunInput
  ) returns {
    ID     : UUID;
    status : String(20);
  };

  // ─── Pipeline events (transactional event queue, scheduled by ClaimIntakeService) ──
  // Payloads carry the run configuration so the queued steps are self-contained.

  event StructureClaim { ID : UUID; predictModels : array of String; evaluations : array of EvaluationRunInput }
  event PredictFraud   { ID : UUID; predictModels : array of String; evaluations : array of EvaluationRunInput }
  event EvaluateClaim  { ID : UUID; evaluations : array of EvaluationRunInput }
}
