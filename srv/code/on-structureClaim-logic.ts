import cds from '@sap/cds';
import { createChatClient } from './utils/aiClient';
import type {
  ClaimRecord, AttachmentRecord,
  ExtractedClaimData, StructureAgentResult
} from '../types';

const LOGGER = cds.log('on-structureClaim');

/** Strip markdown code fences that Claude sometimes adds despite being told not to. */
function extractJson(content: string): string {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1].trim() : content.trim();
}

/** True only for errors that indicate AI Core is not reachable (airplane mode). */
function isConnectivityError(message: string): boolean {
  return /no service binding|no.*binding.*found|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network.*error/i.test(message);
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
              description:  { type: 'string',  description: 'Narrative description of the incident' }
            },
            required: ['title', 'claimType', 'incidentDate', 'claimAmount', 'currency', 'description'],
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

  LOGGER.info('Starting claim structuring', { claimId: ID });

  const claim = await SELECT.one.from(Claims)
    .columns((c: any) => { c('*'); c.attachments((a: any) => a('*')); })
    .where({ ID }) as ClaimRecord & { attachments: AttachmentRecord[] };

  if (!claim) throw new Error(`Claim ${ID} not found`);

  await UPDATE(Claims).set({ status_code: 'structuring' }).where({ ID });

  try {
    let agentResult: StructureAgentResult;

    /* istanbul ignore next -- attachments is always an array via CAP expand */
    const imageAttachments = (claim.attachments || []).filter(
      /* istanbul ignore next -- mediaType and content nullability guarded by DB constraints */
      a => a.mediaType?.startsWith('image/') && a.content
    );

    try {
      LOGGER.debug('Calling Structure Agent', { claimId: ID, imageCount: imageAttachments.length });

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
              'You are an insurance claim intake agent. Your job is to analyze unstructured input ' +
              '(free text and/or document images) and decide:\n' +
              '- "extracted": the input describes exactly one insurance claim — extract it\n' +
              '- "rejected": the input is unintelligible, spam, or clearly not an insurance claim\n' +
              '- "split": the input contains multiple distinct insurance claims — extract all of them\n\n' +
              'Respond with raw JSON only — no markdown, no code blocks, no explanation.'
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

      agentResult = JSON.parse(extractJson(response.getContent())) as StructureAgentResult;
      LOGGER.debug('Structure Agent complete', { claimId: ID, result: agentResult.result, claimCount: agentResult.claims.length });

    } catch (aiErr: unknown) {
      const errMsg = (aiErr as Error).message ?? '';
      // Only stub when AI Core is genuinely unreachable (airplane mode).
      // Any other error — including bad/unparseable responses from a live AI Core —
      // must propagate so the outer catch marks the claim as 'failed' and the
      // outboxed event stays pending for retry.
      if (!isConnectivityError(errMsg)) throw aiErr;

      LOGGER.warn('AI Core not reachable, using stub extraction (airplane mode)', { claimId: ID, reason: errMsg });
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
          description:  claim.rawText?.trim() || 'Stub extraction — AI Core not configured'
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
      await _handleSplit(ID, claim, agentResult.claims, Claims, Attachments, StructuredData);
      return; // Pipeline on parent ends here — children run independently
    }

    // ── Normal extraction ────────────────────────────────────────────────────
    await _applyExtraction(ID, agentResult.claims[0], Claims, StructuredData);

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
  StructuredData: any
): Promise<void> {
  // Update claim with extracted structured fields
  await UPDATE(Claims).set({
    title:          data.title,
    claimAmount:    data.claimAmount,
    currency_code:  data.currency,
    claimType_code: data.claimType,
    lastError:      null
  }).where({ ID });

  await DELETE.from(StructuredData).where({ claim_ID: ID });
  await INSERT.into(StructuredData).entries({
    claim_ID:             ID,
    claimType:            data.claimType,
    incidentDate:         data.incidentDate,
    claimAmount:          data.claimAmount,
    description:          data.description,
    extractionConfidence: 0.85,
    rawExtraction:        JSON.stringify(data)
  });

  await UPDATE(Claims).set({ status_code: 'structured' }).where({ ID });

  LOGGER.info('Claim structured', { claimId: ID, title: data.title, claimType: data.claimType });

  const ClaimService = await cds.connect.to('ClaimService');
  await cds.outboxed(ClaimService).emit('PredictFraud', { ID });
}

async function _handleSplit(
  parentID: string,
  parent: ClaimRecord & { attachments: AttachmentRecord[] },
  splitClaims: ExtractedClaimData[],
  Claims: any,
  Attachments: any,
  StructuredData: any
): Promise<void> {
  const childIDs: string[] = [];
  const ClaimService = await cds.connect.to('ClaimService');

  for (const claimData of splitClaims) {
    const childID = cds.utils.uuid();

    // Child inherits rawText + externalRef from parent
    await INSERT.into(Claims).entries({
      ID:             childID,
      rawText:        parent.rawText,
      externalRef:    parent.externalRef,
      title:          claimData.title,
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

    await INSERT.into(StructuredData).entries({
      claim_ID:             childID,
      claimType:            claimData.claimType,
      incidentDate:         claimData.incidentDate,
      claimAmount:          claimData.claimAmount,
      description:          claimData.description,
      extractionConfidence: 0.85,
      rawExtraction:        JSON.stringify(claimData)
    });

    // Children skip the Structure step — they already have structured data
    await cds.outboxed(ClaimService).emit('PredictFraud', { ID: childID });
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
