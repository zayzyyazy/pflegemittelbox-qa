import type { ReviewObject } from './ReviewObject';

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
export type MarieCallStatus = 'completed' | 'dropped' | 'transferred' | 'failed' | 'unknown';
export type MarieMainResult =
  | 'solved_by_marie'
  | 'transferred'
  | 'ticket_created'
  | 'email_sent'
  | 'update_performed'
  | 'unresolved'
  | 'unknown';

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
  words?: TranscriptWord[];
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
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
  marie_call_status?: MarieCallStatus;
  marie_main_result?: MarieMainResult;
  secondary_issues?: string[];
  transcript: string;
  transcript_segments?: TranscriptSegment[];
  transcript_words?: TranscriptWord[];
  transcription_model?: string;
  audio_file_name: string;
  audio_file_size: number;
  audio_file_type: string;
  audio_file_last_modified: number;
  audio_original_path?: string;
  audio_local_path?: string;
  audio_storage_key?: string;
  recording_url?: string;
  leaping_call_id?: string;
  leaping_detail_url?: string;
  leaping_snapshot_id?: string;
  leaping_status?: string;
  leaping_raw_id?: string;
  leaping_transcript_events?: unknown[];
  function_calls?: MarieFunctionCall[];
  transitions?: MarieTransition[];
  operation_trace?: MarieOperationTrace;
  raw_metadata?: Record<string, unknown>;
  imported_at?: string;
  import_batch_id?: string;
  review_status?: 'new' | 'reviewed' | 'flagged';
  primary_issue_label?: string;
  primary_friction?: string;
  customer_name?: string;
  vnr?: string;
  phone?: string;
  email?: string;
  birthday?: string;
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
  review_object?: ReviewObject;
  exploration_brief?: string;
  exploration_verdict?: string;
  pin_note?: string;
  pin_experiment_id?: string;
  crm_checked?: boolean;
  crm_notes?: string;
  locked_fields?: string[];
  created_at: string;
  updated_at: string;
}

export interface MarieFunctionCall {
  name: string;
  status?: 'success' | 'error' | 'unknown';
  arguments?: Record<string, unknown>;
  result?: unknown;
  timestamp_seconds?: number;
}

export interface MarieTransition {
  from?: string;
  to?: string;
  node?: string;
  timestamp_seconds?: number;
  label?: string;
}

export type MarieOperationTraceStatus =
  | 'not_applicable'
  | 'missing_precondition'
  | 'not_called'
  | 'requested_no_result'
  | 'failed'
  | 'succeeded'
  | 'arg_mismatch'
  | 'claimed_without_execution'
  | 'transferred_instead';

export interface MarieOperationValueCheck {
  field: 'vnr' | 'birthday' | 'phone' | 'email' | 'unknown';
  customer_value?: string;
  function_value?: string;
  status: 'match' | 'mismatch' | 'missing_customer_value' | 'missing_function_value' | 'unknown';
}

export interface MarieOperationTrace {
  expected_action:
    | 'verify_customer'
    | 'pause_or_cancel'
    | 'change_box'
    | 'delivery_status'
    | 'address_or_account_change'
    | 'ticket_or_transfer'
    | 'unknown';
  expected_functions: string[];
  capability_supported: boolean;
  preconditions: {
    needs_vnr: boolean;
    needs_birthday: boolean;
    customer_provided_vnr: boolean;
    customer_provided_birthday: boolean;
    verification_function_called: boolean;
    missing: Array<'vnr' | 'birthday'>;
  };
  customer_values: {
    vnr?: string;
    birthday?: string;
    phone?: string;
    email?: string;
  };
  observed: {
    function_called: boolean;
    requested_without_result: boolean;
    function_failed: boolean;
    transfer_claimed: boolean;
    transfer_event: boolean;
    completion_claimed: boolean;
    execution_event: boolean;
  };
  value_checks: MarieOperationValueCheck[];
  status: MarieOperationTraceStatus;
  reason: string;
  reviewer_flags: string[];
  evidence_summary: string[];
}
