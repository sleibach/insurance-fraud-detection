'use strict';
const cds = require('@sap/cds');
const LOGGER = cds.log('claims-on-approveClaim');

module.exports = async function (req) {
  const { ID, notes } = req.data;

  LOGGER.info('Analyst approving claim', { claimId: ID });

  const { Claims } = cds.entities('ClaimService');

  const claim = await SELECT.one.from(Claims).where({ ID });
  if (!claim)                            return req.reject(404, 'CLAIM_NOT_FOUND');
  if (claim.status_code !== 'evaluated') return req.reject(409, 'CLAIM_NOT_READY_FOR_REVIEW');

  await UPDATE(Claims)
    .set({ status_code: 'approved', reviewNotes: notes || null })
    .where({ ID });

  LOGGER.info('Claim approved', { claimId: ID });

  return SELECT.one.from(Claims).where({ ID });
};
