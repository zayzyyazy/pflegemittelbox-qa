import type { CallReview, MainIssueLabel } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { formatFriction } from './friction';

export const MAIN_ISSUE_LABELS: MainIssueLabel[] = [
  'Authentication failure',
  'Repeated authentication',
  'Missing alternative verification',
  'Caller interrupted / cut off',
  'Long pause / dead air',
  'Wrong intent / wrong workflow',
  'Missing integration',
  'Knowledge gap',
  'Product availability issue',
  'Escalated to human',
  'No major issue'
];

const MAIN_ISSUE_SET = new Set<string>(MAIN_ISSUE_LABELS);

const AI_MAIN_ALIASES: Record<string, MainIssueLabel> = {
  'auth issue': 'Repeated authentication',
  'authentication issue': 'Authentication failure',
  'authentication failure': 'Authentication failure',
  'repeated authentication': 'Repeated authentication',
  'interruption': 'Caller interrupted / cut off',
  'long pause': 'Long pause / dead air',
  'workflow issue': 'Wrong intent / wrong workflow',
  'escalation': 'Escalated to human',
  'needs review': 'No major issue'
};

export function normalizeMainIssueLabel(value: string): MainIssueLabel | null {
  const trimmed = value.trim();
  if (MAIN_ISSUE_SET.has(trimmed)) return trimmed as MainIssueLabel;
  const key = trimmed.toLowerCase();
  if (AI_MAIN_ALIASES[key]) return AI_MAIN_ALIASES[key];
  for (const label of MAIN_ISSUE_LABELS) {
    if (label.toLowerCase() === key) return label;
  }
  return null;
}

export function deriveMainIssue(call: Partial<CallReview>, evidence: EvidenceMoment[]): MainIssueLabel {
  const friction = formatFriction(call, evidence);
  if (friction === 'Resolved cleanly') return 'No major issue';
  if (friction === 'Partially resolved' || friction === 'Unresolved') {
    return friction === 'Unresolved' ? 'Knowledge gap' : 'Escalated to human';
  }
  const normalized = normalizeMainIssueLabel(friction);
  if (normalized) return normalized;
  if (call.caller_cut_off || evidence.some(e => e.moment_type === 'caller_cut_off')) {
    return 'Caller interrupted / cut off';
  }
  if (call.awkward_pauses || evidence.some(e => e.moment_type === 'long_pause')) {
    return 'Long pause / dead air';
  }
  if (call.identification_problem) return 'Repeated authentication';
  if (call.missing_integration) return 'Missing integration';
  if (call.solved_status === 'yes' && !evidence.length) return 'No major issue';
  return friction.slice(0, 80) as MainIssueLabel;
}

export const compactMainIssue = deriveMainIssue;
