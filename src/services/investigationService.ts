import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type { Issue } from '../types/Issue';
import type { Database, Settings } from './storageService';
import { analyzeCallContext } from '../analysis/callUnderstanding';
import { callerRequestLabels } from '../utils/anliegen';
import { deriveMainIssue } from '../utils/issueLabels';
import { formatTranscriptWindow, getTranscriptWindow } from '../utils/transcriptContext';
import { id } from '../utils/text';
import { nowIso } from '../utils/dates';
import { upsertIssue } from './issuesService';
import { upsertExperiment } from './experimentsService';
import { saveInsight } from './insightsService';
import { askAi } from './openaiService';

export type InvestigationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type InvestigationFocus = {
  type: 'call' | 'issue' | 'project' | 'evidence';
  relatedId?: string;
  evidenceId?: string;
  highlightQuote?: string;
};

export type PendingInvestigationAction = {
  id: string;
  kind:
    | 'create_issue_draft'
    | 'create_experiment_draft'
    | 'save_qa_note'
    | 'save_escalation_summary'
    | 'save_engineering_draft'
    | 'save_meeting_summary'
    | 'save_root_cause'
    | 'save_friction_report';
  title: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const INVESTIGATION_SYSTEM = `You are a senior Pflegebox / Pflegehilfsmittel QA investigation assistant.

You help reviewers understand phone calls between elderly callers and an AI voice bot.

Rules:
- Use ONLY the provided context (transcript, evidence, issues, notes). Do not invent call IDs or counts.
- Distinguish normal authentication (insurance number then birth date) from repeated-auth failures.
- Distinguish real human transfer from greetings or auth prompts.
- Reference exact transcript quotes and evidence timestamps when relevant.
- Be concise, operational, and actionable — like internal QA software, not marketing copy.
- If asked to create something, describe what you would create; the UI will offer approval buttons separately.

Respond in clear markdown with short sections when helpful.`;

export function buildInvestigationContext(db: Database, focus: InvestigationFocus) {
  if (focus.type === 'call' && focus.relatedId) {
    const call = db.calls.find(c => c.id === focus.relatedId);
    if (!call) return { error: 'Call not found' };
    const evidence = db.evidence.filter(e => e.call_id === call.id);
    const issues = db.issues.filter(i => call.linked_issue_ids.includes(i.id) || i.linked_call_ids.includes(call.id));
    const understanding = analyzeCallContext(call.transcript, call.transcript_segments, {
      caller_request: call.anliegen,
      original_intent_summary: call.original_intent_summary || call.caller_context,
      solved_status: call.solved_status
    });
    const focusEvidence = focus.evidenceId ? evidence.find(e => e.id === focus.evidenceId) : undefined;
    const segments = call.transcript_segments || [];
    let transcript_window = call.transcript.slice(0, 12000);
    if (focusEvidence && segments.length) {
      const idx = segments.findIndex(
        s => Math.abs(s.start - (focusEvidence.timestamp_start_seconds || 0)) < 2
      );
      if (idx >= 0) {
        transcript_window = formatTranscriptWindow(getTranscriptWindow(segments, idx, idx, 8));
      }
    } else if (focus.highlightQuote && segments.length) {
      const idx = segments.findIndex(s => focus.highlightQuote && s.text.includes(focus.highlightQuote.slice(0, 40)));
      if (idx >= 0) {
        transcript_window = formatTranscriptWindow(getTranscriptWindow(segments, idx, idx, 8));
      }
    }
    return {
      focus: 'call',
      call: {
        id: call.id,
        call_id: call.call_id,
        date: call.date,
        anliegen: callerRequestLabels[call.anliegen],
        solved_status: call.solved_status,
        main_issue: deriveMainIssue(call, evidence),
        ratings: { overall: call.overall_rating, naturalness: call.naturalness_rating },
        summary: call.call_summary,
        original_intent: call.original_intent_summary || call.caller_context,
        final_outcome: call.final_outcome,
        reviewer_notes: call.reviewer_notes,
        flags: {
          pinned: call.pinned,
          critical: call.critical,
          needs_review: call.needs_review,
          watch_later: call.watch_later
        }
      },
      call_understanding: understanding,
      evidence,
      linked_issues: issues,
      highlight_focus: focusEvidence || (focus.highlightQuote ? { quote: focus.highlightQuote } : undefined),
      transcript_window,
      transcript_excerpt: call.transcript.slice(0, 12000)
    };
  }

  if (focus.type === 'evidence' && focus.evidenceId) {
    const moment = db.evidence.find(e => e.id === focus.evidenceId);
    if (!moment) return { error: 'Evidence not found' };
    const call = db.calls.find(c => c.id === moment.call_id);
    return buildInvestigationContext(db, {
      type: 'call',
      relatedId: call?.id,
      evidenceId: moment.id,
      highlightQuote: moment.quote_or_transcript_excerpt
    });
  }

  if (focus.type === 'issue' && focus.relatedId) {
    const issue = db.issues.find(i => i.id === focus.relatedId);
    if (!issue) return { error: 'Issue not found' };
    const evidence = db.evidence.filter(e => issue.linked_evidence_ids?.includes(e.id) || e.issue_id === issue.id);
    const calls = db.calls.filter(c => issue.linked_call_ids.includes(c.id));
    return { focus: 'issue', issue, evidence, linked_calls: calls };
  }

  return {
    focus: 'project',
    active_issues: db.issues.filter(i => !['resolved', 'ignored'].includes(i.status)).slice(0, 8),
    recent_calls: db.calls.slice(0, 12).map(c => ({
      id: c.id,
      call_id: c.call_id,
      anliegen: c.anliegen,
      solved_status: c.solved_status,
      pinned: c.pinned,
      critical: c.critical
    })),
    pattern_threads: (db.patternThreads || []).slice(0, 6)
  };
}

export function suggestedInvestigationQuestions(focus: InvestigationFocus): string[] {
  if (focus.type === 'call' || focus.type === 'evidence') {
    return [
      'Why is this moment problematic?',
      'What workflow failed here?',
      'What should engineering fix?',
      'Summarize this interaction.',
      'Why did the customer get frustrated?',
      'Did authentication succeed?',
      'Was escalation appropriate?',
      'Was this actually a successful call?'
    ];
  }
  if (focus.type === 'issue') {
    return ['What is the root cause?', 'Which calls best prove this issue?', 'What experiment should we run next?'];
  }
  return ['What should we fix first this week?', 'Which patterns are growing?', 'What calls need review?'];
}

export function draftActionsFromAnswer(
  answer: string,
  db: Database,
  focus: InvestigationFocus
): PendingInvestigationAction[] {
  const now = nowIso();
  const actions: PendingInvestigationAction[] = [];
  const call = focus.relatedId ? db.calls.find(c => c.id === focus.relatedId) : undefined;
  const evidence = call ? db.evidence.filter(e => e.call_id === call.id) : [];

  if (/issue|root cause|workflow/i.test(answer)) {
    actions.push({
      id: id('pending'),
      kind: 'create_issue_draft',
      title: 'Create issue draft from investigation',
      payload: {
        title: call ? `${deriveMainIssue(call, evidence)} (investigation)` : 'Issue from investigation',
        description: answer.slice(0, 1200),
        severity: call?.critical ? 'high' : 'medium',
        linked_call_ids: call ? [call.id] : [],
        linked_evidence_ids: evidence.slice(0, 3).map(e => e.id)
      },
      created_at: now
    });
  }
  if (/experiment|test|prompt/i.test(answer)) {
    actions.push({
      id: id('pending'),
      kind: 'create_experiment_draft',
      title: 'Create experiment draft',
      payload: {
        experiment_name: call ? `Test fix for ${call.call_id}` : 'Investigation experiment',
        notes: answer.slice(0, 800),
        linked_issue_id: call?.linked_issue_ids?.[0],
        related_call_ids: call ? [call.id] : []
      },
      created_at: now
    });
  }
  if (/engineering|fix|ticket/i.test(answer)) {
    actions.push({
      id: id('pending'),
      kind: 'save_engineering_draft',
      title: 'Save engineering ticket draft',
      payload: { body: answer, call_id: call?.call_id },
      created_at: now
    });
  }
  actions.push({
    id: id('pending'),
    kind: 'save_qa_note',
    title: 'Save QA investigation note',
    payload: { note: answer, call_id: call?.id },
    created_at: now
  });
  return actions.slice(0, 4);
}

export function executeApprovedAction(db: Database, action: PendingInvestigationAction): Database {
  const now = nowIso();
  switch (action.kind) {
    case 'create_issue_draft': {
      const p = action.payload as Partial<Issue>;
      return upsertIssue(db, {
        id: id('issue'),
        title: String(p.title || action.title),
        category: 'Workflow logic issue',
        severity: (p.severity as Issue['severity']) || 'medium',
        status: 'active',
        description: String(p.description || ''),
        suggested_fix: '',
        notes: 'Created from AI investigation (approved).',
        linked_call_ids: (p.linked_call_ids as string[]) || [],
        linked_evidence_ids: (p.linked_evidence_ids as string[]) || [],
        created_at: now,
        updated_at: now
      });
    }
    case 'create_experiment_draft': {
      const p = action.payload;
      return upsertExperiment(db, {
        id: id('exp'),
        date: now.slice(0, 10),
        experiment_name: String(p.experiment_name || action.title),
        linked_issue_id: p.linked_issue_id as string | undefined,
        changed_setting: 'Investigation follow-up',
        old_value: '',
        new_value: '',
        expected_effect: '',
        actual_effect: '',
        result: 'inconclusive',
        related_call_ids: (p.related_call_ids as string[]) || [],
        notes: String(p.notes || ''),
        created_at: now,
        updated_at: now
      });
    }
    case 'save_qa_note': {
      const callId = action.payload.call_id as string | undefined;
      if (!callId) return db;
      const call = db.calls.find(c => c.id === callId);
      if (!call) return db;
      const note = String(action.payload.note || '');
      return {
        ...db,
        calls: db.calls.map(c =>
          c.id === callId
            ? {
                ...c,
                reviewer_notes: [c.reviewer_notes, `[Investigation ${now.slice(0, 10)}]\n${note}`]
                  .filter(Boolean)
                  .join('\n\n'),
                updated_at: now
              }
            : c
        )
      };
    }
    case 'save_engineering_draft':
    case 'save_escalation_summary':
    case 'save_meeting_summary':
    case 'save_root_cause':
    case 'save_friction_report':
      return saveInsight(db, {
        title: action.title,
        summary: String(action.payload.body || action.payload.note || '').slice(0, 400),
        question: action.kind,
        answer: String(action.payload.body || action.payload.note || ''),
        context_type: 'call',
        related_call_id: action.payload.call_id as string | undefined,
        raw_json: JSON.stringify(action.payload)
      });
    default:
      return db;
  }
}

export async function askInvestigation(
  settings: Settings,
  focus: InvestigationFocus,
  db: Database,
  messages: InvestigationMessage[],
  question: string
) {
  const context = buildInvestigationContext(db, focus);
  const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
  return askAi(settings, {
    system: INVESTIGATION_SYSTEM,
    question,
    focus,
    context,
    conversation: history
  });
}
