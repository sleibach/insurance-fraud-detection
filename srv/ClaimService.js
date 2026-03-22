'use strict';
const cds = require('@sap/cds');

class ClaimService extends cds.ApplicationService {
  async init() {
    const { Claims } = this.entities;

    // ── Pipeline event consumers (receive msg, not req) ───────────────────────
    this.on('StructureClaim', async (msg) => require('./code/on-structureClaim-logic')(msg));
    this.on('PredictFraud',   async (msg) => require('./code/on-predictFraud-logic')(msg));
    this.on('EvaluateClaim',  async (msg) => require('./code/on-evaluateClaim-logic')(msg));

    // ── Review actions (bound to Claims) ─────────────────────────────────────
    this.on('approveClaim', Claims, async (req) => require('./code/claims-on-approveClaim-logic')(req));
    this.on('flagClaim',    Claims, async (req) => require('./code/claims-on-flagClaim-logic')(req));

    return super.init();
  }
}

module.exports = ClaimService;
