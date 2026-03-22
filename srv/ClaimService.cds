using { fraud as db } from '../db/schema';

@path    : '/service/ClaimService'
@requires: 'authenticated-user'
service ClaimService {

  // ─── Read-only monitoring entities ───────────────────────────────────────────

  @readonly entity Claims         as projection on db.Claims;
  @readonly entity Attachments    as projection on db.Attachments;
  @readonly entity StructuredData as projection on db.StructuredData;
  @readonly entity Predictions    as projection on db.Predictions;
  @readonly entity Evaluations    as projection on db.Evaluations;

  // ─── Review actions (bound to Claims, executed by fraud analysts) ─────────────

  action Claims.approveClaim(ID : UUID not null, notes  : String(2000)) returns Claims;
  action Claims.flagClaim   (ID : UUID not null, reason : String(2000)) returns Claims;

  // ─── Pipeline events (transactional event queue, scheduled by ClaimIntakeService) ──

  event StructureClaim { ID : UUID }
  event PredictFraud   { ID : UUID }
  event EvaluateClaim  { ID : UUID }
}
