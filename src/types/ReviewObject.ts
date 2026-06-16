import type { AnliegenCategory, RootCauseCategory, SolvedStatus, TranscriptSegment } from './CallReview';
import type { EvidenceMomentType, EvidenceSpeaker } from './EvidenceMoment';
import type { IssueSeverity } from './Issue';

export type ReviewAgentId =
  | 'conversation_understanding'
  | 'qa_process_compliance'
  | 'customer_experience'
  | 'audio_behavioral_signals';

export type ReviewFindingStatus = 'candidate' | 'verified' | 'dismissed';
export type ReviewFindingConfidence = 'low' | 'medium' | 'high';

export type ReviewFindingDimension =
  | 'summary'
  | 'qa_process'
  | 'compliance'
  | 'customer_experience'
  | 'audio_behavior'
  | 'workflow'
  | 'integration'
  | 'reviewer_action';

export interface ReviewEvidenceAnchor {
  timestamp_start_seconds?: number;
  timestamp_end_seconds?: number;
  segment_starts?: number[];
  speaker?: EvidenceSpeaker;
  quote_or_transcript_excerpt: string;
}

export interface ReviewCandidateFinding {
  id: string;
  call_id: string;
  agent_id: ReviewAgentId;
  dimension: ReviewFindingDimension;
  type: EvidenceMomentType | 'summary_signal' | 'reviewer_task' | 'trend_signal';
  status: ReviewFindingStatus;
  severity: IssueSeverity;
  confidence: ReviewFindingConfidence;
  evidence: ReviewEvidenceAnchor[];
  explanation: string;
  suggested_action: string;
  customer_impact?: string;
  operational_impact?: string;
  linked_issue_suggestion?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentReviewSection<TOutput = Record<string, unknown>> {
  agent_id: ReviewAgentId;
  status: 'not_run' | 'running' | 'succeeded' | 'failed';
  model?: string;
  summary: string;
  confidence: ReviewFindingConfidence;
  findings: ReviewCandidateFinding[];
  output: TOutput;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ConversationUnderstandingOutput {
  concise_summary: string;
  caller_goal: string;
  final_outcome: string;
  anliegen: AnliegenCategory;
  solved_status: SolvedStatus;
  customer_type?: string;
  entities?: {
    customer_name?: string;
    vnr?: string;
    phone?: string;
    products?: string[];
    months?: string[];
    pg_codes?: string[];
  };
}

export interface QaProcessComplianceOutput {
  workflow_path: string;
  workflow_node?: string;
  root_cause_category?: RootCauseCategory;
  compliance_checks: Array<{
    check: string;
    result: 'pass' | 'candidate_issue' | 'fail' | 'not_applicable';
    rationale: string;
  }>;
}

export interface CustomerExperienceOutput {
  customer_sentiment: 'calm' | 'confused' | 'frustrated' | 'distressed' | 'unknown';
  friction_summary: string;
  moments_of_confusion: number;
  reviewer_note: string;
}

export interface AudioBehavioralSignalsOutput {
  listened_to_audio: boolean;
  transcript_only: boolean;
  acoustic_events_count: number;
  timing_notes: string;
  transcript_segments?: TranscriptSegment[];
}

export interface ReviewActionItem {
  id: string;
  call_id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  rationale: string;
  source_finding_ids: string[];
  suggested_next_step: string;
  status: 'open' | 'done' | 'dismissed';
  created_at: string;
  updated_at: string;
}

export interface ReviewObject {
  schema_version: 1;
  call_id: string;
  generated_at: string;
  pipeline_status: 'not_started' | 'processing' | 'ready_for_review' | 'reviewed' | 'failed';
  agents: {
    conversation_understanding: AgentReviewSection<ConversationUnderstandingOutput>;
    qa_process_compliance: AgentReviewSection<QaProcessComplianceOutput>;
    customer_experience: AgentReviewSection<CustomerExperienceOutput>;
    audio_behavioral_signals: AgentReviewSection<AudioBehavioralSignalsOutput>;
  };
  candidate_findings: ReviewCandidateFinding[];
  verified_findings: ReviewCandidateFinding[];
  dismissed_findings: ReviewCandidateFinding[];
  action_items: ReviewActionItem[];
  dashboard_signals: {
    high_severity_count: number;
    unresolved_candidate_count: number;
    trend_tags: string[];
    searchable_terms: string[];
  };
}
