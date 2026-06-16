export type WorkspaceNoteKind = 'call' | 'screenshot' | 'prompt' | 'general';

export interface WorkspaceNote {
  id: string;
  kind: WorkspaceNoteKind;
  call_id?: string;
  title?: string;
  note: string;
  pasted_text?: string;
  image_data_url?: string;
  image_name?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}
