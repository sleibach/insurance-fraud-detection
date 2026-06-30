import cds from '@sap/cds';
import onStructureClaim from './code/on-structureClaim-logic';
import onPredictFraud   from './code/on-predictFraud-logic';
import onEvaluateClaim  from './code/on-evaluateClaim-logic';
import onApproveClaim   from './code/claims-on-approveClaim-logic';
import onFlagClaim      from './code/claims-on-flagClaim-logic';
import onSubmitClaim    from './code/on-submitClaim-logic';

class ClaimService extends cds.ApplicationService {
  async init(): Promise<void> {
    // ── Pipeline event consumers ──────────────────────────────────────────────
    this.on('StructureClaim',        onStructureClaim);
    this.on('PredictFraud',          onPredictFraud);
    this.on('EvaluateClaim',         onEvaluateClaim);

    // ── Intake action (unbound, surfaced on the List Report toolbar) ───────────
    this.on('submitClaim',           onSubmitClaim);

    // ── Review actions ────────────────────────────────────────────────────────
    this.on('Claims.approveClaim',   onApproveClaim);
    this.on('Claims.flagClaim',      onFlagClaim);

    return super.init();
  }
}

export default ClaimService;
