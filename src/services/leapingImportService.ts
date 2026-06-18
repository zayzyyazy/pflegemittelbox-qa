import type { Database, Settings } from './storageService';
import type {
  AnliegenCategory,
  CallReview,
  MarieCallStatus,
  MarieFunctionCall,
  MarieMainResult,
  MarieTransition,
  TranscriptSegment
} from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { finalizeDatabaseState } from './issuePatternService';
import { persistAudioFile } from './audioStorageService';
import { normalizeCallerRequest } from '../utils/filterNormalize';
import { id } from '../utils/text';
import { nowIso } from '../utils/dates';
import { extractEntitiesFromTranscript } from '../utils/entityExtract';
import { buildReviewObject } from '../utils/reviewObject';
import { buildMarieOperationTrace } from '../utils/marieOperationTrace';
import { buildOperationalFailures, hasHighSeverityOperationalFailure, primaryOperationalFailure } from '../utils/operationalFailures';
import { applyExplorationVerdict } from '../utils/explorationBrief';

function findExistingLeapingMergeIndex(calls: CallReview[], normalized: { call: CallReview; rawId: string }) {
  return calls.findIndex(
    c =>
      c.id === normalized.call.id ||
      c.leaping_call_id === normalized.rawId ||
      c.call_id === normalized.rawId
  );
}

function mergeLeapingOntoExistingCall(existing: CallReview, normalized: CallReview, rawId: string): CallReview {
  const merged = {
    ...normalized,
    ...existing,
    id: existing.id,
    call_id: existing.call_id || normalized.call_id,
    leaping_call_id: rawId,
    leaping_raw_id: rawId,
    function_calls: normalized.function_calls,
    leaping_transcript_events: normalized.leaping_transcript_events,
    transitions: normalized.transitions,
    operation_trace: normalized.operation_trace,
    leaping_detail_url: normalized.leaping_detail_url || existing.leaping_detail_url,
    leaping_status: normalized.leaping_status || existing.leaping_status,
    leaping_snapshot_id: normalized.leaping_snapshot_id || existing.leaping_snapshot_id,
    raw_metadata: normalized.raw_metadata || existing.raw_metadata,
    recording_url: existing.recording_url || normalized.recording_url,
    workspace: existing.workspace || normalized.workspace,
    exploration_brief: existing.exploration_brief,
    pinned: existing.pinned,
    reviewer_call_notes: existing.reviewer_call_notes,
    audio_local_path: existing.audio_local_path || normalized.audio_local_path,
    audio_storage_key: existing.audio_storage_key || normalized.audio_storage_key,
    audio_file_name: existing.audio_file_name || normalized.audio_file_name,
    audio_file_size: existing.audio_file_size || normalized.audio_file_size,
    audio_file_type: existing.audio_file_type || normalized.audio_file_type,
    transcript: existing.transcript || normalized.transcript,
    transcript_segments: existing.transcript_segments?.length ? existing.transcript_segments : normalized.transcript_segments
  } as CallReview;

  if (merged.exploration_brief?.trim()) {
    return applyExplorationVerdict(merged, merged.exploration_brief) as CallReview;
  }
  return merged;
}

const MIN_CALL_SECONDS = 50;

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
}

function firstString(obj: Obj, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function firstNumber(obj: Obj, keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function nested(obj: Obj, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const part of path) cur = asObj(cur)[part];
    if (cur != null && cur !== '') return cur;
  }
  return undefined;
}

function normalizeStatus(raw: string): MarieCallStatus {
  const s = raw.toLowerCase();
  if (/transfer/.test(s)) return 'transferred';
  if (/drop|abandon|hang/.test(s)) return 'dropped';
  if (/fail|error/.test(s)) return 'failed';
  if (/complete|done|success|ended/.test(s)) return 'completed';
  return 'unknown';
}

function normalizeTranscriptSegments(raw: unknown): TranscriptSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const segments = raw.map<TranscriptSegment | null>(item => {
    const s = asObj(item);
    const type = firstString(s, ['type']);
    if (type && type !== 'message' && type !== 'chat_message') return null;
    const sender = firstString(s, ['sender', 'speaker', 'role']).toLowerCase();
    return {
      start: firstNumber(s, ['start', 'start_seconds', 'start_time']),
      end: firstNumber(s, ['end', 'end_seconds', 'end_time']),
      speaker: sender.includes('bot') || sender.includes('agent') || sender.includes('marie') ? 'agent' as const :
        sender.includes('human') || sender.includes('caller') || sender.includes('user')
          ? 'caller' as const
          : 'unknown' as const,
      text: firstString(s, ['text', 'transcript', 'content', 'message'])
    };
  }).filter((s): s is TranscriptSegment => !!s && !!s.text);
  return segments.length ? segments : undefined;
}

