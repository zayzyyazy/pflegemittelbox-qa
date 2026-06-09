import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import { deriveMainIssue } from './issueLabels';
import { normalizeMomentType } from './transcriptHeuristics';

const LABEL_HINTS: { re: RegExp; type: EvidenceMomentType; severity: 'low' | 'medium' | 'high' }[] = [
  { re: /auth|identif|versicherung|geburtsdatum|wiederhol/i, type: 'repeated_authentication', severity: 'high' },
  { re: /escalat|weiterleit|human|mitarbeiter/i, type: 'escalation', severity: 'high' },
  { re: /pause|stille|hallo\?|noch da|dead air/i, type: 'long_pause', severity: 'medium' },
  { re: /cut off|unterbrech|frustrat|ärger|loop/i, type: 'caller_cut_off', severity: 'high' },
  { re: /integration|system|lookup|nicht gefunden/i, type: 'missing_integration', severity: 'high' },
  { re: /wrong|falsch|workflow|intent/i, type: 'wrong_workflow', severity: 'medium' },
  { re: /unresolved|nicht gelöst|failed|fehlgeschlagen/i, type: 'unresolved_request', severity: 'high' }
];

/** Infer category/severity after reviewer saves a lightweight note. */
export function inferEvidenceMetadata(
  draft: Partial<
    Pick<
      EvidenceMoment,
      'reviewer_label' | 'reviewer_note' | 'quote_or_transcript_excerpt' | 'moment_type' | 'severity'
    >
  >,
  call?: Partial<CallReview>
): Partial<EvidenceMoment> {
  const blob = `${draft.reviewer_label || ''} ${draft.reviewer_note || ''} ${draft.quote_or_transcript_excerpt || ''}`;
  let moment_type = draft.moment_type || 'manual_highlight';
  let severity = draft.severity || 'medium';

  for (const h of LABEL_HINTS) {
    if (h.re.test(blob)) {
      moment_type = h.type;
      severity = h.severity;
      break;
    }
  }

  const explanation =
    draft.reviewer_note?.trim() ||
    (draft.reviewer_label ? `Reviewer flagged: ${draft.reviewer_label}` : 'Reviewer-highlighted moment');

  const mainIssue = call ? deriveMainIssue(call as CallReview, []) : '';
  const linked_issue_suggestion =
    mainIssue && mainIssue !== 'No major issue' ? mainIssue : undefined;

  return {
    moment_type: normalizeMomentType(moment_type),
    severity,
    explanation,
    recommended_fix: '',
    customer_impact: '',
    engineering_impact: '',
    linked_issue_suggestion,
    confidence: 'high'
  };
}
