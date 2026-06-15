import { CALL_REVIEW_SYSTEM, SPEAKER_LABEL_SYSTEM } from '../analysis/callReviewPrompt';
import { defaultSettings, type Database, type Settings } from './storageService';
import type { CallReview, TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import type { Experiment } from '../types/Experiment';
import {
  buildCallUnderstanding,
  finalizeCallAnalysis,
  parseSecondaryIssues,
  resolveSolvedStatus,
  syncCallFlagsFromEvidence
} from '../utils/callAnalysis';
import { normalizeMainIssueLabel } from '../utils/issueLabels';
import { buildReviewerNotes } from '../utils/reviewerNotes';
import { finalizeDatabaseState } from './issuePatternService';
import { normalizeMomentType } from '../utils/transcriptHeuristics';
import { filterEvidenceList } from '../analysis/callUnderstanding';
import { extractCallEvidence } from '../engine/extractCall';
import { cleanCallIdFromFilename, id } from '../utils/text';
import { nowIso } from '../utils/dates';
import { groundEvidenceToSegments } from '../utils/evidenceTranscript';

const timeoutSignal = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

function requireKey(settings: Settings) {
  if (!settings.openaiApiKey.trim()) throw new Error('Missing OpenAI API key. Add it in Settings first.');
}

async function chatJson(settings: Settings, system: string, user: unknown, ms = 120000) {
  requireKey(settings);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: timeoutSignal(ms),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.openaiApiKey
    },
    body: JSON.stringify({
      model: settings.textModel || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) }
      ]
    })
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || 'OpenAI request failed');
  const json = await res.json();
  try {
    return JSON.parse(json.choices?.[0]?.message?.content || '{}');
  } catch {
    throw new Error('OpenAI returned malformed JSON.');
  }
}

export async function testKey(settings: Settings) {
  await chatJson(settings, 'Return JSON {"ok":true}.', { ping: true }, 30000);
  return true;
}

export async function transcribeAudio(settings: Settings, file: File) {
  return (await transcribeAudioDetailed(settings, file)).text;
}

export async function transcribeAudioDetailed(settings: Settings, file: File) {
  requireKey(settings);
  const model = settings.transcriptionModel || 'whisper-1';
  const form = new FormData();
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('file', file);
  if (model === 'whisper-1') {
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
  }
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    signal: timeoutSignal(180000),
    headers: { Authorization: 'Bearer ' + settings.openaiApiKey },
    body: form
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || 'Transcription failed');
  const json = await res.json();
  const words = (json.words || []).map((word: { start?: number; end?: number; word?: string }) => ({
    start: Number(word.start || 0),
    end: Number(word.end || word.start || 0),
    word: String(word.word || '').trim()
  })).filter((word: { word: string }) => word.word);
  return {
    text: json.text || '',
    duration_seconds: typeof json.duration === 'number' ? Math.round(json.duration) : undefined,
    transcription_model: model,
    words,
    segments: (json.segments || []).map((segment: { start?: number; end?: number; text?: string; speaker?: string }) => {
      const start = Number(segment.start || 0);
      const end = Number(segment.end || segment.start || 0);
      return {
        start,
        end,
        text: String(segment.text || '').trim(),
        speaker: segment.speaker === 'caller' || segment.speaker === 'agent' ? segment.speaker : 'unknown' as const,
        words: words.filter((word: { start: number }) => word.start >= start && word.start <= end)
      };
    }).filter((segment: TranscriptSegment) => segment.text)
  };
}