function rawTranscriptEvents(raw: Obj): unknown[] {
  const value = nested(raw, [['transcript'], ['events'], ['messages'], ['call', 'transcript'], ['results', 'transcript']]);
  // Capped at 80 to keep localStorage usage manageable (was 500 — caused QuotaExceededError)
  return Array.isArray(value) ? value.slice(0, 80) : [];
}

function endFieldsFromEvents(events: unknown[]): Obj {
  const end = [...events].reverse().find(item => asObj(item).type === 'end');
  return asObj(asObj(end).fields);
}

function transcriptFrom(raw: Obj, segments?: TranscriptSegment[], events: unknown[] = []) {
  const direct = firstString(raw, ['transcript', 'transcription', 'text']);
  if (direct) return direct;
  const nestedTranscript = nested(raw, [['call', 'transcript'], ['analysis', 'transcript'], ['results', 'transcript']]);
  if (typeof nestedTranscript === 'string') return nestedTranscript;
  return segments?.map(s => `${s.speaker}: ${s.text}`).join('\n') ||
    events
      .map(item => {
        const e = asObj(item);
        const type = firstString(e, ['type']);
        if (type !== 'message' && type !== 'chat_message') return '';
        const sender = firstString(e, ['sender']) || 'unknown';
        const text = firstString(e, ['text', 'message', 'content']);
        return text ? `${sender}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
}

function normalizeFunctionCalls(raw: Obj, events: unknown[] = []): MarieFunctionCall[] {
  const value =
    nested(raw, [['function_calls'], ['tool_calls'], ['events'], ['results', 'function_calls'], ['metadata', 'function_calls']]);
  const eventCalls = events
    .map(item => asObj(item))
    .filter(e => e.type === 'function_call_request' || e.type === 'function')
    .map(e => ({
      name: firstString(e, ['name']),
      status: e.type === 'function'
        ? (e.error ? 'error' as const : 'success' as const)
        : 'unknown' as const,
      arguments: asObj(e.args),
      result: e.returned ?? e.error,
      timestamp_seconds: firstNumber(e, ['time', 'timestamp_seconds', 'seconds', 'seq'])
    }));
  const list = [...(Array.isArray(value) ? value : []), ...eventCalls];
  return list.map(item => {
    const f = asObj(item);
    const name = firstString(f, ['name', 'function', 'tool_name', 'event', 'node']);
    const status = firstString(f, ['status', 'result_status', 'outcome']).toLowerCase();
    const normalizedStatus: MarieFunctionCall['status'] =
      /error|fail/.test(status) ? 'error' : /success|ok|done/.test(status) ? 'success' : 'unknown';
    return {
      name,
      status: normalizedStatus,
      arguments: asObj(f.arguments || f.args || f.input),
      result: f.result ?? f.output ?? f.response,
      timestamp_seconds: firstNumber(f, ['timestamp_seconds', 'time', 'seconds', 'start'])
    };
  }).filter(f => f.name);
}

function normalizeTransitions(raw: Obj, events: unknown[] = []): MarieTransition[] {
  const value = nested(raw, [['transitions'], ['nodes'], ['events'], ['metadata', 'transitions']]);
  const eventTransitions = events
    .map(item => asObj(item))
    .filter(e => e.type === 'transition')
    .map(e => ({
      from: firstString(e, ['from_name', 'from']),
      to: firstString(e, ['to_name', 'to']),
      node: firstString(e, ['name']),
      label: firstString(e, ['name']),
      timestamp_seconds: firstNumber(e, ['time', 'timestamp_seconds', 'seconds', 'seq'])
    }));
  const list = [...(Array.isArray(value) ? value : []), ...eventTransitions];
  return list.map(item => {
    const t = asObj(item);
    return {
      from: firstString(t, ['from', 'source']),
      to: firstString(t, ['to', 'target']),
      node: firstString(t, ['node', 'name', 'label']),
      label: firstString(t, ['label', 'event']),
      timestamp_seconds: firstNumber(t, ['timestamp_seconds', 'time', 'seconds', 'start'])
    };
  }).filter(t => t.from || t.to || t.node || t.label);
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some(re => re.test(text));
}

function inferResult(functions: MarieFunctionCall[], transitions: MarieTransition[], status: MarieCallStatus, transcript: string): MarieMainResult {
  const names = functions.map(f => f.name.toLowerCase()).join(' ');
  const nodes = transitions.map(t => `${t.from || ''} ${t.to || ''} ${t.node || ''} ${t.label || ''}`.toLowerCase()).join(' ');
  const blob = `${names} ${nodes} ${transcript.toLowerCase()}`;
  if (/ticket/.test(blob)) return 'ticket_created';
  if (/email|mail/.test(blob)) return 'email_sent';
  if (/update_box|update_status_box|update.*box|change.*box|adresse.*update/.test(blob)) return 'update_performed';
  if (status === 'transferred' || /transfer|weiterleit|handoff/.test(blob)) return 'transferred';
  if (status === 'completed' && !/nicht|leider|keinen zugriff|cannot|can't|unresolved/.test(blob)) return 'solved_by_marie';
  if (status === 'dropped' || status === 'failed') return 'unresolved';
  return 'unknown';
}

function inferAnliegen(raw: Obj, transcript: string): AnliegenCategory {
  const direct = firstString(raw, ['anliegen', 'intent', 'topic', 'category']);
  if (direct) return normalizeCallerRequest(direct);
  const t = transcript.toLowerCase();
  if (/liefer|sendung|tracking|status|wo ist/.test(t)) return 'order_status';
  if (/kündig|kuendig|pause|pausier/.test(t)) return 'cancel_or_pause';
  if (/adresse|anschrift|umzug/.test(t)) return 'address_or_account_change';
  if (/produkt|box|größe|groesse|inhalt/.test(t)) return 'box_or_product_change';
  if (/geburtsdatum|versicherungsnummer|vnr|auth/.test(t)) return 'authentication_problem';
  return 'other';
}

function makeEvidence(callId: string, partial: Partial<EvidenceMoment>): EvidenceMoment {
  const now = nowIso();
  return {
    id: id('ev'),
    call_id: callId,
    speaker: partial.speaker || 'unknown',
    moment_type: partial.moment_type || 'other',
    severity: partial.severity || 'medium',
    quote_or_transcript_excerpt: partial.quote_or_transcript_excerpt || '',
    explanation: partial.explanation || '',
    recommended_fix: partial.recommended_fix || '',
    voice_cue_notes: partial.voice_cue_notes || '',
    confidence: partial.confidence || 'high',
    source: partial.source || 'system_rule',
    reviewer_status: 'pending',
    linked_issue_suggestion: partial.linked_issue_suggestion,
    created_at: now,
    updated_at: now
  };
}

function runSystemRules(call: Partial<CallReview>, transcript: string): EvidenceMoment[] {
  const callId = call.id || '';
  const functions = call.function_calls || [];
  const transitions = call.transitions || [];
  const transitionBlob = transitions.map(t => `${t.from || ''} ${t.to || ''} ${t.node || ''} ${t.label || ''}`.toLowerCase()).join(' ');
  const lower = transcript.toLowerCase();
  const evidence: EvidenceMoment[] = [];
  const trace = call.operation_trace || buildMarieOperationTrace(call);
  const operational = buildOperationalFailures(call);
  const primary = primaryOperationalFailure(call);
  const failuresToStore = primary ? [primary] : operational.slice(0, 1);

  for (const failure of failuresToStore) {
    const momentType =
      failure.kind === 'repeated_authentication' ? 'repeated_authentication' :
      failure.kind === 'function_error' ? 'missing_integration' :
      failure.kind === 'claimed_not_done' ? 'claimed_completion_without_execution' :
      failure.kind === 'transferred_instead' ? 'avoidable_transfer' :
      failure.kind === 'ticket_not_created' || failure.kind === 'ticket_creation_failed' ? 'missing_function_call' :
      failure.kind === 'verification_missing' ? 'missing_alternative_verification' :
      failure.kind === 'action_not_executed' ? 'missing_function_call' :
      failure.kind === 'call_dropped' ? 'unresolved_request' :
      failure.kind === 'transfer_broken' ? 'escalation' :
      failure.kind === 'arg_mismatch' ? 'function_argument_mismatch' :
      'other';
    evidence.push(makeEvidence(callId, {
      moment_type: momentType,
      severity: failure.severity,
      explanation: failure.detail,
      recommended_fix: failure.fix || '',
      linked_issue_suggestion: failure.kind
    }));
  }

  // Repeated auth only when function was actually called twice (Marie-side), not missing customer data.
  const birthdayChecks = functions.map(f => f.name.toLowerCase()).filter(n => /check[_-]?birthday|birthday|geburtsdatum/.test(n));
  if (birthdayChecks.length > 1 && trace.preconditions.customer_provided_birthday) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'repeated_authentication',
      severity: 'medium',
      explanation: 'Birthday verification function ran more than once after the caller already provided a birthday.',
      recommended_fix: 'Persist successful birthday verification and avoid repeated auth prompts.',
      linked_issue_suggestion: 'repeated_birthday_request'
    }));
  }

  if (/weiterleit|transfer|verbinde/.test(lower) && !/transfer|handoff/.test(transitionBlob) && !evidence.some(e => e.moment_type === 'escalation')) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'escalation',
      severity: 'medium',
      explanation: 'Marie said she would transfer, but no transfer transition/event was detected.',
      recommended_fix: 'Verify transfer event emission and fallback when transfer fails.',
      linked_issue_suggestion: 'transfer_failed'
    }));
  }

  return evidence;
}

export function refreshCallSystemEvidence(call: Partial<CallReview>, existing: EvidenceMoment[]): EvidenceMoment[] {
  const withTrace = {
    ...call,
    operation_trace: call.operation_trace || buildMarieOperationTrace(call)
  };
  const system = runSystemRules(withTrace, call.transcript || '');
  const kept = existing.filter(e => e.call_id === call.id && e.source !== 'system_rule');
  return [...system, ...kept];
}


export function normalizeLeapingCall(
  rawValue: unknown,
  opts?: { workspace?: CallReview['workspace'] }
): { call: CallReview; evidence: EvidenceMoment[]; rawId: string } {
  const raw = asObj(rawValue);
  const events = rawTranscriptEvents(raw);
  const endFields = endFieldsFromEvents(events);
  const segments = normalizeTranscriptSegments(
    nested(raw, [['transcript_segments'], ['segments'], ['messages'], ['call', 'segments'], ['results', 'segments']]) || events
  );
  const transcript = transcriptFrom(raw, segments, events);
  const entities = extractEntitiesFromTranscript(transcript);
  const rawId = firstString(raw, ['id', 'call_id', 'conversation_id', 'uuid']) ||
    firstString(endFields, ['leaping_call_id']) ||
    id('leaping');
  const callId = `leaping_${rawId}`;
  const rawStatus = firstString(raw, ['status', 'call_status', 'state']);
  const statusRaw = rawStatus && rawStatus.toLowerCase() !== 'unknown'
    ? rawStatus
    : firstString(endFields, ['leaping_call_status']) || rawStatus;
  const status = normalizeStatus(statusRaw);
  const functionCalls = normalizeFunctionCalls(raw, events);
  const transitions = normalizeTransitions(raw, events);
  const result = inferResult(functionCalls, transitions, status, transcript);
  const anliegen = inferAnliegen(raw, transcript);
  const summary = firstString(raw, ['summary', 'call_summary']) ||
    firstString(asObj(raw.results), ['summary', 'call_summary']) ||
    firstString(endFields, ['leaping_conversation_summary']) ||
    transcript.slice(0, 220);
  const dateRaw = firstString(raw, ['started_at', 'created_at', 'date', 'timestamp', 'ended_at']) ||
    firstString(endFields, ['leaping_call_started_at', 'leaping_call_ended_at']) ||
    new Date().toISOString();
  const now = nowIso();

  const call = {
    id: callId,
    call_id: rawId,
    leaping_call_id: rawId,
    leaping_raw_id: rawId,
    date: dateRaw.slice(0, 10),
    duration_seconds: Math.round(
      firstNumber(raw, ['leaping_duration_seconds', 'duration_sec']) ||
      firstNumber(endFields, ['leaping_call_duration', 'leaping_duration_seconds']) ||
      firstNumber(raw, ['duration_seconds', 'duration'])
    ),
    customer_type: '',
    caller_context: summary,
    original_intent_summary: summary,
    final_outcome: result,
    marie_call_status: status,
    marie_main_result: result,
    leaping_status: statusRaw,
    customer_name: firstString(raw, ['customer_name', 'name']) || firstString(endFields, ['name', 'customer_name']) || entities.customer_name,
    phone: firstString(raw, ['phone', 'customer_phone', 'phone_number', 'customer_phone_number']) ||
      firstString(endFields, ['leaping_call_customer_phone', 'phone']),
    vnr: firstString(raw, ['vnr', 'insurance_number', 'versicherungsnummer']) || firstString(endFields, ['vnr', 'insurance_number']) || entities.vnr,
    email: firstString(raw, ['email', 'customer_email']) || firstString(endFields, ['email']),
    birthday: firstString(raw, ['birthday', 'birthdate', 'date_of_birth']) || firstString(endFields, ['birthday_system', 'birthday']),
    anliegen,
    solved_status: result === 'solved_by_marie' || result === 'update_performed' || result === 'email_sent' || result === 'ticket_created'
      ? 'yes'
      : result === 'transferred'
        ? 'partially'
        : 'no',
    overall_rating: result === 'unresolved' ? 4 : 7,
    naturalness_rating: 6,
    caller_cut_off: false,
    awkward_pauses: false,
    robotic_pacing: false,
    latency_too_long: false,
    repeated_question: false,
    identification_problem: false,
    missing_integration: false,
    workflow_node: firstString(raw, ['workflow_node', 'node']),
    root_cause_category: 'Other',
    breakpoint_notes: '',
    suggested_improvement: '',
    reviewer_notes: '',
    call_summary: summary,
    transcript,
    transcript_segments: segments,
    audio_file_name: '',
    audio_file_size: 0,
    audio_file_type: '',
    audio_file_last_modified: 0,
    recording_url: firstString(raw, ['recording_url', 'recordingUrl', 'audio_url', 'audioUrl']) ||
      firstString(endFields, ['leaping_call_recording_url']),
    leaping_detail_url: firstString(raw, ['url', 'dashboard_url', 'detail_url']),
    leaping_snapshot_id: firstString(raw, ['agent_snapshot_id', 'snapshot', 'snapshot_id', 'bot_version', 'version']) ||
      firstString(endFields, ['leaping_conversation_snapshot_id']),
    leaping_transcript_events: events,
    function_calls: functionCalls,
    transitions,
    raw_metadata: {
      results: raw.results ?? null,
      eval_results: raw.eval_results ?? null,
      tag: raw.tag ?? null,
      annotation: raw.annotation ?? null,
      failed_stage: raw.failed_stage ?? null,
      success: raw.success ?? null,
      end_fields: endFields
    },
    linked_issue_ids: [],
    workspace: opts?.workspace || 'production',
    bot_version: 'production',
    imported_at: now,
    review_status: 'new',
    created_at: now,
    updated_at: now
  } as CallReview;

  call.operation_trace = buildMarieOperationTrace(call);
  const evidence = runSystemRules(call, transcript);
  const opsFailures = buildOperationalFailures(call);
  call.primary_issue_label = opsFailures[0]?.label || evidence[0]?.linked_issue_suggestion || undefined;
  call.missing_integration = evidence.some(e => e.moment_type === 'missing_integration');
  call.identification_problem = evidence.some(e => e.moment_type === 'repeated_authentication');
  if (opsFailures.length) {
    call.solved_status = opsFailures.some(f => f.severity === 'high') ? 'no' : 'partially';
    call.overall_rating = opsFailures.some(f => f.severity === 'high') ? 4 : 5;
    call.needs_review = true;
  }
  if (hasHighSeverityOperationalFailure(call)) {
    call.pinned = true;
    call.critical = true;
  }
  call.review_object = buildReviewObject({ call, evidence, listenedToAudio: false });

  return { call, evidence, rawId };
}

function extractCallsPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asObj(payload);
  for (const key of ['calls', 'data', 'results', 'items']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

// ---------- Auth helpers ----------

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_IMPORT_LIMIT = 200;
const DEFAULT_MAX_PAGES = 20;

function isTokenValid(settings: Settings): boolean {
  const token = settings.leapingAccessToken?.trim();
  if (!token) return false;
  const expiresAt = settings.leapingTokenExpiresAt;
  if (!expiresAt) return false;
  return Date.now() < new Date(expiresAt).getTime() - TOKEN_BUFFER_MS;
}

interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  settingsPatch: Partial<Settings>;
}

function parseAuthPayload(bodyText: string, httpStatus: number, loginUrl: string): LoginResult {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Auth endpoint returned non-JSON (HTTP ${httpStatus}).`);
  }

  const obj = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : {};

  const accessToken =
    typeof obj.access_token === 'string' ? obj.access_token :
    typeof obj.token === 'string' ? obj.token :
    typeof obj.accessToken === 'string' ? obj.accessToken : '';

  if (!accessToken) {
    throw new Error(
      `Auth succeeded (HTTP ${httpStatus}) but no access_token in response.\n` +
      `Response keys: ${Object.keys(obj).join(', ') || '(none)'}`
    );
  }

  const refreshToken =
    typeof obj.refresh_token === 'string' ? obj.refresh_token :
    typeof obj.refreshToken === 'string' ? obj.refreshToken : undefined;

  let expiresAt: string;
  if (typeof obj.expires_in === 'number') {
    expiresAt = new Date(Date.now() + obj.expires_in * 1000).toISOString();
  } else if (typeof obj.expires_at === 'string') {
    expiresAt = obj.expires_at;
  } else {
    expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    settingsPatch: {
      leapingAccessToken: accessToken,
      leapingRefreshToken: refreshToken ?? undefined,
      leapingTokenExpiresAt: expiresAt
    }
  };
}

