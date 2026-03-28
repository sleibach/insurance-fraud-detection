// ── Entity shapes (mirror db/schema.cds) ─────────────────────────────────────

export interface ClaimRecord {
  ID: string;
  rawText?: string;
  title?: string;
  description?: string;
  claimAmount?: number;
  currency_code?: string;
  claimType_code?: string;
  status_code: string;
  externalRef?: string;
  reviewNotes?: string;
  rejectionReason?: string;
  lastError?: string;
  parentClaim_ID?: string;
  attachments?: AttachmentRecord[];
}

export interface AttachmentRecord {
  ID?: string;
  claim_ID: string;
  filename: string;
  mediaType: string;
  content?: Buffer | string;
}

export interface StructuredDataRecord {
  ID?: string;
  claim_ID: string;
  claimType?: string;
  incidentDate?: string;
  claimAmount?: number;
  description?: string;
  extractionConfidence?: number;
  rawExtraction?: string;
}

export interface PredictionRecord {
  ID?: string;
  claim_ID: string;
  fraudScore: number;
  modelVersion: string;
  predictionTimestamp: string;
}

export interface EvaluationRecord {
  ID?: string;
  claim_ID: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  keyFactors: string; // JSON array stored as string
  recommendation: string;
}

// ── Intake action input ───────────────────────────────────────────────────────

export interface AttachmentInput {
  filename: string;
  mediaType: string;
  content: string | Buffer;
}

export interface SubmitClaimData {
  externalRef?: string;
  rawText?: string;
  attachments?: AttachmentInput[];
}

// ── Structure Agent result (discriminated union) ──────────────────────────────

export interface ExtractedClaimData {
  title: string;
  claimType: string;
  incidentDate: string;
  claimAmount: number;
  currency: string;
  description: string;
}

export type StructureAgentResult =
  | { result: 'extracted'; reason: string; claims: [ExtractedClaimData] }
  | { result: 'rejected';  reason: string; claims: [] }
  | { result: 'split';     reason: string; claims: ExtractedClaimData[] };

// ── AI extraction / evaluation result shapes ──────────────────────────────────

export interface EvaluationResult {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  keyFactors: string[];
  recommendation: string;
}

// ── AI chat client abstraction ────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant';

export interface TextContent  { type: 'text';      text: string }
export interface ImageContent { type: 'image_url'; image_url: { url: string } }
export type MessageContent = TextContent | ImageContent;

export interface ChatMessage {
  role: MessageRole;
  content: string | MessageContent[];
}

export interface ChatClientOptions {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatClientResponse {
  getContent(): string;
}

export interface ChatClient {
  run(opts: ChatClientOptions): Promise<ChatClientResponse>;
}

// ── Return types ──────────────────────────────────────────────────────────────

export interface SubmitClaimResult {
  ID: string;
  status: string;
}