function buildEvidenceRows(
  callId: string,
  raw: Partial<EvidenceMoment>[],
  now: string,
  segments?: TranscriptSegment[]
): EvidenceMoment[] {
  return raw.map(e => {
    const grounded = groundEvidenceToSegments(e, segments);
    return {
      id: id('ev'),
      call_id: callId,
      speaker: grounded.speaker || 'unknown',
      moment_type: (grounded.moment_type || 'other') as EvidenceMomentType,
      severity: grounded.severity === 'high' || grounded.severity === 'low' ? grounded.severity : 'medium',
      timestamp_start_seconds: Number(grounded.timestamp_start_seconds || 0),
      timestamp_end_seconds: Number(grounded.timestamp_end_seconds || 0),
      quote_or_transcript_excerpt: (grounded.quote_or_transcript_excerpt || '').slice(0, 280),
      explanation: grounded.explanation || '',
      recommended_fix: grounded.recommended_fix || '',
      voice_cue_notes: grounded.voice_cue_notes || '',
      confidence: grounded.confidence,
      linked_issue_suggestion: grounded.linked_issue_suggestion,
      source: (grounded.source === 'ai_suggested'
        ? 'ai_suggested'
        : grounded.source === 'audio_listener'
          ? 'audio_listener'
          : 'ai') as EvidenceMoment['source'],
      reviewer_status: 'pending' as const,
      reviewer_label: grounded.reviewer_label,
      reviewer_note: grounded.reviewer_note,
      segment_starts: grounded.segment_starts,
      pinned: grounded.pinned,
      created_at: now,
      updated_at: now
    };
  });
}

function capRiskHints(raw: string, maxLines = 2): string {
  if (!raw) return '';
  return raw
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');
}

export function buildCallFromAiOutput(
  out: Record<string, unknown>,
  input: {
    transcript?: string;
    transcriptSegments?: TranscriptSegment[];
    file?: { name: string; size: number; type: string; lastModified: number };
    reviewerContext?: string;
    existingCallId?: string;
    settings?: Settings;
    workspace?: CallReview['workspace'];
    botVersion?: CallReview['bot_version'];
  }
) {
  const settings = input.settings || defaultSettings;
  const now = nowIso();
  const transcript = String(input.transcript || out.transcript || '');
  const callId = input.existingCallId || id('call');
  const originalIntent = String(out.original_intent_summary || out.caller_original_intent || '');

  const understanding = buildCallUnderstanding(transcript, input.transcriptSegments, out);

  const sanitized = extractCallEvidence(transcript, input.transcriptSegments, out, callId, settings);
  const riskHints = capRiskHints(String(out.risk_hints || '').trim());
  const momentsOfInterest = '';

  const mainIssue = normalizeMainIssueLabel(String(out.main_issue || out.primary_issue_label || ''));
  const secondary = parseSecondaryIssues(out.secondary_issues);

  let call: Partial<CallReview> = {
    id: callId,
    call_id: String(out.call_id || (input.file ? cleanCallIdFromFilename(input.file.name) : id('callid'))),
    date: String(out.date || new Date().toISOString().slice(0, 10)),
    duration_seconds: Number(out.duration_seconds || 0),
    customer_type: String(out.customer_type || ''),
    caller_context: understanding.customer_goal || originalIntent || String(input.reviewerContext || ''),
    original_intent_summary: originalIntent || understanding.customer_goal,
    final_outcome: String(out.final_outcome || ''),
    anliegen: understanding.anliegen,
    solved_status: resolveSolvedStatus(out.solved_status, transcript, input.transcriptSegments, understanding),
    workflow_node: String(out.workflow_node || ''),
    root_cause_category: (out.root_cause_category as CallReview['root_cause_category']) || 'Other',
    breakpoint_notes: String(out.breakpoint_notes || riskHints || ''),
    ai_risk_hints: riskHints || undefined,
    ai_moments_of_interest: momentsOfInterest || undefined,
    suggested_improvement: String(out.suggested_improvement || ''),
    call_summary: String(
      out.call_summary ||
        [originalIntent, out.final_outcome].filter(Boolean).join(' ')
    ),
    secondary_issues: secondary,
    primary_issue_label: mainIssue || undefined,
    transcript,
    transcript_segments: input.transcriptSegments,
    audio_file_name: input.file?.name || '',
    audio_file_size: input.file?.size || 0,
    audio_file_type: input.file?.type || '',
    audio_file_last_modified: input.file?.lastModified || 0,
    linked_issue_ids: [],
    workspace: input.workspace || 'production',
    bot_version: input.botVersion || 'production',
    conversational_quality: Number(out.conversational_quality) || undefined,
    operational_reliability: Number(out.operational_reliability) || undefined,
    sub_tags: Array.isArray(out.sub_tags) ? (out.sub_tags as string[]) : undefined,
    created_at: now,
    updated_at: now
  };

  call = syncCallFlagsFromEvidence(call, [], understanding);
  const evidence = buildEvidenceRows(callId, sanitized, now, input.transcriptSegments);
  call = syncCallFlagsFromEvidence(call, evidence, understanding);
  call.reviewer_notes = buildReviewerNotes(
    { ...call, primary_issue_label: mainIssue || call.primary_issue_label },
    evidence,
    String(out.reviewer_notes || ''),
    String(out.main_issue || mainIssue || '')
  );
  const finalized = finalizeCallAnalysis(
    call,
    evidence,
    {
      overall_rating: out.overall_rating,
      naturalness_rating: out.naturalness_rating
    },
    understanding
  );
  return { call: finalized.call, evidence: finalized.evidence };
}

