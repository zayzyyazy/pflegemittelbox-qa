export type AcousticEventType =
  | 'silence_gap'
  | 'overlap'
  | 'slow_response'
  | 'truncated_turn'
  | 'low_pacing_variance';

export interface AcousticEvent {
  type: AcousticEventType;
  start_ms: number;
  end_ms: number;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface TimingSignal {
  kind: 'long_turn_gap' | 'rapid_repeated_prompt' | 'truncated_turn';
  start_ms: number;
  end_ms: number;
  description: string;
}

export interface AudioListenerFinding {
  heard: string;
  issue_type: string;
  speaker?: 'caller' | 'agent' | 'unknown';
  severity: 'low' | 'medium' | 'high';
  start_seconds?: number;
  end_seconds?: number;
  confidence: number;
  suggested_action?: string;
}

export interface AudioClipWindow {
  start_seconds: number;
  end_seconds: number;
  reason: string;
}

export const ANALYSIS_VERSION = 2;
