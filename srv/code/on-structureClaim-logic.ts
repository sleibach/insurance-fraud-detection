import cds from '@sap/cds';
import { createChatClient } from './utils/aiClient';
import { loadClaimAttachments } from './utils/loadAttachments';
import type {
  ClaimRecord, AttachmentRecord,
  ExtractedClaimData, StructureAgentResult, TokenUsage, RunConfig
} from '../types';
import { loadRunConfig, buildRunConfigRows } from './utils/runConfig';

const LOGGER = cds.log('on-structureClaim');

const ZERO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Strip markdown code fences that Claude sometimes adds despite being told not to. */
function extractJson(content: string): string {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1].trim() : content.trim();
}

const VALID_CLAIM_TYPES = new Set(['auto', 'property', 'health', 'life', 'travel', 'liability']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Normalize a single extracted claim, filling in sensible defaults for any null/missing/invalid field. */
function normalizeClaim(raw: Record<string, unknown>, fallbackText?: string): ExtractedClaimData {
  const description = (typeof raw.description === 'string' && raw.description.trim())
    ? raw.description.trim()
    : (fallbackText?.trim() ?? '');

  const title = (typeof raw.title === 'string' && raw.title.trim())
    ? raw.title.trim()
    : (description.split(/[.!?\n]/)[0].slice(0, 80).trim() || 'Insurance Claim');

  const rawType = typeof raw.claimType === 'string' ? raw.claimType.toLowerCase().trim() : '';
  const claimType = VALID_CLAIM_TYPES.has(rawType) ? rawType : 'auto';

  const incidentDate = (typeof raw.incidentDate === 'string' && DATE_RE.test(raw.incidentDate))
    ? raw.incidentDate
    : new Date().toISOString().split('T')[0];

  const claimAmount = typeof raw.claimAmount === 'number' && isFinite(raw.claimAmount)
    ? raw.claimAmount
    : 0;

  const rawCurrency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  const currency = CURRENCY_RE.test(rawCurrency) ? rawCurrency : 'USD';

  const fields = Array.isArray(raw.fields)
    ? (raw.fields as Array<unknown>).filter(
        (f): f is { key: string; value: string } =>
          typeof (f as any)?.key === 'string' && typeof (f as any)?.value === 'string'
      )
    : [];

  return { title, claimType, incidentDate, claimAmount, currency, description, fields };
}

/** Flatten an error's message together with its nested `cause` chain. */
function flattenError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let guard = 0;
  while (cur && guard++ < 10) {
    const e = cur as { message?: string; cause?: unknown };
    if (e.message) parts.push(e.message);
    cur = e.cause;
  }
  return parts.join(' | ');
}

/**
 * True only for errors that indicate AI Core is not reachable / unconfigured
 * (airplane mode). Inspects the whole cause chain because the SAP AI SDK wraps
 * the real reason ("Could not find service credentials for AI Core") inside a
 * generic "Failed to fetch the list of deployments" error.
 */
function isConnectivityError(err: unknown): boolean {
  const message = flattenError(err);
  return /no service binding|binding of type|service binding|service credentials for AI ?Core|fetch the list of deployments|no deployment (matches|found)|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network.*error/i.test(message);
}

