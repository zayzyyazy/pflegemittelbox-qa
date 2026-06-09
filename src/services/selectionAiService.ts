import type { CallReview, TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import type { Database, Settings } from './storageService';
import { askAi } from './openaiService';
import { deriveMainIssue } from '../utils/issueLabels';
import { normalizeMomentType } from '../utils/transcriptHeuristics';
import { formatTranscriptWindow, getTranscriptWindow } from '../utils/transcriptContext';

export type SuggestedHighlightNote = {
  moment_type: EvidenceMomentType;
  severity: 'low' | 'medium' | 'high';
  speaker: 'caller' | 'agent' | 'unknown';
  explanation: string;
  customer_impact: string;
  engineering_impact: string;
  recommended_fix: string;
  reviewer_flag?: EvidenceMoment['reviewer_flag'];
};

const NOTE_SYSTEM = `You help a Pflegebox call QA reviewer annotate a highlighted transcript excerpt.

Return ONLY JSON:
{
  "answer": "markdown reply to the reviewer (2-5 sentences)",
  "suggested_note": {
    "moment_type": "manual_highlight|repeated_authentication|long_pause|escalation|wrong_workflow|unresolved_request|other",
    "severity": "low|medium|high",
    "speaker": "caller|agent|unknown",
    "explanation": "why this moment matters",
    "customer_impact": "impact on caller",
    "engineering_impact": "impact on engineering/workflow",
    "recommended_fix": "concrete fix"
  }
}

Ground everything in the provided excerpt and call context only.`;

export async function askAboutSelection(
  settings: Settings,
  db: Database,
  call: CallReview,
  excerpt: string,
  question: string,
  segment?: TranscriptSegment
) {
  const evidence = db.evidence.filter(e => e.call_id === call.id);
  const segments = call.transcript_segments || [];
  let nearby = call.transcript.slice(0, 8000);
  if (segment && segments.length) {
    const idx = segments.findIndex(s => s.start === segment.start && s.text === segment.text);
    if (idx >= 0) {
      nearby = formatTranscriptWindow(getTranscriptWindow(segments, idx, idx, 6));
    }
  }
  const context = {
    call: {
      call_id: call.call_id,
      anliegen: call.anliegen,
      solved_status: call.solved_status,
      main_issue: deriveMainIssue(call, evidence),
      summary: call.call_summary,
      original_intent: call.original_intent_summary,
      final_outcome: call.final_outcome,
      reviewer_notes: call.reviewer_notes,
      risk_hints: call.ai_risk_hints
    },
    highlighted_excerpt: excerpt,
    segment_timing: segment ? { start: segment.start, end: segment.end, speaker: segment.speaker } : null,
    nearby_transcript: nearby,
    existing_reviewer_evidence: evidence.filter(e => e.source === 'manual').slice(0, 8)
  };

  const raw = await askAi(settings, {
    system: NOTE_SYSTEM,
    question,
    context
  });

  return parseSelectionResponse(raw);
}

export function parseSelectionResponse(raw: Record<string, unknown>) {
  const answer = String(raw.answer || raw.summary || '').trim();
  let suggested: SuggestedHighlightNote | undefined;
  const note = raw.suggested_note as Record<string, unknown> | undefined;
  if (note && typeof note === 'object') {
    suggested = {
      moment_type: normalizeMomentType(String(note.moment_type || 'manual_highlight')),
      severity:
        note.severity === 'high' || note.severity === 'low' ? note.severity : 'medium',
      speaker:
        note.speaker === 'caller' || note.speaker === 'agent' ? note.speaker : 'unknown',
      explanation: String(note.explanation || '').trim(),
      customer_impact: String(note.customer_impact || '').trim(),
      engineering_impact: String(note.engineering_impact || '').trim(),
      recommended_fix: String(note.recommended_fix || '').trim()
    };
  }
  return { answer, suggested_note: suggested };
}

export async function generateHighlightNoteDraft(
  settings: Settings,
  db: Database,
  call: CallReview,
  excerpt: string,
  segment?: TranscriptSegment
) {
  return askAboutSelection(
    settings,
    db,
    call,
    excerpt,
    'Write a complete QA highlight note for this excerpt. Explain why it matters and suggest a fix.',
    segment
  );
}