async function labelTranscriptSpeakers(
  settings: Settings,
  transcript: string,
  segments?: TranscriptSegment[]
): Promise<{ transcript: string; segments?: TranscriptSegment[] }> {
  if (!transcript.trim() || transcript.length < 80) return { transcript, segments };
  try {
    const labeled = await chatJson(
      settings,
      SPEAKER_LABEL_SYSTEM,
      { transcript: transcript.slice(0, 28000), segments: segments?.slice(0, 200) },
      120000
    );
    const nextTranscript = String(labeled.transcript || transcript).trim() || transcript;
    const nextSegments = Array.isArray(labeled.segments)
      ? (labeled.segments as TranscriptSegment[])
          .map(s => ({
            start: Number(s.start || 0),
            end: Number(s.end || 0),
            text: String(s.text || '').trim(),
            speaker: s.speaker === 'caller' || s.speaker === 'agent' ? s.speaker : ('unknown' as const)
          }))
          .filter(s => s.text)
      : segments;
    return { transcript: nextTranscript, segments: nextSegments };
  } catch {
    return { transcript, segments };
  }
}

export async function generateCallDraft(
  settings: Settings,
  input: {
    reviewText?: string;
    transcript?: string;
    transcriptSegments?: TranscriptSegment[];
    file?: { name: string; size: number; type: string; lastModified: number };
    reviewerContext?: string;
    existingCall?: CallReview;
    existingCallId?: string;
    analysisSettings?: Settings;
    workspace?: CallReview['workspace'];
    botVersion?: CallReview['bot_version'];
  }
) {
  let transcript = input.transcript || input.reviewText || '';
  let transcriptSegments = input.transcriptSegments;

  if (transcript.length > 80) {
    const segmentsLabeled = transcriptSegments?.some(
      s => s.speaker === 'caller' || s.speaker === 'agent'
    );
    if (!/^caller:/im.test(transcript) || !segmentsLabeled) {
      const labeled = await labelTranscriptSpeakers(settings, transcript, transcriptSegments);
      transcript = labeled.transcript;
      transcriptSegments = labeled.segments;
    }
  }

  const out = await chatJson(
    settings,
    CALL_REVIEW_SYSTEM,
    {
      reviewer_context: input.reviewerContext || '',
      transcript,
      transcript_segments: transcriptSegments,
      file_name: input.file?.name
    },
    120000
  );

  return buildCallFromAiOutput(out, {
    transcript,
    transcriptSegments,
    file: input.file,
    reviewerContext: input.reviewerContext,
    existingCallId: input.existingCallId || input.existingCall?.id,
    settings: input.analysisSettings || settings,
    workspace: input.workspace || input.existingCall?.workspace,
    botVersion: input.botVersion || input.existingCall?.bot_version
  });
}

export async function reanalyzeCall(
  settings: Settings,
  call: CallReview,
  manualEvidence: EvidenceMoment[] = []
) {
  const { analysisOrchestrator } = await import('./analysisOrchestrator');
  return analysisOrchestrator.reanalyzeCall(settings, call, manualEvidence);
}

