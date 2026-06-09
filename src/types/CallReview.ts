export type AnliegenCategory =
  | 'box_or_product_change'
  | 'order_status'
  | 'cancel_or_pause'
  | 'address_or_account_change'
  | 'authentication_problem'
  | 'new_customer_onboarding'
  | 'general_information_question'
  | 'other';

export type SolvedStatus = 'yes' | 'partially' | 'no';

export type MainIssueLabel =
  | 'Authentication failure'
  | 'Repeated authentication'
  | 'Missing alternative verification'
  | 'Caller interrupted / cut off'
  | 'Long pause / dead air'
  | 'Wrong intent / wrong workflow'
  | 'Missing integration'
  | 'Knowledge gap'
  | 'Product availability issue'
  | 'Escalated to human'
  | 'No major issue';

export type RootCauseCategory =
  | 'Timing / endpointing'
  | 'Interruption behavior'
  | 'Prompt / instruction issue'
  | 'Workflow logic issue'
  | 'Missing integration'
  | 'Identification/auth issue'
  | 'Transcription / STT issue'
  | 'TTS / voice naturalness'
  | 'Knowledge gap'
  | 'Other';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: 'caller' | 'agent' | 'unknown';
}

export interface CallReview {
  id: string;
  call_id: string;
  date: string;
  duration_seconds: number;
  customer_type: string;
  caller_context: string;
  anliegen: AnliegenCategory;
  solved_status: SolvedStatus;
  overall_rating: number;
  naturalness_rating: number;
  caller_cut_off: boolean;
  awkward_pauses: boolean;
  robotic_pacing: boolean;
  latency_too_long: boolean;
  repeated_question: boolean;
  identification_problem: boolean;
  missing_integration: boolean;
  workflow_node: string;
  root_cause_category: RootCauseCategory;
  breakpoint_notes: string;
  suggested_improvement: string;
  reviewer_notes: string;
  /** Persistent freeform QA / engineering observations written by reviewer */
  reviewer_call_notes?: string;
  /** AI-only hints — not evidence */
  ai_risk_hints?: string;
  ai_moments_of_interest?: string;
  call_summary: string;
  original_intent_summary?: string;
  final_outcome?: string;
  secondary_issues?: string[];
  transcript: string;
  transcript_segments?: TranscriptSegment[];
  audio_file_name: string;
  audio_file_size: number;
  audio_file_type: string;
  audio_file_last_modified: number;
  audio_original_path?: string;
  audio_local_path?: string;
  audio_storage_key?: string;
  imported_at?: string;
  import_batch_id?: string;
  review_status?: 'new' | 'reviewed' | 'flagged';
  primary_issue_label?: string;
  primary_friction?: string;
  customer_name?: string;
  vnr?: string;
  phone?: string;
  analysis_version?: number;
  linked_issue_ids: string[];
  /** Reviewer triage */
  pinned?: boolean;
  critical?: boolean;
  watch_later?: boolean;
  needs_review?: boolean;
  investigation_starred?: boolean;
  training_example?: boolean;
  engineering_escalated?: boolean;
  reviewer_tags?: string[];
  workspace?: 'production' | 'test';
  bot_version?: 'production' | 'experimental' | 'hybrid';
  sub_tags?: string[];
  conversational_quality?: number;
  operational_reliability?: number;
  pin_note?: string;
  pin_experiment_id?: string;
  crm_checked?: boolean;
  crm_notes?: string;
  locked_fields?: string[];
  created_at: string;
  updated_at: string;
}