export async function refreshLeapingToken(settings: Settings): Promise<LoginResult> {
  const refreshToken = settings.leapingRefreshToken?.trim();
  if (!refreshToken) {
    throw new Error('No refresh token stored — use Test Leaping login once to cache credentials.');
  }

  const refreshUrl = (settings.leapingRefreshUrl || 'https://api.leaping.ai/v1/auth/refresh').trim();
  const loginUrl = (settings.leapingLoginUrl || 'https://api.leaping.ai/v1/auth/login').trim();

  const attempts: Array<{ url: string; contentType: string; body: string }> = [
    { url: refreshUrl, contentType: 'application/json', body: JSON.stringify({ refresh_token: refreshToken }) },
    { url: refreshUrl, contentType: 'application/json', body: JSON.stringify({ refreshToken }) },
    { url: loginUrl, contentType: 'application/json', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }) }
  ];

  let lastError = 'Refresh failed';
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': attempt.contentType, Accept: 'application/json' },
        body: attempt.body
      });
      const bodyText = await res.text().catch(() => '');
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${attempt.url}: ${bodyText.slice(0, 200)}`;
        continue;
      }
      const result = parseAuthPayload(bodyText, res.status, attempt.url);
      console.info('[leaping-auth] refresh success', { url: attempt.url, expiresAt: result.expiresAt });
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Leaping token refresh failed.\n${lastError}`);
}