export function applyRecalculatedResultLabels(db: Database): Database {
  const now = nowIso();
  const keptEvidence: EvidenceMoment[] = [];

  const calls = db.calls.map(call => {
    const transcript = call.transcript || call.call_summary || '';
    const understanding = buildCallUnderstanding(transcript, call.transcript_segments, {
      caller_request: call.anliegen,
      original_intent_summary: call.original_intent_summary || call.caller_context,
      solved_status: call.solved_status
    });
    const callEvidence = db.evidence
      .filter(e => e.call_id === call.id)
      .map(e => ({
        ...e,
        moment_type: normalizeMomentType(String(e.moment_type))
      }));
    const manual = callEvidence.filter(e => e.source === 'manual' || !e.source);
    const filteredAi = filterEvidenceList(
      callEvidence.filter(e => e.source === 'ai' || e.source === 'ai_suggested'),
      understanding,
      transcript,
      2
    ) as EvidenceMoment[];
    const ev = [...manual, ...filteredAi];
    keptEvidence.push(...ev);

    const solved_status = resolveSolvedStatus(
      call.solved_status,
      transcript,
      call.transcript_segments,
      understanding
    );
    const synced = syncCallFlagsFromEvidence(
      {
        ...call,
        solved_status,
        anliegen: understanding.anliegen
      },
      ev,
      understanding
    );
    const finalized = finalizeCallAnalysis(synced, ev, undefined, understanding);
    return { ...synced, ...finalized.call, updated_at: now } as CallReview;
  });

  return finalizeDatabaseState({ ...db, calls, evidence: keptEvidence });
}

export function buildProjectPayload(db: Database) {
  return {
    active_issues: db.issues.filter(i => !['resolved', 'ignored'].includes(i.status)).slice(0, 5),
    caller_request_counts: db.calls.reduce((a: Record<string, number>, c) => {
      a[c.anliegen] = (a[c.anliegen] || 0) + 1;
      return a;
    }, {}),
    recent_calls: db.calls.slice(0, 5).map(c => ({
      call_id: c.call_id,
      anliegen: c.anliegen,
      solved_status: c.solved_status,
      rating: c.overall_rating,
      summary: c.call_summary,
      main_issue: c.primary_issue_label
    })),
    experiments: db.experiments.slice(0, 5),
    memory: db.memory.filter(m => m.importance !== 'low').slice(0, 8).map(m => m.memory_text)
  };
}

export async function getAiInsights(settings: Settings, db: Database) {
  return chatJson(settings, 'Return strict JSON with primary_focus, why, next_steps array of 3, experiment, success_metric.', buildProjectPayload(db), 90000);
}

export function localRecommendation(db: Database) {
  const issue = db.issues
    .filter(i => !['resolved', 'ignored'].includes(i.status))
    .sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1))[0];
  const counts = db.calls.reduce((a: Record<string, number>, c) => {
    a[c.anliegen] = (a[c.anliegen] || 0) + 1;
    return a;
  }, {});
  const top = Object.entries(counts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || 'other';
  return {
    primary_focus: issue?.title || 'Review the next unsolved call',
    why: issue?.description || 'No active issue has enough evidence yet.',
    next_steps: ['Review highest severity evidence', 'Link two exact call examples', 'Define one small experiment'],
    experiment: issue?.suggested_fix || 'Create a narrow prompt or workflow test.',
    success_metric: 'Fewer unresolved calls for ' + top
  };
}

export async function askAi(settings: Settings, payload: Record<string, unknown>) {
  const system = String(
    payload.system ||
      'You are a Pflegebox QA assistant. Answer with operational clarity. Return JSON {"answer":"..."} where answer is markdown text.'
  );
  const user = {
    question: payload.question,
    context: payload.context,
    conversation: payload.conversation,
    focus: payload.focus
  };
  return chatJson(settings, system, user, 120000);
}

function maxEvidenceFromSettings(settings: Settings): number {
  let n = settings.evidenceSensitivity === 'low' ? 1 : settings.evidenceSensitivity === 'high' ? 2 : 2;
  if (settings.analysisStrictness === 'strict') n = Math.min(n, 1);
  if (settings.analysisStrictness === 'lenient') n = Math.min(n + 1, 2);
  return Math.min(n, 2);
}

export async function generateExperimentDraft(settings: Settings, text: string): Promise<Partial<Experiment>> {
  return chatJson(settings, 'Turn experiment notes into strict Experiment JSON.', { text }, 75000);
}
