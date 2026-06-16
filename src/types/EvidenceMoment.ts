import type { IssueSeverity } from './Issue';

export type EvidenceSpeaker = 'caller' | 'agent' | 'unknown';

export type EvidenceMomentType =
  | 'repeated_authentication'
  | 'missing_alternative_verification'
  | 'caller_cut_off'
  | 'long_pause'
  | 'wrong_workflow'
  | 'unresolved_request'
  | 'escalation'
  | 'product_availability'
  | 'missing_integration'
  | 'manual_highlight'
  /** @deprecated migrated on load */
  | 'authentication_friction'
  | 'repeated_question'
  | 'wrong_routing'
  | 'wrong_answer'
  | 'robotic_pacing'
  | 'other';

export interface EvidenceMoment {
  id: string;
  call_id: string;
  issue_id?: string;
  timestamp_start_seconds?: number;
  timestamp_end_seconds?: number;
  speaker: EvidenceSpeaker;
  moment_type: EvidenceMomentType;
  severity: IssueSeverity;
  quote_or_transcript_excerpt: string;
  explanation: string;
  recommended_fix: string;
  voice_cue_notes: string;
  confidence?: 'low' | 'medium' | 'high';
  linked_issue_suggestion?: string;
  /** Short label the reviewer types when creating evidence */
  reviewer_label?: string;
  /** Optional freeform note from reviewer */
  reviewer_note?: string;
  /** Segment start times included in multi-line selection */
  segment_starts?: number[];
  pinned?: boolean;
  source?: 'ai' | 'manual' | 'ai_suggested' | 'audio_listener' | 'system_rule';
  /** Reviewer triage on AI-suggested rows */
  reviewer_status?: 'pending' | 'confirmed' | 'dismissed';
  engineering_impact?: string;
  customer_impact?: string;
  reviewer_flag?: 'important_moment' | 'training_example' | 'needs_escalation' | '';
  linked_issue_id?: string;
  created_at: string;
  updated_at: string;
}
