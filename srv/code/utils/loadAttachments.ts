import cds from '@sap/cds';
import { Readable } from 'node:stream';
import type { AttachmentRecord } from '../../types';

const LOGGER = cds.log('load-attachments');

async function toBuffer(content: unknown): Promise<Buffer | undefined> {
  if (!content) return undefined;
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content, 'base64');
  if (content instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  return undefined;
}

/** Load attachment rows including LargeBinary content (not returned via composition expand). */
export async function loadClaimAttachments(
  Attachments: { name?: string },
  claimId: string
): Promise<AttachmentRecord[]> {
  const meta = await SELECT.from(Attachments)
    .columns('ID', 'filename', 'mediaType')
    .where({ claim_ID: claimId }) as Pick<AttachmentRecord, 'ID' | 'filename' | 'mediaType'>[];

  const rows = await Promise.all(meta.map(async m => {
    const row = await SELECT.one.from(Attachments, m.ID!).columns('content') as { content?: unknown };
    const content = await toBuffer(row?.content);
    if (!content) {
      LOGGER.warn('Attachment content empty after explicit read', { claimId, attachmentId: m.ID, filename: m.filename });
    }
    return { ...m, content } as AttachmentRecord;
  }));

  return rows;
}
