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
import {
  allLeapingTranscriptEvents,
  compactLeapingEventsForStorage,
  segmentsFromLeapingEvents,
  transcriptTextFromLeapingEvents
} from '../utils/leapingTranscript';
import { generateCallDraft } from './openaiService';
import { normalizeEvidenceForImport } from '../utils/evidenceReview';

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

function normalizeTranscriptSegments(raw: unknown, events: unknown[] = []): TranscriptSegment[] | undefined {
  if (Array.isArray(raw) && raw.length) {
    const fromRaw = raw.map<TranscriptSegment | null>(item => {
      const s = asObj(item);
      const type = firstString(s, ['type']);
      if (type && type !== 'message' && type !== 'chat_message') return null;
      const sender = firstString(s, ['sender', 'speaker', 'role']).toLowerCase();
      const start = firstNumber(s, ['time', 'start', 'start_seconds', 'start_time', 'timestamp_seconds']);
      const end = firstNumber(s, ['end', 'end_seconds', 'end_time']);
      return {
        start,
        end: end > start ? end : start + 1,
        speaker: sender.includes('bot') || sender.includes('agent') || sender.includes('marie') ? 'agent' as const :
          sender.includes('human') || sender.includes('caller') || sender.includes('user')
            ? 'caller' as const
            : 'unknown' as const,
        text: firstString(s, ['text', 'transcript', 'content', 'message'])
      };
    }).filter((s): s is TranscriptSegment => !!s && !!s.text);
    if (fromRaw.length) return fromRaw;
  }
  const fromEvents = segmentsFromLeapingEvents(events);
  return fromEvents.length ? fromEvents : undefined;
}

function rawTranscriptEvents(raw: Obj): unknown[] {
  return allLeapingTranscriptEvents(raw);
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
  const names = functions.map(f => f.name.toLowerCase());
  const transitionBlob = transitions.map(t => `${t.from || ''} ${t.to || ''} ${t.node || ''} ${t.label || ''}`.toLowerCase()).join(' ');
  const lower = transcript.toLowerCase();
  const evidence: EvidenceMoment[] = [];

  const birthdayChecks = names.filter(n => /check[_-]?birthday|birthday|geburtsdatum/.test(n));
  if (birthdayChecks.length > 1) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'repeated_authentication',
      severity: 'high',
      explanation: 'System rule: birthday verification was called more than once in this call.',
      recommended_fix: 'Persist successful birthday verification and avoid repeated auth prompts.',
      linked_issue_suggestion: 'repeated_birthday_request'
    }));
  }

  if (functions.some(f => f.status === 'error')) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'missing_integration',
      severity: 'high',
      explanation: 'System rule: at least one function/tool call returned an error.',
      recommended_fix: 'Inspect function arguments/result payload and add validation or fallback handling.',
      linked_issue_suggestion: 'function_api_issue'
    }));
  }

  if (includesAny(`${transitionBlob} ${lower}`, [/lieferstatus|shipment|delivery/]) && !names.some(n => /birthday|geburtsdatum|verify|auth/.test(n))) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'missing_alternative_verification',
      severity: 'high',
      explanation: 'System rule: delivery-status handling appears before any detected verification function.',
      recommended_fix: 'Require successful verification before account-specific delivery answers.',
      linked_issue_suggestion: 'verification_skipped'
    }));
  }

  if (/weiterleit|transfer|verbinde/.test(lower) && !/transfer|handoff/.test(transitionBlob)) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'escalation',
      severity: 'medium',
      explanation: 'System rule: Marie said she would transfer, but no transfer transition/event was detected.',
      recommended_fix: 'Verify transfer event emission and fallback when transfer fails.',
      linked_issue_suggestion: 'transfer_failed'
    }));
  }

  if ((call.marie_call_status === 'dropped' || call.leaping_status === 'dropped') && call.marie_main_result !== 'unresolved') {
    evidence.push(makeEvidence(callId, {
      moment_type: 'unresolved_request',
      severity: 'medium',
      explanation: 'System rule: call status is dropped although result signals suggest the conversation may have completed.',
      recommended_fix: 'Review Leaping status mapping and completion/drop classification.',
      linked_issue_suggestion: 'completion_drop_mismatch'
    }));
  }

  const inScope =
    call.anliegen === 'cancel_or_pause' ||
    call.anliegen === 'box_or_product_change' ||
    call.anliegen === 'address_or_account_change';
  const forwarded =
    call.marie_main_result === 'transferred' ||
    call.marie_call_status === 'transferred' ||
    /weiterleit|verbinde|kollege/.test(lower);
  const inFlowCapable = names.some(n =>
    /pause|kuendig|kündig|cancel|box|adresse|address|update/.test(n)
  );
  if (inScope && forwarded && !inFlowCapable) {
    evidence.push(makeEvidence(callId, {
      moment_type: 'wrong_workflow',
      severity: 'high',
      explanation: 'System rule: caller intent is in-scope for Marie automation, but call was forwarded without a matching in-flow function.',
      recommended_fix: 'Check routing — pause, kündigen, box change, and address updates should run in-flow when functions are available.',
      linked_issue_suggestion: 'unnecessary_forward'
    }));
  }

  const promisePatterns = [
    /ich (mache|bearbeite|trage|aktualisiere|pruefe|prüfe|kuendige|kündige|pausiere)/,
    /ich werde/,
    /einen moment.*(bearbeit|pruef|prüf|eintrag)/
  ];
  const promised = promisePatterns.some(re => re.test(lower));
  const confirmed = /(bestätigt|bestaetigt|eingetragen|erledigt|vorgenommen|erfolgreich)/.test(lower);
  if (promised && !confirmed && !forwarded && call.marie_main_result !== 'solved_by_marie') {
    evidence.push(makeEvidence(callId, {
      moment_type: 'unresolved_request',
      severity: 'high',
      explanation: 'System rule: Marie promised an action in speech but no completion language or successful function outcome was detected.',
      recommended_fix: 'Compare agent promises to function_calls log — flag when execution is missing.',
      linked_issue_suggestion: 'promise_not_executed'
    }));
  }

  return evidence;
}


