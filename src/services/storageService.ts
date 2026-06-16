import type { CallReview, SolvedStatus } from '../types/CallReview';
import type { Issue } from '../types/Issue';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type { Experiment } from '../types/Experiment';
import type { MemoryItem } from '../types/MemoryItem';
import type { SavedInsight } from '../types/Insight';
import type { PatternThread } from '../types/PatternThread';
import type { DraftCall } from '../types/DraftCall';
import type { Taxonomy } from '../types/Taxonomy';
import { defaultTaxonomy } from '../types/Taxonomy';
import type { PersonalTask } from '../types/PersonalTask';
import type { WorkspaceNote } from '../types/WorkspaceNote';
import type { LeapingRawCall } from '../types/Leaping';
import { finalizeDatabaseState } from './issuePatternService';
import { nowIso } from '../utils/dates';
import { computeRatings, resolveCallerRequest, resolveSolvedStatus, syncCallFlagsFromEvidence } from '../utils/callAnalysis';
import { deriveMainIssue } from '../utils/issueLabels';
import { normalizeMomentType } from '../utils/transcriptHeuristics';
import { normalizeCallerRequest } from '../utils/filterNormalize';
import { callWorkspace } from '../utils/workspace';
import { LEAPING_SUPABASE_ANON_KEY } from './leapingSupabaseConfig';

function isValidSolvedStatus(value: unknown): value is SolvedStatus {
  return value === 'yes' || value === 'partially' || value === 'no';
}

export type AnalysisStrictness = 'standard' | 'strict' | 'lenient';
export type EvidenceSensitivity = 'low' | 'medium' | 'high';
export type AudioListenerMode = 'all' | 'suspicious';

export interface Settings {
  openaiApiKey: string;
  textModel: string;
  transcriptionModel: string;
  autoIngestFolder: string;
  analysisStrictness: AnalysisStrictness;
  evidenceSensitivity: EvidenceSensitivity;
  audioListenerEnabled: boolean;
  audioListenerMode: AudioListenerMode;
  audioListenerModel: string;
  maxAudioClipsPerCall: number;
  maxClipSeconds: number;
  alwaysListenFullCallUnderSeconds: number;
  leapingApiUrl: string;
  leapingLoginUrl: string;
  leapingUsername: string;
  leapingPassword: string;
  leapingApiKey: string;
  /** Supabase anon/public key — required for Leaping Supabase Auth login & refresh. */
  leapingSupabaseAnonKey?: string;
  leapingAccessToken?: string;
  leapingRefreshToken?: string;
  leapingTokenExpiresAt?: string;
  /** How many Leaping calls to fetch per import (default 50). */
  leapingImportBatchSize?: number;
  /** Run OpenAI extraction after Leaping import, merged with system rules. */
  leapingEnrichWithAi?: boolean;
  dbRecoveryNotice?: string;
}

export interface Database {
  calls: CallReview[];
  issues: Issue[];
  evidence: EvidenceMoment[];
  experiments: Experiment[];
  memory: MemoryItem[];
  insights: SavedInsight[];
  patternThreads?: PatternThread[];
  drafts?: DraftCall[];
  taxonomy?: Taxonomy;
  personalTasks?: PersonalTask[];
  personalNotes?: { id: string; text: string; created_at: string; updated_at: string }[];
  workspaceNotes?: WorkspaceNote[];
  leapingRawCalls?: LeapingRawCall[];
  leapingLastImportAt?: string;
  settings: Settings;
  seeded: boolean;
}

export const DB_KEY = 'pflegemittelbox-qa-db-v1';
const LEGACY_KEY = 'ai-call-qa-cockpit-db-v1';
const t = nowIso();

export const defaultSettings: Settings = {
  openaiApiKey: '',
  textModel: 'gpt-4o-mini',
  transcriptionModel: 'whisper-1',
  autoIngestFolder: '',
  analysisStrictness: 'strict',
  evidenceSensitivity: 'low',
  audioListenerEnabled: true,
  audioListenerMode: 'all',
  audioListenerModel: 'gpt-audio-1.5',
  maxAudioClipsPerCall: 2,
  maxClipSeconds: 30,
  alwaysListenFullCallUnderSeconds: 1200,
  leapingApiUrl: '',
  leapingLoginUrl: 'https://vcugyztbqrrsddgolqbz-all.supabase.co/auth/v1/token?grant_type=password',
  leapingUsername: '',
  leapingPassword: '',
  leapingApiKey: '',
  leapingSupabaseAnonKey: LEAPING_SUPABASE_ANON_KEY,
  leapingImportBatchSize: 50,
  leapingEnrichWithAi: true
};

