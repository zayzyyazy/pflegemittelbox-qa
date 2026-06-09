import type { AnliegenCategory } from './CallReview';

export type PatternKind = 'caller_intent' | 'agent_failure' | 'workflow' | 'issue_cluster';

export interface PatternThread {
  id: string;
  title: string;
  kind: PatternKind;
  description: string;
  caller_request_counts: Partial<Record<AnliegenCategory, number>>;
  main_issue_counts: Record<string, number>;
  recurring_phrases: string[];
  workflow_nodes: string[];
  call_ids: string[];
  evidence_ids: string[];
  last_seen: string;
  confidence: 'low' | 'medium' | 'high';
  suggested_fix: string;
  created_at: string;
  updated_at: string;
}
