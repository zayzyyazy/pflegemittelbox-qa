import type { CallReview } from './CallReview';
import type { EvidenceMoment } from './EvidenceMoment';

export type DraftStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface DraftCall {
  id: string;
  status: DraftStatus;
  file_name: string;
  processing_step?: string;
  error?: string;
  duplicate_warning?: boolean;
  import_batch_id?: string;
  transcript?: string;
  call: Partial<CallReview>;
  evidence: Partial<EvidenceMoment>[];
  created_at: string;
  updated_at: string;
}