function emptyDatabase(): Database {
  return {
    calls: [],
    issues: [],
    evidence: [],
    experiments: [],
    memory: [],
    insights: [],
    patternThreads: [],
    drafts: [],
    taxonomy: defaultTaxonomy,
    personalTasks: [],
    personalNotes: [],
    workspaceNotes: [],
    leapingRawCalls: [],
    settings: defaultSettings,
    seeded: false
  };
}

export function seedDatabase(): Database {
  const calls: CallReview[] = [
    { id: 'call_1', call_id: '019e171f-74fa-768c-9a67-5a9439f692e4', date: '2026-05-17', duration_seconds: 421, customer_type: 'Older caller, slow speech', caller_context: 'Caller wants to cancel because supplies are piling up.', anliegen: 'cancel_or_pause', solved_status: 'partially', overall_rating: 5, naturalness_rating: 4, caller_cut_off: true, awkward_pauses: true, robotic_pacing: false, latency_too_long: true, repeated_question: false, identification_problem: false, missing_integration: false, workflow_node: 'Cancellation retention', root_cause_category: 'Interruption behavior', breakpoint_notes: 'Agent interrupted during cancellation reason; caller accepted pause only after confusion.', suggested_improvement: 'Increase endpointing patience before retention offer.', reviewer_notes: 'Good example for weekly review.', call_summary: 'Caller originally wanted cancellation. Bot steered to pause and cut off caller twice.', transcript: 'Caller: Ich moechte kuendigen, bitte. Agent: Ich kann Ihnen eine Pause anbieten. Caller: Hallo? Ich wollte eigentlich erklaeren warum. Agent: Einen Moment. Caller: Sind Sie noch da?', audio_file_name: '019e171f-74fa-768c-9a67-5a9439f692e4-call-recording.wav', audio_file_size: 8432112, audio_file_type: 'audio/wav', audio_file_last_modified: Date.now() - 86400000, linked_issue_ids: ['issue_1'], workspace: 'production', bot_version: 'production', created_at: t, updated_at: t },
    { id: 'call_2', call_id: 'LEAP-3402', date: '2026-05-16', duration_seconds: 315, customer_type: 'Slow speaking caller', caller_context: 'Caller checks where the Pflegebox delivery is.', anliegen: 'order_status', solved_status: 'no', overall_rating: 4, naturalness_rating: 6, caller_cut_off: false, awkward_pauses: true, robotic_pacing: false, latency_too_long: true, repeated_question: false, identification_problem: false, missing_integration: true, workflow_node: 'Shipment lookup', root_cause_category: 'Missing integration', breakpoint_notes: 'No shipment lookup available; caller had to be escalated.', suggested_improvement: 'Expose shipment status or give honest fallback faster.', reviewer_notes: 'Shows missing integration clearly.', call_summary: 'Order-status request failed because shipment data was unavailable.', transcript: 'Caller: Wo ist meine Box? Agent: Einen Moment. Agent: Dazu habe ich gerade keinen Zugriff. Caller: Also weiss niemand wo das Paket ist?', audio_file_name: 'leap-3402.m4a', audio_file_size: 3222112, audio_file_type: 'audio/m4a', audio_file_last_modified: Date.now() - 172800000, linked_issue_ids: ['issue_2'], workspace: 'production', bot_version: 'production', created_at: t, updated_at: t },
    { id: 'call_3', call_id: 'AUTH-9910', date: '2026-05-14', duration_seconds: 512, customer_type: 'Older caller', caller_context: 'Caller needs address update after moving.', anliegen: 'address_or_account_change', solved_status: 'partially', overall_rating: 6, naturalness_rating: 5, caller_cut_off: false, awkward_pauses: false, robotic_pacing: true, latency_too_long: false, repeated_question: true, identification_problem: true, missing_integration: false, workflow_node: 'Authentication', root_cause_category: 'Identification/auth issue', breakpoint_notes: 'DOB and insurance number requested repeatedly.', suggested_improvement: 'Confirm captured values and reduce repeated auth prompts.', reviewer_notes: 'Authentication loop is the problem, not intent classification.', call_summary: 'Address change stalled during repeated identification.', transcript: 'Agent: Bitte nennen Sie Ihr Geburtsdatum. Caller: 12.03.1948. Agent: Bitte nennen Sie Ihr Geburtsdatum. Caller: Das habe ich doch gesagt.', audio_file_name: 'auth-9910.webm', audio_file_size: 2109981, audio_file_type: 'audio/webm', audio_file_last_modified: Date.now() - 360000000, linked_issue_ids: ['issue_3'], workspace: 'production', bot_version: 'production', created_at: t, updated_at: t },
    { id: 'call_4', call_id: 'BOX-7781', date: '2026-05-10', duration_seconds: 260, customer_type: 'Standard caller', caller_context: 'Caller asks for different product in box.', anliegen: 'box_or_product_change', solved_status: 'yes', overall_rating: 8, naturalness_rating: 7, caller_cut_off: false, awkward_pauses: false, robotic_pacing: false, latency_too_long: false, repeated_question: false, identification_problem: false, missing_integration: false, workflow_node: 'Product change', root_cause_category: 'Other', breakpoint_notes: 'Worked as intended.', suggested_improvement: 'None.', reviewer_notes: 'Positive reference call.', call_summary: 'Product change completed successfully.', transcript: 'Caller: Ich brauche andere Produkte. Agent: Ich pruefe die verfuegbaren Optionen.', audio_file_name: 'box-7781.mp3', audio_file_size: 1800000, audio_file_type: 'audio/mp3', audio_file_last_modified: Date.now() - 540000000, linked_issue_ids: [], workspace: 'production', bot_version: 'production', created_at: t, updated_at: t },
    { id: 'call_5', call_id: 'PAUSE-4472', date: '2026-05-08', duration_seconds: 398, customer_type: 'Older caller with hearing difficulty', caller_context: 'Caller wants pause while in hospital.', anliegen: 'cancel_or_pause', solved_status: 'partially', overall_rating: 5, naturalness_rating: 3, caller_cut_off: true, awkward_pauses: false, robotic_pacing: true, latency_too_long: false, repeated_question: true, identification_problem: false, missing_integration: false, workflow_node: 'Pause flow', root_cause_category: 'TTS / voice naturalness', breakpoint_notes: 'Rigid pacing caused caller to ask whether agent heard them.', suggested_improvement: 'Slow down TTS and add confirmation after long caller turns.', reviewer_notes: 'Strong older-caller usability evidence.', call_summary: 'Pause flow completed but felt brittle and robotic.', transcript: 'Caller: Ich bin im Krankenhaus und brauche eine Pause. Agent: Waehlen Sie eine Option. Caller: Hoeren Sie mich? Agent: Waehlen Sie eine Option.', audio_file_name: 'pause-4472.ogg', audio_file_size: 2500000, audio_file_type: 'audio/ogg', audio_file_last_modified: Date.now() - 720000000, linked_issue_ids: ['issue_1', 'issue_4'], workspace: 'production', bot_version: 'production', created_at: t, updated_at: t }
  ];
  const issues: Issue[] = [
    { id: 'issue_1', title: 'Older callers are interrupted before finishing intent', category: 'Interruption behavior', severity: 'high', status: 'active', description: 'Endpointing is too aggressive when callers pause mid-sentence, causing cut-offs and confused restarts.', suggested_fix: 'Increase silence tolerance for older/slow-speaking caller segments and confirm intent before retention offers.', notes: 'Use cancellation and pause calls as evidence. This is the current meeting focus.', linked_call_ids: ['call_1', 'call_5'], experiment_id: 'exp_1', created_at: t, updated_at: t },
    { id: 'issue_2', title: 'Order status fails without shipment lookup', category: 'Missing integration', severity: 'high', status: 'investigating', description: 'Agent cannot answer delivery-location requests and escalates after a long pause.', suggested_fix: 'Add shipment lookup integration or faster truthful fallback.', notes: 'Quantify how many order-status calls hit this.', linked_call_ids: ['call_2'], created_at: t, updated_at: t },
    { id: 'issue_3', title: 'Authentication repeats DOB or insurance number', category: 'Identification/auth issue', severity: 'medium', status: 'active', description: 'Captured values are not acknowledged, so callers repeat sensitive details.', suggested_fix: 'Echo confirmation and route to human after two failed captures.', notes: 'Watch for DOB loop.', linked_call_ids: ['call_3'], created_at: t, updated_at: t },
    { id: 'issue_4', title: 'Rigid voice pacing causes caller confusion', category: 'TTS / voice naturalness', severity: 'medium', status: 'testing', description: 'The agent sounds command-like in option flows and does not reassure callers.', suggested_fix: 'Softer prompts and slower pacing in pause/product flows.', notes: 'Compare after TTS pacing change.', linked_call_ids: ['call_5'], created_at: t, updated_at: t }
  ];
  const evidence: EvidenceMoment[] = [
    { id: 'ev_1', call_id: 'call_1', issue_id: 'issue_1', timestamp_start_seconds: 88, speaker: 'caller', moment_type: 'caller_cut_off', severity: 'high', quote_or_transcript_excerpt: 'Hallo? Ich wollte eigentlich erklaeren warum.', explanation: 'Caller signals they were interrupted before explaining cancellation reason.', recommended_fix: 'Delay retention offer until full intent and reason are captured.', voice_cue_notes: 'Caller sounded hesitant after interruption.', created_at: t, updated_at: t },
    { id: 'ev_2', call_id: 'call_1', issue_id: 'issue_1', timestamp_start_seconds: 124, speaker: 'caller', moment_type: 'long_pause', severity: 'medium', quote_or_transcript_excerpt: 'Sind Sie noch da?', explanation: 'Caller experiences a silence long enough to check whether agent is present.', recommended_fix: 'Use short wait-state acknowledgement before backend work.', voice_cue_notes: 'Uncertain tone.', created_at: t, updated_at: t },
    { id: 'ev_3', call_id: 'call_2', issue_id: 'issue_2', timestamp_start_seconds: 142, speaker: 'agent', moment_type: 'missing_integration', severity: 'high', quote_or_transcript_excerpt: 'Dazu habe ich gerade keinen Zugriff.', explanation: 'Shipment status request cannot be resolved in-flow.', recommended_fix: 'Integrate delivery status or immediately offer concrete next path.', voice_cue_notes: 'Agent pause before admission.', created_at: t, updated_at: t },
    { id: 'ev_4', call_id: 'call_3', issue_id: 'issue_3', timestamp_start_seconds: 201, speaker: 'agent', moment_type: 'authentication_friction', severity: 'medium', quote_or_transcript_excerpt: 'Bitte nennen Sie Ihr Geburtsdatum. ... Bitte nennen Sie Ihr Geburtsdatum.', explanation: 'Agent asks for DOB twice after caller answered.', recommended_fix: 'Persist captured authentication slot and confirm when low confidence.', voice_cue_notes: 'Caller frustration increases.', created_at: t, updated_at: t },
    { id: 'ev_5', call_id: 'call_5', issue_id: 'issue_4', speaker: 'caller', moment_type: 'robotic_pacing', severity: 'medium', quote_or_transcript_excerpt: 'Hoeren Sie mich?', explanation: 'Caller interprets rigid option prompt as failure to hear their situation.', recommended_fix: 'Acknowledge hospital context before offering pause options.', voice_cue_notes: 'Caller speaks louder and slower.', created_at: t, updated_at: t }
  ];
  const experiments: Experiment[] = [{ id: 'exp_1', date: '2026-05-18', experiment_name: 'Increase endpointing patience for slow callers', linked_issue_id: 'issue_1', changed_setting: 'Endpoint silence threshold', old_value: '700ms', new_value: '1300ms for older/slow caller heuristic', expected_effect: 'Fewer interruptions during cancellation and pause explanations.', actual_effect: 'Awaiting next call sample.', result: 'inconclusive', related_call_ids: ['call_1', 'call_5'], notes: 'Review 10 new calls before marking better/worse.', created_at: t, updated_at: t }];
  const memory: MemoryItem[] = [
    { id: 'mem_1', scope: 'project', memory_text: 'Older/slower callers are vulnerable to interruption during problem description.', source: 'auto_from_issue', importance: 'high', created_at: t, updated_at: t },
    { id: 'mem_2', scope: 'project', memory_text: 'Order-status calls fail when shipment lookup is unavailable.', source: 'auto_from_call', importance: 'high', created_at: t, updated_at: t },
    { id: 'mem_3', scope: 'issue', memory_text: 'Authentication friction appears when DOB or insurance number is requested repeatedly.', source: 'auto_from_issue', importance: 'medium', created_at: t, updated_at: t }
  ];
  return {
    calls,
    issues,
    evidence,
    experiments,
    memory,
    insights: [],
    patternThreads: [],
    drafts: [],
    taxonomy: defaultTaxonomy,
    personalTasks: [],
    personalNotes: [],
    workspaceNotes: [],
    leapingRawCalls: [],
    settings: defaultSettings,
    seeded: true
  };
}