export function normalizeLeapingCall(rawValue: unknown): { call: CallReview; evidence: EvidenceMoment[]; rawId: string } {
  const raw = asObj(rawValue);
  const allEvents = rawTranscriptEvents(raw);
  const events = compactLeapingEventsForStorage(allEvents);
  const endFields = endFieldsFromEvents(allEvents);
  const segments = normalizeTranscriptSegments(
    nested(raw, [['transcript_segments'], ['segments'], ['messages'], ['call', 'segments'], ['results', 'segments']]),
    allEvents
  );
  const transcript =
    transcriptFrom(raw, segments, allEvents) ||
    transcriptTextFromLeapingEvents(allEvents);
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
  const functionCalls = normalizeFunctionCalls(raw, allEvents);
  const transitions = normalizeTransitions(raw, allEvents);
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
      firstNumber(raw, ['duration', 'duration_seconds', 'leaping_duration_seconds', 'duration_sec']) ||
      firstNumber(endFields, ['leaping_call_duration'])
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
    workspace: 'production',
    bot_version: 'production',
    imported_at: now,
    review_status: 'new',
    created_at: now,
    updated_at: now
  } as CallReview;

  const evidence = runSystemRules(call, transcript);
  call.primary_issue_label = evidence[0]?.linked_issue_suggestion || undefined;
  call.missing_integration = evidence.some(e => e.moment_type === 'missing_integration');
  call.identification_problem = evidence.some(e => e.moment_type === 'repeated_authentication' || e.moment_type === 'missing_alternative_verification');
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

function isSupabaseAuthUrl(url: string): boolean {
  return /supabase\.co\/auth\/v1\/token/i.test(url);
}

function supabaseRefreshUrl(loginUrl: string): string {
  try {
    const u = new URL(loginUrl);
    u.searchParams.set('grant_type', 'refresh_token');
    return u.toString();
  } catch {
    return loginUrl.replace(/grant_type=password/i, 'grant_type=refresh_token');
  }
}