export async function loginToLeaping(settings: Settings): Promise<LoginResult> {
  const loginUrl = (settings.leapingLoginUrl || 'https://api.leaping.ai/v1/auth/login').trim();
  const username = (settings.leapingUsername || '').trim();
  const password = (settings.leapingPassword || '').trim();

  if (!username || !password) {
    throw new Error('Leaping username and password are not configured — add them in Settings.');
  }

  const attempt = async (contentType: string): Promise<Response> => {
    const body = contentType === 'application/json'
      ? JSON.stringify({ username, password })
      : new URLSearchParams({ username, password }).toString();
    return fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: 'application/json' },
      body
    });
  };

  let res: Response;
  let usedContentType = 'application/json';

  try {
    res = await attempt('application/json');
  } catch (err) {
    throw new Error(`Network error reaching login endpoint ${loginUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 404 / 415 / 422 with JSON — retry with form-urlencoded
  if (res.status === 404 || res.status === 415 || res.status === 422) {
    const firstStatus = res.status;
    console.warn('[leaping-auth] JSON body returned', firstStatus, '— retrying with form-urlencoded');
    usedContentType = 'application/x-www-form-urlencoded';
    try {
      res = await attempt('application/x-www-form-urlencoded');
    } catch (err) {
      throw new Error(`Network error reaching login endpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const bodyText = await res.text().catch(() => '');

  if (!res.ok) {
    let sanitized: string;
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      sanitized = JSON.stringify(parsed).slice(0, 400);
    } catch {
      sanitized = bodyText.slice(0, 400);
    }
    throw new Error(
      `Login to ${loginUrl} failed.\n` +
      `HTTP ${res.status} · Content-Type sent: ${usedContentType}\n` +
      `Response: ${sanitized}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Login endpoint returned non-JSON (HTTP ${res.status}).`);
  }

  const result = parseAuthPayload(bodyText, res.status, loginUrl);

  console.info('[leaping-auth] login success', {
    hasAccessToken: true,
    hasRefreshToken: !!result.refreshToken,
    expiresAt: result.expiresAt,
    responseKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json as object) : []
  });

  return result;
}