export function migrateDatabase(parsed: Partial<Database>): Database {
  const seed = seedDatabase();
  const db: Database = {
    ...seed,
    ...parsed,
    settings: { ...defaultSettings, ...parsed.settings },
    taxonomy: parsed.taxonomy || defaultTaxonomy,
    patternThreads: parsed.patternThreads || [],
    drafts: parsed.drafts || [],
    insights: parsed.insights || [],
    personalTasks: parsed.personalTasks || [],
    personalNotes: parsed.personalNotes || [],
    workspaceNotes: parsed.workspaceNotes || [],
    leapingRawCalls: parsed.leapingRawCalls || [],
    leapingLastImportAt: parsed.leapingLastImportAt
  };
  db.calls = (parsed.calls || seed.calls).map(raw => {
    const call = {
      workspace: 'production' as const,
      bot_version: 'production' as const,
      pinned: false,
      critical: false,
      watch_later: false,
      needs_review: false,
      investigation_starred: false,
      training_example: false,
      engineering_escalated: false,
      reviewer_tags: [],
      ...raw
    };
    const ev = (parsed.evidence || seed.evidence).filter((e: { call_id: string }) => e.call_id === (call as CallReview).id);
    const intent = call.original_intent_summary || call.caller_context || '';
    const existingAnliegen = normalizeCallerRequest(call.anliegen);
    const anliegen =
      !call.anliegen || (existingAnliegen === 'other' && !intent.trim())
        ? resolveCallerRequest(call.anliegen, intent, call.transcript)
        : call.anliegen;
    const solved_status = isValidSolvedStatus(call.solved_status)
      ? call.solved_status
      : resolveSolvedStatus(call.solved_status, call.transcript || call.call_summary || '');
    const synced = syncCallFlagsFromEvidence({ ...call, anliegen, solved_status }, ev);
    const ratings = computeRatings(synced as CallReview, ev);
    const primary_issue_label = deriveMainIssue(synced, ev);
    return { ...synced, ...ratings, primary_issue_label } as CallReview;
  });
  db.evidence = (parsed.evidence || seed.evidence).map((e: EvidenceMoment) => ({
    ...e,
    moment_type: normalizeMomentType(String(e.moment_type || 'other'))
  }));
  db.drafts = (parsed.drafts || []).map((d: DraftCall) =>
    d.status === 'processing'
      ? { ...d, status: 'failed' as const, error: 'Import interrupted — open draft and reanalyze', processing_step: undefined }
      : d
  );
  return finalizeDatabaseState(db);
}

