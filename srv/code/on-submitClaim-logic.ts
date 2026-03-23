import cds from '@sap/cds';
import type { SubmitClaimData, SubmitClaimResult } from '../types';

const LOGGER = cds.log('on-submitClaim');

export default async function (req: cds.Request): Promise<SubmitClaimResult> {
  const {
    externalRef, title, description,
    claimAmount, currency, claimType,
    attachments = []
  } = req.data as SubmitClaimData;

  LOGGER.info('Claim intake received', { externalRef, claimType, claimAmount, currency });

  // Validate required fields
  if (!title?.trim())                   return req.reject(400, 'TITLE_REQUIRED');
  if (!claimAmount || claimAmount <= 0) return req.reject(400, 'CLAIM_AMOUNT_INVALID');
  if (!claimType)                       return req.reject(400, 'CLAIM_TYPE_REQUIRED');
  if (!currency)                        return req.reject(400, 'CURRENCY_REQUIRED');

  const { Claims, Attachments } = cds.entities('ClaimService');
  const ID = cds.utils.uuid();

  // Create the claim record
  await INSERT.into(Claims).entries({
    ID,
    externalRef,
    title:          title.trim(),
    description,
    claimAmount,
    currency_code:  currency,
    claimType_code: claimType,
    status_code:    'new'
  });

  // Store attachments if provided
  if (attachments.length > 0) {
    await INSERT.into(Attachments).entries(
      attachments.map(a => ({ ...a, claim_ID: ID }))
    );
    LOGGER.debug('Attachments stored', { claimId: ID, count: attachments.length });
  }

  // Schedule first pipeline step within this transaction (at-least-once delivery)
  const ClaimService = await cds.connect.to('ClaimService');
  await cds.outboxed(ClaimService).emit('StructureClaim', { ID });

  await UPDATE(Claims).set({ status_code: 'structuring' }).where({ ID });

  LOGGER.info('Claim created, pipeline scheduled', { claimId: ID, externalRef, status: 'structuring' });

  return { ID, externalRef, status: 'structuring' };
};