function supabaseAuthHeaders(anonKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`
  };
}

function parseAuthResponse(json: unknown, httpStatus: number): LoginResult {
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
      leapingRefreshToken: refreshToken,
      leapingTokenExpiresAt: expiresAt
    }
  };
}

async function readAuthError(res: Response, loginUrl: string, extra = ''): Promise<never> {
  const bodyText = await res.text().catch(() => '');
  let sanitized: string;
  try {
    sanitized = JSON.stringify(JSON.parse(bodyText)).slice(0, 400);
  } catch {
    sanitized = bodyText.slice(0, 400);
  }
  throw new Error(
    `Login to ${loginUrl} failed.\n` +
    `HTTP ${res.status}${extra ? ` · ${extra}` : ''}\n` +
    `Response: ${sanitized}`
  );
}

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

async function loginToSupabase(settings: Settings): Promise<LoginResult> {
  const loginUrl = (settings.leapingLoginUrl || '').trim();
  const email = (settings.leapingUsername || '').trim();
  const password = (settings.leapingPassword || '').trim();
  const anonKey = (settings.leapingSupabaseAnonKey || '').trim();

  if (!email || !password) {
    throw new Error('Leaping email and password are not configured — add them in Settings.');
  }
  if (!anonKey) {
    throw new Error(
      'Supabase anon API key is required for Leaping login.\n' +
      'Add it in Settings → Leaping API → Supabase anon key.'
    );
  }

  let res: Response;
  try {
    res = await fetch(loginUrl, {
      method: 'POST',
      headers: supabaseAuthHeaders(anonKey),
      body: JSON.stringify({ email, password })
    });
  } catch (err) {
    throw new Error(
      `Network error reaching Supabase login ${loginUrl}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    let sanitized: string;
    try {
      sanitized = JSON.stringify(JSON.parse(bodyText)).slice(0, 400);
    } catch {
      sanitized = bodyText.slice(0, 400);
    }
    throw new Error(
      `Supabase login failed.\nHTTP ${res.status}\nResponse: ${sanitized}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Supabase login returned non-JSON (HTTP ${res.status}).`);
  }

  const result = parseAuthResponse(json, res.status);
  console.info('[leaping-auth] Supabase login success', {
    hasAccessToken: true,
    hasRefreshToken: !!result.refreshToken,
    expiresAt: result.expiresAt
  });
  return result;
}

