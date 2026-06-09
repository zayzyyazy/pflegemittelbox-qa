export type IssueSeverity = 'low' | 'medium' | 'high';
export type IssueStatus = 'active' | 'investigating' | 'testing' | 'improving' | 'resolved' | 'ignored';
export interface Issue {
  id: string;
  title: string;
  category: string;
  severity: IssueSeverity;
  status: IssueStatus;
  description: string;
  suggested_fix: string;
  notes: string;
  linked_call_ids: string[];
  linked_evidence_ids?: string[];
  affected_anliegen?: string[];
  pattern_thread_id?: string;
  confidence?: 'low' | 'medium' | 'high';
  experiment_id?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}