const AGENT_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'structure_agent_result',
    description: 'Agentic result: extract one claim, reject garbage, or split multiple claims',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        result: {
          type: 'string',
          enum: ['extracted', 'rejected', 'split'],
          description: '"extracted" = single claim found, "rejected" = no valid claim, "split" = multiple distinct claims'
        },
        reason: {
          type: 'string',
          description: 'Required for "rejected" (why input was rejected). Use empty string otherwise.'
        },
        claims: {
          type: 'array',
          description: 'One item for "extracted", multiple for "split", empty array for "rejected"',
          items: {
            type: 'object',
            properties: {
              title:        { type: 'string',  description: 'Short claim title' },
              claimType:    { type: 'string',  description: 'One of: auto, property, health, life, travel, liability' },
              incidentDate: { type: 'string',  description: 'YYYY-MM-DD format' },
              claimAmount:  { type: 'number',  description: 'Claimed amount as a number' },
              currency:     { type: 'string',  description: '3-letter ISO currency code, e.g. USD, EUR' },
              description:  { type: 'string',  description: 'Narrative description of the incident' },
              fields: {
                type: 'array',
                description: 'Claim-type-specific key-value pairs extracted from the submission. Keys must match the camelCase column names of the fraud training data (e.g. make, accidentArea, fault, policyType, vehicleCategory, vehiclePrice, deductible, driverRating, policeReportFiled, witnessPresent, agentType, numberOfSuppliments, addressChangeClaim, numberOfCars, basePolicy, daysPolicyAccident, daysPolicyClaim, pastNumberOfClaims, ageOfVehicle, maritalStatus, sex, age, weekOfMonth, dayOfWeek, month). Only include fields that can be reliably determined from the submission.',
                items: {
                  type: 'object',
                  properties: {
                    key:   { type: 'string', description: 'camelCase field name from the fraud training schema' },
                    value: { type: 'string', description: 'Extracted value as a string' }
                  },
                  required: ['key', 'value'],
                  additionalProperties: false
                }
              }
            },
            required: ['title', 'claimType', 'incidentDate', 'claimAmount', 'currency', 'description', 'fields'],
            additionalProperties: false
          }
        }
      },
      required: ['result', 'reason', 'claims'],
      additionalProperties: false
    }
  }
} as const;