async function resolveLeapingAuth(db: Database): Promise<{ token: string; db: Database; usedManualToken: boolean }> {
  let updatedDb = db;
  const settings = () => updatedDb.settings;
  const hasLoginConfig = !!(settings().leapingUsername?.trim() && settings().leapingPassword?.trim());
  const hasRefresh = !!settings().leapingRefreshToken?.trim();

  const applyAuth = (result: LoginResult) => {
    updatedDb = { ...updatedDb, settings: { ...settings(), ...result.settingsPatch } };
    return result.accessToken;
  };

  if (isTokenValid(settings())) {
    console.info('[leaping-auth] using cached token', { expiresAt: settings().leapingTokenExpiresAt });
    return { token: settings().leapingAccessToken!.trim(), db: updatedDb, usedManualToken: false };
  }

  if (hasRefresh) {
    try {
      console.info('[leaping-auth] token expired — refreshing');
      return { token: applyAuth(await refreshLeapingToken(settings())), db: updatedDb, usedManualToken: false };
    } catch (refreshErr) {
      console.warn('[leaping-auth] refresh failed', refreshErr instanceof Error ? refreshErr.message : refreshErr);
    }
  }

  if (hasLoginConfig) {
    console.info('[leaping-auth] logging in with username/password');
    try {
      return { token: applyAuth(await loginToLeaping(settings())), db: updatedDb, usedManualToken: false };
    } catch (loginErr) {
      const manualToken = (settings().leapingApiKey || '').trim();
      if (manualToken) {
        console.warn('[leaping-auth] login failed, falling back to manual Bearer token', {
          error: loginErr instanceof Error ? loginErr.message : String(loginErr)
        });
        return { token: manualToken, db: updatedDb, usedManualToken: true };
      }
      throw loginErr;
    }
  }

  const manualToken = (settings().leapingApiKey || '').trim();
  if (!manualToken) {
    throw new Error(
      'No Leaping credentials configured.\n' +
      'Add username + password in Settings (recommended — auto-refresh). Manual Bearer tokens expire in minutes.'
    );
  }
  return { token: manualToken, db: updatedDb, usedManualToken: true };
}

