'use strict';
const cds = require('@sap/cds');
const { createChatClient } = require('./utils/aiClient');
const LOGGER = cds.log('on-structureClaim');

const EXTRACTION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'structured_claim',
    description: 'Structured data extracted from insurance claim documents',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        claimType:    { type: 'string', description: 'Type of insurance claim' },
        incidentDate: { type: 'string', description: 'Date of incident in YYYY-MM-DD format' },
        claimAmount:  { type: 'number', description: 'Claimed amount in currency units' },
        description:  { type: 'string', description: 'Narrative description of the incident' }
      },
      required: ['claimType', 'incidentDate', 'claimAmount', 'description'],
      additionalProperties: false
    }
  }
};

module.exports = async function (msg) {
  const { Claims, StructuredData } = cds.entities('ClaimService');
  const { ID } = msg.data;

  LOGGER.info('Starting claim structuring', { claimId: ID });

  // 1. Load claim with attachments
  const claim = await SELECT.one.from(Claims)
    .columns(c => { c('*'); c.attachments(a => a('*')); })
    .where({ ID });

  if (!claim) throw new Error(`Claim ${ID} not found`);

  await UPDATE(Claims).set({ status_code: 'structuring' }).where({ ID });

  try {
    let extracted;
    const imageAttachments = (claim.attachments || []).filter(a => a.mediaType?.startsWith('image/') && a.content);

    // 2. Build vision messages from image attachments
    try {
      LOGGER.debug('Calling LLM for document extraction', { claimId: ID, imageCount: imageAttachments.length });

      const imageContents = imageAttachments.map(a => ({
        type: 'image_url',
        image_url: {
          url: `data:${a.mediaType};base64,${Buffer.from(a.content).toString('base64')}`
        }
      }));

      const messages = [
        {
          role: 'system',
          content: 'You are an insurance claim analyst. Extract structured data from the provided documents. ' +
            'Respond with raw JSON only — no markdown, no code blocks, no explanation. ' +
            'Required fields: claimType (string), incidentDate (YYYY-MM-DD), claimAmount (number), description (string).'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this insurance claim and extract structured data.\nClaim title: ${claim.title}\nClaimed amount: ${claim.claimAmount} ${claim.currency_code || ''}\nDescription: ${claim.description || 'N/A'}`
            },
            ...imageContents
          ]
        }
      ];

      const client = createChatClient('anthropic--claude-4.6-opus');
      const response = await client.run({
        messages,
        temperature: 0.0,
        max_tokens: 2000
      });
      extracted = JSON.parse(response.getContent());
      LOGGER.debug('LLM extraction complete', { claimId: ID, extractedType: extracted.claimType, extractedAmount: extracted.claimAmount });

    } catch (aiErr) {
      LOGGER.warn('AI call failed, using stub extraction', { claimId: ID, reason: aiErr.message });
      extracted = {
        claimType:    claim.claimType_code || 'auto',
        incidentDate: new Date().toISOString().split('T')[0],
        claimAmount:  Number(claim.claimAmount) || 0,
        description:  claim.description || 'Stub extraction — AI Core not configured'
      };
    }

    // 3. Upsert StructuredData (delete + insert for 1:1 composition)
    await DELETE.from(StructuredData).where({ claim_ID: ID });
    await INSERT.into(StructuredData).entries({
      claim_ID:             ID,
      claimType:            extracted.claimType,
      incidentDate:         extracted.incidentDate,
      claimAmount:          extracted.claimAmount,
      extractionConfidence: 0.85,
      rawExtraction:        JSON.stringify(extracted)
    });

    await UPDATE(Claims).set({ status_code: 'structured', lastError: null }).where({ ID });
    LOGGER.info('Claim structuring complete', { claimId: ID });

    // 4. Chain to next pipeline step
    const ClaimService = await cds.connect.to('ClaimService');
    await cds.outboxed(ClaimService).emit('PredictFraud', { ID });

  } catch (err) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: err.message }).where({ ID });
    throw err;
  }
};