async function loginToLeapingLegacy(settings: Settings): Promise<LoginResult> {
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

  if (res.status === 404 || res.status === 415 || res.status === 422) {
    usedContentType = 'application/x-www-form-urlencoded';
    try {
      res = await attempt('application/x-www-form-urlencoded');
    } catch (err) {
      throw new Error(`Network error reaching login endpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    await readAuthError(res, loginUrl, `Content-Type sent: ${usedContentType}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Login endpoint returned non-JSON (HTTP ${res.status}).`);
  }

  const result = parseAuthResponse(json, res.status);
  console.info('[leaping-auth] legacy login success', {
    hasAccessToken: true,
    hasRefreshToken: !!result.refreshToken,
    expiresAt: result.expiresAt
  });
  return result;
}

export async function refreshLeapingToken(settings: Settings): Promise<LoginResult> {
  const loginUrl = (settings.leapingLoginUrl || '').trim();
  const refreshToken = (settings.leapingRefreshToken || '').trim();
  const anonKey = (settings.leapingSupabaseAnonKey || '').trim();

  if (!isSupabaseAuthUrl(loginUrl)) {
    throw new Error('Token refresh is only supported for Supabase auth endpoints.');
  }
  if (!refreshToken) {
    throw new Error('No cached refresh token — password login required.');
  }
  if (!anonKey) {
    throw new Error('Supabase anon API key is required for token refresh.');
  }

  const refreshUrl = supabaseRefreshUrl(loginUrl);
  let res: Response;
  try {
    res = await fetch(refreshUrl, {
      method: 'POST',
      headers: supabaseAuthHeaders(anonKey),
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  } catch (err) {
    throw new Error(`Network error during token refresh: ${err instanceof Error ? err.message : String(err)}`);
  }

  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    let sanitized: string;
    try {
      sanitized = JSON.stringify(JSON.parse(bodyText)).slice(0, 400);
    } catch {
      sanitized = bodyText.slice(0, 400);
    }
    throw new Error(`Supabase token refresh failed.\nHTTP ${res.status}\nResponse: ${sanitized}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Supabase refresh returned non-JSON (HTTP ${res.status}).`);
  }

  const result = parseAuthResponse(json, res.status);
  console.info('[leaping-auth] Supabase refresh success', { expiresAt: result.expiresAt });
  return result;
}

export async function loginToLeaping(settings: Settings): Promise<LoginResult> {
  const loginUrl = (settings.leapingLoginUrl || '').trim();
  if (isSupabaseAuthUrl(loginUrl)) {
    return loginToSupabase(settings);
  }
  return loginToLeapingLegacy(settings);
}

async function acquireLeapingToken(settings: Settings): Promise<LoginResult> {
  if (isTokenValid(settings)) {
    return {
      accessToken: settings.leapingAccessToken!.trim(),
      refreshToken: settings.leapingRefreshToken,
      expiresAt: settings.leapingTokenExpiresAt || new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
      settingsPatch: {}
    };
  }

  const loginUrl = (settings.leapingLoginUrl || '').trim();
  const hasCreds = !!(settings.leapingUsername?.trim() && settings.leapingPassword?.trim());

  if (
    settings.leapingRefreshToken?.trim() &&
    isSupabaseAuthUrl(loginUrl) &&
    settings.leapingSupabaseAnonKey?.trim()
  ) {
    try {
      console.info('[leaping-auth] access token expired — refreshing');
      return await refreshLeapingToken(settings);
    } catch (refreshErr) {
      console.warn('[leaping-auth] refresh failed, falling back to password login', {
        error: refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
      });
    }
  }

  if (hasCreds) {
    console.info('[leaping-auth] logging in with email/password');
    return await loginToLeaping(settings);
  }

  const manualToken = (settings.leapingApiKey || '').trim();
  if (manualToken) {
    return {
      accessToken: manualToken,
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
      settingsPatch: {}
    };
  }

  throw new Error(
    'No Leaping credentials configured.\n' +
    'Add Supabase email + password + anon key, or paste a manual Bearer token in Settings.'
  );
}

// ---------- Calls fetch ----------

export async function fetchLeapingCalls(db: Database): Promise<{ calls: unknown[]; db: Database }> {
  const rawUrl = (db.settings.leapingApiUrl || '').trim();
  if (!rawUrl) throw new Error('Add the Leaping calls API URL in Settings first.');

  let callsUrl: URL;
  try {
    callsUrl = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Leaping API URL: "${rawUrl}"`);
  }

  if (!callsUrl.searchParams.has('limit')) {
    const batch = Math.min(100, Math.max(1, db.settings.leapingImportBatchSize || 50));
    callsUrl.searchParams.set('limit', String(batch));
  }
  const requestUrl = callsUrl.toString();

  const hasLoginConfig = !!(db.settings.leapingUsername?.trim() && db.settings.leapingPassword?.trim());
  let updatedDb = db;
  let token = '';

  try {
    const auth = await acquireLeapingToken(db.settings);
    token = auth.accessToken;
    if (auth.settingsPatch && Object.keys(auth.settingsPatch).length > 0) {
      updatedDb = { ...db, settings: { ...db.settings, ...auth.settingsPatch } };
    }
  } catch (authErr) {
    const manualToken = (db.settings.leapingApiKey || '').trim();
    if (manualToken) {
      console.warn('[leaping-auth] auth failed, falling back to manual Bearer token', {
        error: authErr instanceof Error ? authErr.message : String(authErr)
      });
      token = manualToken;
    } else {
      throw authErr;
    }
  }

  const makeRequest = async (authToken: string): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    console.info('[leaping-import] fetching calls', { url: requestUrl, hasToken: !!authToken });
    return fetch(requestUrl, { headers });
  };

  let res: Response;
  try {
    res = await makeRequest(token);
  } catch {
    throw new Error('Network error — could not reach Leaping API. Check URL and internet connection.');
  }

  if (res.status === 401 || res.status === 403) {
    console.warn('[leaping-import] got', res.status, '— re-authenticating');
    updatedDb = {
      ...updatedDb,
      settings: {
        ...updatedDb.settings,
        leapingAccessToken: undefined,
        leapingTokenExpiresAt: undefined
      }
    };
    try {
      const loginResult = hasLoginConfig
        ? await loginToLeaping(updatedDb.settings)
        : await acquireLeapingToken({
            ...updatedDb.settings,
            leapingAccessToken: undefined,
            leapingTokenExpiresAt: undefined
          });
      token = loginResult.accessToken;
      updatedDb = { ...updatedDb, settings: { ...updatedDb.settings, ...loginResult.settingsPatch } };
      res = await makeRequest(token);
    } catch (retryErr) {
      const manualToken = (db.settings.leapingApiKey || '').trim();
      if (manualToken) {
        token = manualToken;
        res = await makeRequest(token);
      } else {
        throw new Error(
          `Leaping re-authentication failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
        );
      }
    }
  }

  console.info('[leaping-import] calls response', { status: res.status, ok: res.ok });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Leaping token invalid or expired — check Supabase credentials and anon key in Settings.');
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
        settings: {
          ...updatedDb.settings,
          leapingAccessToken: undefined,
          leapingRefreshToken: undefined,
          leapingTokenExpiresAt: undefined
        }
      };
      throw new Error('Leaping returned "Invalid token" — cached token cleared. Try importing again to re-login.');
    }
  }

  console.info('[leaping-import] response', {
    bodyType: Array.isArray(json) ? 'array' : typeof json,
    keys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json as object).slice(0, 10) : null
  });

  const calls = extractCallsPayload(json);
  console.info('[leaping-import] extracted calls', {
    count: calls.length,
    firstId: calls[0] ? firstString(asObj(calls[0]), ['id', 'call_id', 'conversation_id']) : null
  });
  return { calls, db: updatedDb };
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

async function enrichLeapingCallWithAi(
  settings: Settings,
  call: CallReview,
  ruleEvidence: EvidenceMoment[]
): Promise<{ call: CallReview; extraEvidence: EvidenceMoment[] }> {
  if (!settings.openaiApiKey?.trim() || settings.leapingEnrichWithAi === false) {
    return { call, extraEvidence: [] };
  }

  const ruleSummary = ruleEvidence
    .map(e => `- ${e.moment_type}: ${e.explanation}`)
    .join('\n');

  const fnSummary = (call.function_calls || [])
    .slice(0, 12)
    .map(f => `${f.name} (${f.status || 'unknown'})`)
    .join(', ');

  try {
    const { call: aiCall, evidence: aiEvidence } = await generateCallDraft(settings, {
      transcript: call.transcript,
      transcriptSegments: call.transcript_segments,
      existingCallId: call.id,
      existingCall: call,
      reviewerContext:
        `Leaping import QA. System rules already fired:\n${ruleSummary || '(none)'}\n` +
        `Function calls: ${fnSummary || '(none)'}\n` +
        `Marie status: ${call.marie_call_status || 'unknown'} · result: ${call.marie_main_result || 'unknown'}\n` +
        'Confirm or add findings the rules may have missed. Do not contradict confirmed system rules unless transcript clearly disproves them.'
    });

    const merged = normalizeEvidenceForImport(
      (aiEvidence || []).filter(e => e.source !== 'system_rule')
    );

    return {
      call: {
        ...call,
        ...aiCall,
        id: call.id,
        call_id: call.call_id,
        leaping_call_id: call.leaping_call_id,
        function_calls: call.function_calls,
        transitions: call.transitions,
        leaping_transcript_events: call.leaping_transcript_events,
        review_object: buildReviewObject({
          call: { ...call, ...aiCall },
          evidence: [...ruleEvidence, ...merged],
          listenedToAudio: false
        })
      },
      extraEvidence: merged as EvidenceMoment[]
    };
  } catch (err) {
    console.warn('[leaping-import] AI enrichment skipped for call', call.call_id, err);
    return { call, extraEvidence: [] };
  }
}

async function enrichImportedLeapingCalls(
  db: Database,
  calls: CallReview[],
  evidence: EvidenceMoment[],
  importedIds: Set<string>
): Promise<{ calls: CallReview[]; evidence: EvidenceMoment[] }> {
  const targets = calls.filter(c =>
    importedIds.has(c.id) &&
    c.transcript &&
    c.transcript.length > 40 &&
    (
      c.solved_status === 'no' ||
      c.marie_call_status === 'dropped' ||
      c.marie_call_status === 'failed' ||
      evidence.some(e => e.call_id === c.id && e.source === 'system_rule')
    )
  ).slice(0, 20);

  if (!targets.length) return { calls, evidence };

  const nextCalls = [...calls];
  const nextEvidence = [...evidence];

  for (const call of targets) {
    const ruleEv = nextEvidence.filter(e => e.call_id === call.id && e.source === 'system_rule');
    const { call: enriched, extraEvidence } = await enrichLeapingCallWithAi(db.settings, call, ruleEv);
    const idx = nextCalls.findIndex(c => c.id === call.id);
    if (idx >= 0) nextCalls[idx] = enriched;
    nextEvidence.push(...extraEvidence);
  }

  return { calls: nextCalls, evidence: nextEvidence };
}

export async function importLeapingRawCalls(
  db: Database,
  rawCalls: unknown[]
): Promise<{ db: Database; imported: number; updated: number; skipped: number }> {
  console.info('[leaping-import] importLeapingRawCalls start', { rawCallsCount: rawCalls.length });
  const now = nowIso();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let calls = [...db.calls];
  let evidence = db.evidence.filter(e => e.source !== 'system_rule' || !String(e.call_id).startsWith('leaping_'));
  // Store only id + timestamp (no raw payload) to stay within localStorage limits
  const rawStore: Array<{ id: string; imported_at: string }> = (db.leapingRawCalls || []).map(r => ({ id: r.id, imported_at: r.imported_at }));
  const touchedIds = new Set<string>();

  for (const raw of rawCalls) {
    let normalized: ReturnType<typeof normalizeLeapingCall>;
    try {
      normalized = normalizeLeapingCall(raw);
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

    const existingIndex = calls.findIndex(c => c.id === normalized.call.id || c.leaping_call_id === normalized.rawId);
    if (existingIndex >= 0) {
      calls[existingIndex] = {
        ...calls[existingIndex],
        ...normalized.call,
        pinned: calls[existingIndex].pinned,
        reviewer_call_notes: calls[existingIndex].reviewer_call_notes,
        // Keep existing local audio if already downloaded
        audio_local_path: calls[existingIndex].audio_local_path || normalized.call.audio_local_path,
        audio_storage_key: calls[existingIndex].audio_storage_key || normalized.call.audio_storage_key
      };
      updated++;
    } else {
      calls.unshift(normalized.call);
      imported++;
    }
    touchedIds.add(normalized.call.id);
    evidence.push(...normalized.evidence);
    const rawIndex = rawStore.findIndex(item => item.id === normalized.rawId);
    const rawItem = { id: normalized.rawId, imported_at: now };
    if (rawIndex >= 0) rawStore[rawIndex] = rawItem;
    else rawStore.unshift(rawItem);
  }

  console.info('[leaping-import] import complete', { imported, updated, skipped, totalCalls: calls.length, totalEvidence: evidence.length });

  const enriched = await enrichImportedLeapingCalls(db, calls, evidence, touchedIds);
  calls = enriched.calls;
  evidence = enriched.evidence;

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