function importLimit(settings: Settings) {
  const n = settings.leapingImportLimit ?? DEFAULT_IMPORT_LIMIT;
  return Math.max(1, Math.min(500, Math.round(n)));
}

function importMaxPages(settings: Settings) {
  const n = settings.leapingImportMaxPages ?? DEFAULT_MAX_PAGES;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function buildCallsPageUrl(baseUrl: string, settings: Settings, offset: number) {
  const url = new URL(baseUrl.trim());
  const limit = importLimit(settings);
  url.searchParams.set('limit', String(limit));
  if (offset > 0) url.searchParams.set('offset', String(offset));
  else url.searchParams.delete('offset');
  return url.toString();
}

function callPayloadId(raw: unknown) {
  return firstString(asObj(raw), ['id', 'call_id', 'conversation_id', 'uuid']);
}

async function reauthenticate(db: Database): Promise<{ token: string; db: Database }> {
  let updatedDb = db;
  const settings = () => updatedDb.settings;
  const hasRefresh = !!settings().leapingRefreshToken?.trim();
  const hasLogin = !!(settings().leapingUsername?.trim() && settings().leapingPassword?.trim());

  if (hasRefresh) {
    try {
      const refreshed = await refreshLeapingToken(settings());
      updatedDb = { ...updatedDb, settings: { ...settings(), ...refreshed.settingsPatch } };
      return { token: refreshed.accessToken, db: updatedDb };
    } catch {
      /* try login */
    }
  }

  if (hasLogin) {
    const loginResult = await loginToLeaping(settings());
    updatedDb = { ...updatedDb, settings: { ...settings(), ...loginResult.settingsPatch } };
    return { token: loginResult.accessToken, db: updatedDb };
  }

  throw new Error('Leaping token invalid or expired — add username/password in Settings or click Test Leaping login.');
}

// ---------- Calls fetch ----------

export async function fetchLeapingCalls(
  db: Database
): Promise<{ calls: unknown[]; db: Database; pagesFetched: number; limitPerPage: number }> {
  const rawUrl = (db.settings.leapingApiUrl || '').trim();
  if (!rawUrl) throw new Error('Add the Leaping calls API URL in Settings first.');

  try {
    new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Leaping API URL: "${rawUrl}"`);
  }

  const limitPerPage = importLimit(db.settings);
  const maxPages = importMaxPages(db.settings);

  let { token, db: updatedDb, usedManualToken } = await resolveLeapingAuth(db);

  const makeRequest = async (authToken: string, pageUrl: string): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    console.info('[leaping-import] fetching calls', { url: pageUrl, hasToken: !!authToken });
    return fetch(pageUrl, { headers });
  };

  const parsePage = async (res: Response): Promise<unknown[]> => {
    if (res.status === 401 || res.status === 403) {
      const reauth = await reauthenticate(updatedDb);
      token = reauth.token;
      updatedDb = reauth.db;
      throw new Error('__RETRY_AUTH__');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[leaping-import] non-OK response', { status: res.status, body: body.slice(0, 200) });
      throw new Error(body.slice(0, 300) || `Leaping import failed (HTTP ${res.status})`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error('Leaping API returned malformed JSON.');
    }

    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const obj = json as Record<string, unknown>;
      if (typeof obj.detail === 'string' && /invalid token/i.test(obj.detail)) {
        updatedDb = {
          ...updatedDb,
          settings: { ...updatedDb.settings, leapingAccessToken: undefined, leapingTokenExpiresAt: undefined }
        };
        const reauth = await reauthenticate(updatedDb);
        token = reauth.token;
        updatedDb = reauth.db;
        throw new Error('__RETRY_AUTH__');
      }
    }

    return extractCallsPayload(json);
  };

  const merged: unknown[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let offset = 0;

  while (pagesFetched < maxPages) {
    const pageUrl = buildCallsPageUrl(rawUrl, updatedDb.settings, offset);
    let page: unknown[];

    try {
      const res = await makeRequest(token, pageUrl);
      page = await parsePage(res);
    } catch (err) {
      if (err instanceof Error && err.message === '__RETRY_AUTH__') {
        const res = await makeRequest(token, pageUrl);
        page = await parsePage(res);
      } else {
        throw err;
      }
    }

    pagesFetched += 1;
    let added = 0;
    for (const item of page) {
      const id = callPayloadId(item);
      const key = id || `__idx_${merged.length}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      merged.push(item);
      added += 1;
    }

    console.info('[leaping-import] page', { pagesFetched, offset, pageSize: page.length, added, total: merged.length });

    if (!page.length || page.length < limitPerPage || added === 0) break;
    offset += limitPerPage;
  }

  if (usedManualToken) {
    console.warn('[leaping-import] using manual Bearer token — it may expire quickly. Prefer username/password in Settings.');
  }

  console.info('[leaping-import] fetch complete', {
    pagesFetched,
    limitPerPage,
    totalCalls: merged.length
  });

  return { calls: merged, db: updatedDb, pagesFetched, limitPerPage };
}

