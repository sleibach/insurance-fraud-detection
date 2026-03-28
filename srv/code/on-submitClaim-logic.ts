import cds from '@sap/cds';
import type { SubmitClaimData, SubmitClaimResult } from '../types';

const LOGGER = cds.log('on-submitClaim');

export default async function (req: cds.Request): Promise<SubmitClaimResult> {
  const { externalRef, rawText, attachments = [] } = req.data as SubmitClaimData;

  LOGGER.info('Claim intake received', { externalRef, hasText: !!rawText?.trim(), attachmentCount: attachments.length });

  // At least one of rawText or attachments is required
  if (!rawText?.trim() && attachments.length === 0) {
    return req.reject(400, 'SUBMIT_REQUIRES_TEXT_OR_ATTACHMENT');
  }

  const { Claims, Attachments } = cds.entities('ClaimService');
  const ID = cds.utils.uuid();

  // Create the claim with raw unstructured input only.
  // Structured fields (title, claimAmount, currency, claimType) are filled in
  // by the Structure Agent in the next pipeline step.
  await INSERT.into(Claims).entries({
    ID,
    externalRef,
    rawText: rawText?.trim() || null,
    status_code: 'new'
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

  return { ID, status: 'structuring' };
};