function tryMigrateLegacy(): Database | null {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as Partial<Database>;
    const migrated = migrateDatabase({
      ...parsed,
      calls: (parsed.calls || []).map(c => ({
        ...c,
        workspace: c.workspace || 'production',
        bot_version: c.bot_version || 'production'
      }))
    });
    localStorage.setItem(DB_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return null;
  }
}

export const loadDb = (): Database => {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return migrateDatabase(JSON.parse(raw));
    const legacy = tryMigrateLegacy();
    if (legacy) return legacy;
  } catch {
    const db = seedDatabase();
    db.settings = {
      ...db.settings,
      dbRecoveryNotice:
        'Your local database could not be loaded — demo data was restored. Export regularly from Settings.'
    };
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
  }
  const db = seedDatabase();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
};

export const saveDb = (db: Database) => localStorage.setItem(DB_KEY, JSON.stringify(db));

export const clearDb = () => {
  const db = emptyDatabase();
  saveDb(db);
  return db;
};

export const resetDemoDb = () => {
  const db = seedDatabase();
  saveDb(db);
  return db;
};

function pruneCalls(db: Database, keep: (c: CallReview) => boolean): Database {
  const calls = db.calls.filter(keep);
  const callIds = new Set(calls.map(c => c.id));
  return finalizeDatabaseState({
    ...db,
    calls,
    evidence: db.evidence.filter(e => callIds.has(e.call_id)),
    issues: db.issues.map(i => ({
      ...i,
      linked_call_ids: i.linked_call_ids.filter(id => callIds.has(id))
    })),
    experiments: db.experiments.map(e => ({
      ...e,
      related_call_ids: e.related_call_ids.filter(id => callIds.has(id))
    }))
  });
}

export const clearProductionCalls = (db: Database) =>
  pruneCalls(db, c => callWorkspace(c) === 'production');

export const clearTestCalls = (db: Database) =>
  pruneCalls(db, c => callWorkspace(c) === 'test');