async function downloadRecordingToFile(url: string, callId: string): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[leaping-audio] recording download failed', { url, status: res.status });
      return null;
    }
    const contentType = res.headers.get('content-type') || 'audio/wav';
    const mime = contentType.split(';')[0].trim();
    const ext = mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/mp4' ? 'm4a' : 'wav';
    const blob = await res.blob();
    return new File([blob], `${callId}.${ext}`, { type: mime });
  } catch (err) {
    console.warn('[leaping-audio] recording download error', { url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function importLeapingRawCalls(
  db: Database,
  rawCalls: unknown[],
  opts?: { workspace?: CallReview['workspace'] }
): Promise<{ db: Database; imported: number; updated: number; skipped: number }> {
  console.info('[leaping-import] importLeapingRawCalls start', { rawCallsCount: rawCalls.length });
  const now = nowIso();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const calls = [...db.calls];
  const evidence = db.evidence.filter(e => e.source !== 'system_rule' || !String(e.call_id).startsWith('leaping_'));
  // Store only id + timestamp (no raw payload) to stay within localStorage limits
  const rawStore: Array<{ id: string; imported_at: string }> = (db.leapingRawCalls || []).map(r => ({ id: r.id, imported_at: r.imported_at }));

  for (const raw of rawCalls) {
    let normalized: ReturnType<typeof normalizeLeapingCall>;
    try {
      normalized = normalizeLeapingCall(raw, { workspace: opts?.workspace });
    } catch (error) {
      const callId = firstString(asObj(raw), ['id', 'call_id', 'conversation_id']);
      console.error('[leaping-import] normalize failed', {
        component: 'leapingImportService.importLeapingRawCalls',
        call_id: callId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      continue;
    }

    // Skip calls shorter than the minimum duration
    if (normalized.call.duration_seconds < MIN_CALL_SECONDS) {
      console.info('[leaping-import] skipping short call', {
        id: normalized.call.id,
        duration_seconds: normalized.call.duration_seconds,
        min: MIN_CALL_SECONDS
      });
      skipped++;
      continue;
    }

    console.info('[leaping-import] normalized call', {
      id: normalized.call.id,
      rawId: normalized.rawId,
      status: normalized.call.marie_call_status,
      anliegen: normalized.call.anliegen,
      transcriptLen: (normalized.call.transcript || '').length,
      eventsCount: (normalized.call.leaping_transcript_events || []).length,
      evidenceCount: normalized.evidence.length
    });

    // Download and persist the recording if a URL is present
    const recordingUrl = normalized.call.recording_url;
    if (recordingUrl) {
      const file = await downloadRecordingToFile(recordingUrl, normalized.call.id);
      if (file) {
        try {
          const stored = await persistAudioFile(normalized.call.id, file);
          Object.assign(normalized.call, {
            audio_file_name: file.name,
            audio_file_size: file.size,
            audio_file_type: file.type,
            audio_file_last_modified: Date.now(),
            ...stored
          });
          console.info('[leaping-audio] recording persisted', {
            callId: normalized.call.id,
            fileName: file.name,
            hasLocalPath: !!stored.audio_local_path,
            hasStorageKey: !!stored.audio_storage_key
          });
        } catch (persistErr) {
          console.warn('[leaping-audio] recording persist failed', {
            callId: normalized.call.id,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr)
          });
        }
      }
    }

    const existingIndex = findExistingLeapingMergeIndex(calls, normalized);
    if (existingIndex >= 0) {
      calls[existingIndex] = mergeLeapingOntoExistingCall(calls[existingIndex], normalized.call, normalized.rawId);
      updated++;
    } else {
      calls.unshift(normalized.call);
      imported++;
    }
    evidence.push(...normalized.evidence);
    const rawIndex = rawStore.findIndex(item => item.id === normalized.rawId);
    const rawItem = { id: normalized.rawId, imported_at: now };
    if (rawIndex >= 0) rawStore[rawIndex] = rawItem;
    else rawStore.unshift(rawItem);
  }

  console.info('[leaping-import] import complete', { imported, updated, skipped, totalCalls: calls.length, totalEvidence: evidence.length });

  let nextDb: Database;
  try {
    nextDb = finalizeDatabaseState({ ...db, calls, evidence, leapingRawCalls: rawStore as typeof db.leapingRawCalls, leapingLastImportAt: now });
  } catch (finalizeErr) {
    console.error('[leaping-import] finalizeDatabaseState failed', {
      error: finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr),
      stack: finalizeErr instanceof Error ? finalizeErr.stack : undefined
    });
    nextDb = { ...db, calls, evidence, leapingRawCalls: rawStore as typeof db.leapingRawCalls, leapingLastImportAt: now };
  }

  return { db: nextDb, imported, updated, skipped };
}
