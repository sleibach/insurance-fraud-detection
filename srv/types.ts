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
  fraudScoreProprietary?: number;
  fraudScoreCustom?: number;
  riskLevelProprietary?: string;
  riskLevelOpenSource?: string;
  actualFraud?: boolean | null;
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
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface StructuredDataFieldRecord {
  ID?: string;
  structuredData_ID: string;
  fieldName: string;
  fieldValue?: string;
}

export type ModelTrack = 'proprietary' | 'custom' | 'opensource';
export type RunStatus  = 'success' | 'stub' | 'failed';

export interface PredictionRecord {
  ID?: string;
  claim_ID: string;
  track?: ModelTrack;
  provider?: string;
  modelName?: string;
  fraudScore: number;
  predictedClass?: 'yes' | 'no';
  modelVersion: string;
  status?: RunStatus;
  latencyMs?: number;
  predictionTimestamp: string;
}

export interface EvaluationRecord {
  ID?: string;
  claim_ID: string;
  track?: ModelTrack;
  provider?: string;
  modelName?: string;
  promptVersion?: string;
  basedOnPrediction_ID?: string | null;
  fraudProbability?: number;
  fraudDecision?: boolean;
  decisionCriticality?: number;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  keyFactors: string; // JSON array stored as string
  recommendation: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  status?: RunStatus;
  latencyMs?: number;
}

// ── Run configuration (which models to run, and the isolated pairing) ──────────

export interface EvaluationRunInput {
  model: string;
  /** The predict model whose result this evaluation consumes (isolated track). */
  inputPredictModel?: string;
}

export interface RunConfig {
  predictModels: string[];
  evaluations: EvaluationRunInput[];
}

export interface ModelRunConfigRecord {
  ID?: string;
  claim_ID: string;
  stage: 'predict' | 'evaluate';
  track?: ModelTrack;
  modelName: string;
  inputPredictModel?: string | null;
  sequence?: number;
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
  predictModels?: string[];
  evaluations?: EvaluationRunInput[];
  actualFraud?: boolean | null;
}

// ── Structure Agent result (discriminated union) ──────────────────────────────

export interface ExtractedClaimData {
  title: string;
  claimType: string;
  incidentDate: string;
  claimAmount: number;
  currency: string;
  description: string;
  /** Claim-type-specific key-value pairs extracted by the Structure Agent.
   *  Keys match the camelCase column names of the fraud training data schema,
   *  enabling direct mapping to RPT-1 feature columns. */
  fields: Array<{ key: string; value: string }>;
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
  /** LLM-as-classifier calibrated fraud probability (0..1). */
  fraudProbability?: number;
  /** LLM-as-classifier binary decision (true = fraud). */
  fraudDecision?: boolean;
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

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatClientResponse {
  getContent(): string;
  getTokenUsage(): TokenUsage;
}

export interface ChatClient {
  run(opts: ChatClientOptions): Promise<ChatClientResponse>;
}

// ── Return types ──────────────────────────────────────────────────────────────

export interface SubmitClaimResult {
  ID: string;
  status: string;
}
