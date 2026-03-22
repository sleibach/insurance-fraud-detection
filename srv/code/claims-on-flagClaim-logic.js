'use strict';
const cds = require('@sap/cds');
const LOGGER = cds.log('claims-on-flagClaim');

module.exports = async function (req) {
  const { ID } = req.params[0];
  const { reason } = req.data;

  LOGGER.info('Analyst flagging claim', { claimId: ID });

  const { Claims } = cds.entities('ClaimService');

  const claim = await SELECT.one.from(Claims).where({ ID });
  if (!claim)                            return req.reject(404, 'CLAIM_NOT_FOUND');
  if (claim.status_code !== 'evaluated') return req.reject(409, 'CLAIM_NOT_READY_FOR_REVIEW');
  if (!reason?.trim())                   return req.reject(400, 'FLAG_REASON_REQUIRED');

  await UPDATE(Claims)
    .set({ status_code: 'flagged', reviewNotes: reason.trim() })
    .where({ ID });

  LOGGER.info('Claim flagged as suspected fraud', { claimId: ID, reason: reason.trim() });

  return SELECT.one.from(Claims).where({ ID });
};