export default async function (msg: cds.Event): Promise<void> {
  const { Claims, Attachments, StructuredData } = cds.entities('ClaimService');
  const { ID } = msg.data as { ID: string };

  const runConfig = await loadRunConfig(ID, msg.data as Record<string, unknown>);
  let tokenUsage: TokenUsage = ZERO_TOKENS;

  LOGGER.info('Starting claim structuring', { claimId: ID });

  const claim = await SELECT.one.from(Claims)
    .columns((c: any) => { c('*'); })
    .where({ ID }) as ClaimRecord;

  if (!claim) throw new Error(`Claim ${ID} not found`);

  // Load attachment binaries in a separate query — @Core.MediaType LargeBinary
  // columns are not returned via composition expand in Node.js CQL.
  const attachments = await loadClaimAttachments(Attachments, ID);

  await UPDATE(Claims).set({ status_code: 'structuring' }).where({ ID });

  try {
    let agentResult: StructureAgentResult;

    const imageAttachments = (attachments || []).filter(
      a => a.mediaType?.startsWith('image/') && a.content
    );

    try {
      LOGGER.info('Calling Structure Agent', { claimId: ID, imageCount: imageAttachments.length });

      const imageContents = imageAttachments.map(a => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${a.mediaType};base64,${Buffer.from(a.content as Buffer).toString('base64')}`
        }
      }));

      const client = createChatClient('anthropic--claude-4.6-opus');
      const response = await client.run({
        messages: [
          {
            role: 'system',
            content:
              'You are an insurance claim intake agent. Analyze the user\'s submission and respond with ONLY a JSON object — no markdown, no code blocks, no explanation.\n\n' +
              'Decide one of:\n' +
              '- "extracted": exactly one insurance claim found\n' +
              '- "rejected": not a valid insurance claim (spam, gibberish, unrelated content)\n' +
              '- "split": multiple distinct insurance claims in one submission\n\n' +
              'REQUIRED JSON STRUCTURE (respond with exactly this shape):\n' +
              '{\n' +
              '  "result": "extracted" | "rejected" | "split",\n' +
              '  "reason": "<required for rejected, empty string otherwise>",\n' +
              '  "claims": [\n' +
              '    {\n' +
              '      "title": "<short descriptive title, never null>",\n' +
              '      "claimType": "<one of: auto | property | health | life | travel | liability>",\n' +
              '      "incidentDate": "<YYYY-MM-DD, estimate today if unknown>",\n' +
              '      "claimAmount": <numeric value, use 0 if unknown>,\n' +
              '      "currency": "<3-letter ISO code, e.g. USD, EUR, GBP>",\n' +
              '      "description": "<narrative description of the incident, never null>",\n' +
              '      "fields": [ { "key": "<fieldName>", "value": "<string value>" } ]\n' +
              '    }\n' +
              '  ]\n' +
              '}\n\n' +
              'IMPORTANT: Every string field (title, claimType, incidentDate, currency, description) MUST be a non-empty string. claimAmount MUST be a number. Never use null for any field.\n\n' +
              'For "extracted": claims array has exactly one item.\n' +
              'For "rejected": claims is an empty array.\n' +
              'For "split": claims array has one item per distinct claim.\n\n' +
              'For the "fields" array — populate claim-type-specific key-value pairs.\n' +
              'For claims of type "auto", extract the following fields (keys must be exactly as listed):\n' +
              '  make            — vehicle manufacturer (e.g. Honda, Toyota, Ford)\n' +
              '  accidentArea    — Urban or Rural\n' +
              '  fault           — "Policy Holder" or "Third Party"\n' +
              '  policyType      — e.g. "Sport - Liability", "Sport - Collision", "Sedan - Liability"\n' +
              '  vehicleCategory — Sport, Sedan, or Utility\n' +
              '  vehiclePrice    — price range bin, e.g. "more than 69000", "20000 to 29000"\n' +
              '  policeReportFiled — Yes or No\n' +
              '  witnessPresent  — Yes or No\n' +
              '  agentType       — External or Internal\n' +
              '  deductible      — numeric string, e.g. "300"\n' +
              '  driverRating    — 1, 2, 3, or 4\n' +
              '  daysPolicyAccident — time since policy inception to accident, e.g. "more than 30", "15 to 30"\n' +
              '  daysPolicyClaim    — time from accident to claim, e.g. "more than 30", "8 to 15"\n' +
              '  pastNumberOfClaims — none, 1, "2 to 4", or "more than 5"\n' +
              '  ageOfVehicle    — new, "3 years", "5 years", "6 years", "7 years", or "more than 7"\n' +
              '  ageOfPolicyHolder — age range, e.g. "26 to 30", "31 to 35", "over 65"\n' +
              '  numberOfSuppliments — none, "1 to 2", "3 to 5", or "more than 5"\n' +
              '  addressChangeClaim — "no change" or "1 year"\n' +
              '  numberOfCars    — "1 vehicle", "2 vehicles", "3 to 4", "5 or more"\n' +
              '  basePolicy      — Liability, Collision, or "All Perils"\n' +
              '  month           — abbreviated month of incident, e.g. Jan, Feb, Mar\n' +
              '  weekOfMonth     — 1 to 5\n' +
              '  dayOfWeek       — full day name, e.g. Monday\n' +
              '  maritalStatus   — Single or Married\n' +
              '  sex             — Male or Female\n' +
              '  age             — numeric age of policyholder\n' +
              'Use empty string as value for any field that cannot be determined from the input.\n' +
              'For non-auto claim types, use an empty fields array until additional schemas are defined.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text' as const,
                text: [
                  'Analyze the following insurance claim submission:',
                  '',
                  /* istanbul ignore next -- false branch covered only when submission has no rawText */
                  claim.rawText
                    ? `Submission text:\n${claim.rawText}`
                    : '(No text provided — analyze the attached documents only)',
                  /* istanbul ignore next -- false branch covered only when no image attachments present */
                  imageContents.length > 0
                    ? `\n${imageContents.length} document image(s) attached.`
                    : ''
                ].join('\n')
              },
              ...imageContents
            ]
          }
        ],
        temperature: 0.0,
        max_tokens: 4000
      });

      tokenUsage = response.getTokenUsage();
      const rawResult = JSON.parse(extractJson(response.getContent())) as Record<string, unknown>;
      const rawClaims = (rawResult.claims as Array<Record<string, unknown>> | undefined) ?? [];
      agentResult = {
        result: rawResult.result,
        reason: typeof rawResult.reason === 'string' ? rawResult.reason : '',
        claims: rawClaims.map(c => normalizeClaim(c, claim.rawText ?? undefined))
      } as StructureAgentResult;
      LOGGER.debug('Structure Agent complete', { claimId: ID, result: agentResult.result, claimCount: agentResult.claims.length });

    } catch (aiErr: unknown) {
      // Only stub when AI Core is genuinely unreachable (airplane mode).
      // Any other error — including bad/unparseable responses from a live AI Core —
      // must propagate so the outer catch marks the claim as 'failed' and the
      // outboxed event stays pending for retry.
      if (!isConnectivityError(aiErr)) throw aiErr;

      LOGGER.warn('AI Core not reachable, using stub extraction (airplane mode)', { claimId: ID, reason: (aiErr as Error).message });
      // Stub: always extract, never reject or split
      /* istanbul ignore start -- stub mode fallback; defensive defaults only reachable offline */
      agentResult = {
        result: 'extracted',
        reason: '',
        claims: [{
          title:        (claim.rawText?.slice(0, 80).trim() || 'Stub claim') as string,
          claimType:    'auto',
          incidentDate: new Date().toISOString().split('T')[0],
          claimAmount:  0,
          currency:     'USD',
          description:  claim.rawText?.trim() || 'Stub extraction — AI Core not configured',
          fields:       []
        }]
      };
      /* istanbul ignore stop */
    }

    // ── Handle each agent result ─────────────────────────────────────────────

    if (agentResult.result === 'rejected') {
      await UPDATE(Claims)
        .set({ status_code: 'rejected', rejectionReason: agentResult.reason, lastError: null })
        .where({ ID });
      LOGGER.info('Claim rejected by Structure Agent', { claimId: ID, reason: agentResult.reason });
      return; // Pipeline ends here — no further event scheduled
    }

    if (agentResult.result === 'split') {
      await _handleSplit(ID, { ...claim, attachments }, agentResult.claims, Claims, Attachments, StructuredData, runConfig, tokenUsage);
      return; // Pipeline on parent ends here — children run independently
    }

    // ── Normal extraction ────────────────────────────────────────────────────
    await _applyExtraction(ID, agentResult.claims[0], Claims, StructuredData, runConfig, tokenUsage);

  } catch (err: unknown) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: (err as Error).message }).where({ ID });
    throw err;
  }
};

// ── Private helpers ──────────────────────────────────────────────────────────

async function _applyExtraction(
  ID: string,
  data: ExtractedClaimData,
  Claims: any,
  StructuredData: any,
  runConfig: RunConfig,
  tokenUsage: TokenUsage
): Promise<void> {
  // Update claim with extracted structured fields
  await UPDATE(Claims).set({
    title:          data.title,
    description:    data.description,
    claimAmount:    data.claimAmount,
    currency_code:  data.currency,
    claimType_code: data.claimType,
    lastError:      null
  }).where({ ID });

  await DELETE.from(StructuredData).where({ claim_ID: ID });
  const structuredDataID = cds.utils.uuid();
  await INSERT.into(StructuredData).entries({
    ID:                   structuredDataID,
    claim_ID:             ID,
    claimType:            data.claimType,
    incidentDate:         data.incidentDate,
    claimAmount:          data.claimAmount,
    description:          data.description,
    extractionConfidence: 0.85,
    rawExtraction:        JSON.stringify(data),
    promptTokens:         tokenUsage.promptTokens,
    completionTokens:     tokenUsage.completionTokens,
    totalTokens:          tokenUsage.totalTokens
  });

  if (data.fields?.length > 0) {
    const { StructuredDataFields } = cds.entities('ClaimService');
    await INSERT.into(StructuredDataFields).entries(
      data.fields.map(f => ({
        structuredData_ID: structuredDataID,
        fieldName:         f.key,
        fieldValue:        f.value
      }))
    );
  }

  await UPDATE(Claims).set({ status_code: 'structured' }).where({ ID });

  LOGGER.info('Claim structured', { claimId: ID, title: data.title, claimType: data.claimType });

  const ClaimService = await cds.connect.to('ClaimService');
  await cds.outboxed(ClaimService).emit('PredictFraud', {
    ID,
    predictModels: runConfig.predictModels,
    evaluations: runConfig.evaluations
  });
}

async function _handleSplit(
  parentID: string,
  parent: ClaimRecord & { attachments: AttachmentRecord[] },
  splitClaims: ExtractedClaimData[],
  Claims: any,
  Attachments: any,
  StructuredData: any,
  runConfig: RunConfig,
  tokenUsage: TokenUsage
): Promise<void> {
  const childIDs: string[] = [];
  const ClaimService = await cds.connect.to('ClaimService');
  const { ModelRunConfig } = cds.entities('ClaimService');

  for (const claimData of splitClaims) {
    const childID = cds.utils.uuid();

    // Child inherits rawText + externalRef from parent
    await INSERT.into(Claims).entries({
      ID:             childID,
      rawText:        parent.rawText,
      externalRef:    parent.externalRef,
      title:          claimData.title,
      description:    claimData.description,
      claimAmount:    claimData.claimAmount,
      currency_code:  claimData.currency,
      claimType_code: claimData.claimType,
      parentClaim_ID: parentID,
      status_code:    'structured'
    });

    // Copy all attachments to each child (agent already split the logical content)
    /* istanbul ignore next -- parent attachments may be empty */
    if ((parent.attachments || []).length > 0) {
      await INSERT.into(Attachments).entries(
        parent.attachments.map(a => ({
          filename:  a.filename,
          mediaType: a.mediaType,
          content:   a.content,
          claim_ID:  childID
        }))
      );
    }

    const childStructuredDataID = cds.utils.uuid();
    await INSERT.into(StructuredData).entries({
      ID:                   childStructuredDataID,
      claim_ID:             childID,
      claimType:            claimData.claimType,
      incidentDate:         claimData.incidentDate,
      claimAmount:          claimData.claimAmount,
      description:          claimData.description,
      extractionConfidence: 0.85,
      rawExtraction:        JSON.stringify(claimData),
      promptTokens:         tokenUsage.promptTokens,
      completionTokens:     tokenUsage.completionTokens,
      totalTokens:          tokenUsage.totalTokens
    });

    if (claimData.fields?.length > 0) {
      const { StructuredDataFields } = cds.entities('ClaimService');
      await INSERT.into(StructuredDataFields).entries(
        claimData.fields.map(f => ({
          structuredData_ID: childStructuredDataID,
          fieldName:         f.key,
          fieldValue:        f.value
        }))
      );
    }

    // Each child inherits the parent's run configuration (persist + payload).
    await INSERT.into(ModelRunConfig).entries(buildRunConfigRows(childID, runConfig));

    // Children skip the Structure step — they already have structured data
    await cds.outboxed(ClaimService).emit('PredictFraud', {
      ID: childID,
      predictModels: runConfig.predictModels,
      evaluations: runConfig.evaluations
    });
    await UPDATE(Claims).set({ status_code: 'predicting' }).where({ ID: childID });

    childIDs.push(childID);
  }

  // Mark parent as split — it will not proceed through the rest of the pipeline
  const splitNote = `Submission contained ${childIDs.length} distinct claims. Split into: ${childIDs.join(', ')}`;
  await UPDATE(Claims)
    .set({ status_code: 'split', rejectionReason: splitNote, lastError: null })
    .where({ ID: parentID });

  LOGGER.info('Claim split into sub-claims', { parentId: parentID, childIds: childIDs });
}
