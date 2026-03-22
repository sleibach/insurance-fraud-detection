'use strict';
const cds = require('@sap/cds');

class ClaimService extends cds.ApplicationService {
  async init() {
    // ── Pipeline event consumers (receive msg, not req) ───────────────────────
    this.on('StructureClaim', async (msg) => require('./code/on-structureClaim-logic')(msg));
    this.on('PredictFraud',   async (msg) => require('./code/on-predictFraud-logic')(msg));
    this.on('EvaluateClaim',  async (msg) => require('./code/on-evaluateClaim-logic')(msg));

    // ── Review actions ────────────────────────────────────────────────────────
    this.on('Claims.approveClaim', async (req) => require('./code/claims-on-approveClaim-logic')(req));
    this.on('Claims.flagClaim',    async (req) => require('./code/claims-on-flagClaim-logic')(req));

    return super.init();
  }
}

module.exports = ClaimService;
