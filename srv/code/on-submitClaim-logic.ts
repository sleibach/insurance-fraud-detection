import cds from '@sap/cds';
import type { SubmitClaimData, SubmitClaimResult } from '../types';
import { normalizeRunConfig, buildRunConfigRows } from './utils/runConfig';

const LOGGER = cds.log('on-submitClaim');

/**
 * Shared intake handler for both ClaimIntakeService.submitClaim (REST, with
 * attachments) and the unbound ClaimService.submitClaim action (UI toolbar).
 * Persists the requested run configuration (which predict/evaluate models run
 * and how they are paired) and carries it in the pipeline event payload.
 */
export default async function (req: cds.Request): Promise<SubmitClaimResult> {
  const {
    externalRef, rawText, attachments = [],
    predictModels, evaluations, actualFraud
  } = req.data as SubmitClaimData;

  LOGGER.info('Claim intake received', {
    externalRef, hasText: !!rawText?.trim(), attachmentCount: attachments.length
  });

  // At least one of rawText or attachments is required
  if (!rawText?.trim() && attachments.length === 0) {
    return req.reject(400, 'SUBMIT_REQUIRES_TEXT_OR_ATTACHMENT');
  }

  const runConfig = normalizeRunConfig({ predictModels, evaluations });
  LOGGER.debug('Resolved run configuration', {
    predictModels: runConfig.predictModels,
    evaluations: runConfig.evaluations
  });

  const { Claims, Attachments, ModelRunConfig } = cds.entities('ClaimService');
  const ID = cds.utils.uuid();

  // Create the claim with raw unstructured input only.
  // Structured fields (title, claimAmount, currency, claimType) are filled in
  // by the Structure Agent in the next pipeline step.
  await INSERT.into(Claims).entries({
    ID,
    externalRef,
    rawText: rawText?.trim() || null,
    actualFraud: actualFraud ?? null,
    status_code: 'new'
  });

  // Store attachments if provided
  if (attachments.length > 0) {
    await INSERT.into(Attachments).entries(
      attachments.map(a => ({ ...a, claim_ID: ID }))
    );
    LOGGER.debug('Attachments stored', { claimId: ID, count: attachments.length });
  }

  // Persist the requested model runs for observability + step resilience.
  await INSERT.into(ModelRunConfig).entries(buildRunConfigRows(ID, runConfig));

  // Schedule first pipeline step within this transaction (at-least-once delivery)
  const ClaimService = await cds.connect.to('ClaimService');
  await cds.outboxed(ClaimService).emit('StructureClaim', {
    ID,
    predictModels: runConfig.predictModels,
    evaluations: runConfig.evaluations
  });

  await UPDATE(Claims).set({ status_code: 'structuring' }).where({ ID });

  LOGGER.info('Claim created, pipeline scheduled', { claimId: ID, externalRef, status: 'structuring' });

  return { ID, status: 'structuring' };
};
