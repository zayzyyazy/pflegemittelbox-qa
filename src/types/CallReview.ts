export type AnliegenCategory = 'order_status' | 'cancel_or_pause' | 'box_or_product_change' | 'address_or_account_change' | 'authentication_problem' | 'other';
export type SolvedStatus = 'yes' | 'partially' | 'no';
export type RootCauseCategory = 'Timing / endpointing' | 'Interruption behavior' | 'Prompt / instruction issue' | 'Workflow logic issue' | 'Missing integration' | 'Identification/auth issue' | 'Transcription / STT issue' | 'TTS / voice naturalness' | 'Knowledge gap' | 'Other';
export interface CallReview {
  id: string; call_id: string; date: string; duration_seconds: number; customer_type: string; caller_context: string; anliegen: AnliegenCategory; solved_status: SolvedStatus; overall_rating: number; naturalness_rating: number;
  caller_cut_off: boolean; awkward_pauses: boolean; robotic_pacing: boolean; latency_too_long: boolean; repeated_question: boolean; identification_problem: boolean; missing_integration: boolean;
  workflow_node: string; root_cause_category: RootCauseCategory; breakpoint_notes: string; suggested_improvement: string; reviewer_notes: string; call_summary: string; transcript: string;
  audio_file_name: string; audio_file_size: number; audio_file_type: string; audio_file_last_modified: number; audio_original_path?: string; linked_issue_ids: string[]; created_at: string; updated_at: string;
}