import type { AnliegenCategory, SolvedStatus, TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import { applyIntentSafeguards } from '../utils/intentSafeguards';
import { migrateAnliegenCategory } from '../utils/anliegen';

export type TranscriptTurn = {
  speaker: 'caller' | 'agent' | 'unknown';
  text: string;
  start?: number;
  end?: number;
};

export type CallUnderstanding = {
  customer_goal: string;
  anliegen: AnliegenCategory;
  request_completed: boolean;
  human_transfer: boolean;
  human_transfer_explicit: boolean;
  authentication_normal: boolean;
  repeated_auth_failure: boolean;
  missing_alt_verification: boolean;
  customer_frustration: boolean;
  workflow_failed: boolean;
  completion_state: 'completed' | 'handoff_partial' | 'failed' | 'unclear';
  solved_status: SolvedStatus;
  /** True only when contextual rules allow creating/upkeeping this evidence type */
  allow_evidence: Record<EvidenceMomentType, boolean>;
};

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseTranscriptTurns(transcript: string, segments?: TranscriptSegment[]): TranscriptTurn[] {
  if (segments?.length) {
    return segments.map(s => ({
      speaker: s.speaker === 'caller' || s.speaker === 'agent' ? s.speaker : 'unknown',
      text: String(s.text || '').trim(),
      start: s.start,
      end: s.end
    }));
  }
  const turns: TranscriptTurn[] = [];
  for (const line of transcript.split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(caller|agent|kunde|bot|assistant)\s*:\s*(.*)$/i);
    if (m) {
      const sp = m[1].toLowerCase();
      turns.push({
        speaker: sp === 'caller' || sp === 'kunde' ? 'caller' : 'agent',
        text: m[2].trim()
      });
    } else if (turns.length) {
      turns[turns.length - 1].text += ' ' + t;
    } else {
      turns.push({ speaker: 'unknown', text: t });
    }
  }
  return turns;
}

const GREETING_ONLY =
  /^(guten tag|hallo|willkommen|schönen tag|schoenen tag|grüß gott|gruss gott|wie kann ich)/i;

const AUTH_ASK_INSURANCE = /(versicherungsnummer|krankenversicherungsnummer|versicherungs.?nummer)/;
const AUTH_ASK_BIRTH = /(geburtsdatum|geburtstag|wann sind sie geboren)/;
const AUTH_ASK_NAME = /(vollständigen namen|vollstaendigen namen|ihr name|wie heißen sie|wie heissen sie)/;
const AUTH_ACK =
  /(danke|vielen dank|habe ich|notiert|verstanden|passt|stimmt|korrekt|weiter|als nächstes|als naechstes)/;

const COMPLETE =
  /(kündigung.*(bestätigt|bestaetigt|vorgenommen)|abgemeldet|ist pausiert|pause.*eingetragen|adresse.*(geändert|geaendert)|änderung.*vorgenommen|ist erledigt|erfolgreich|habe ich für sie|habe ich fuer sie|wurde.*bestätigt|lieferung.*(unterwegs|kommt|voraussichtlich)|sendung.*(unterwegs|kommt)|bestellung.*(versendet|unterwegs))/;

const CANNOT =
  /(ich kann das nicht|nicht selbst bearbeiten|keinen zugriff|nicht möglich|nicht moeglich|nicht gefunden|geht leider nicht|kann ich leider nicht|system.*(fehler|ausfall))/;

const TRANSFER_EXPLICIT =
  /(ich verbinde sie|ich leite sie|verbinde.*mit.*(mitarbeiter|kolleg|mensch)|ein kollege übernimmt|ein kollege uebernimmt|kundenservice.*(übernimmt|uebernimmt)|geben das an.*weiter|kollege.*übernimmt|kollege.*uebernimmt)/;

const TRANSFER_SOFT = /(ich leite.*(an|ihr)|kollegen.*melden sich|kundenservice.*melden sich|geben das.*weiter|wir leiten.*weiter)/;
const NEXT_STEP =
  /(melden sich|meldet sich|wird sich melden|rückruf|rueckruf|nehmen uns|übernehmen|uebernimmt|uebernehmen|innerhalb)/;

const FRUSTRATION =
  /(das verstehe ich nicht|schon wieder|immer noch|funktioniert nicht|keine ahnung mehr|unzufrieden|ärgerlich|aergerlich|nervt|so lange schon)/;

const CALLER_CONFUSION_SILENCE =
  /(hallo\?|hören sie mich|hoeren sie mich|sind sie noch da|bist du noch da|moment\?|einen moment\?)/i;

const PAUSE_CHECK_PHRASES =
  /(hallo\?|sind sie noch da|bist du noch da|hören sie mich|hoeren sie mich|moment\?|einen moment)/i;

const INTERRUPTION_RESTART =
  /(ich wollte|ich wollte eigentlich|noch mal|noch einmal|wie gesagt|das habe ich|schon gesagt)/i;

const NORMAL_AUTH_SEQUENCE = /versicherungsnummer|geburtsdatum|geburtstag/;

type AuthField = 'insurance' | 'birthdate' | 'name';

function authFieldFromAgent(text: string): AuthField | null {
  const s = norm(text);
  if (AUTH_ASK_INSURANCE.test(s)) return 'insurance';
  if (AUTH_ASK_BIRTH.test(s)) return 'birthdate';
  if (AUTH_ASK_NAME.test(s)) return 'name';
  return null;
}

function callerProvidedValue(text: string): boolean {
  const s = norm(text);
  if (s.length < 2) return false;
  if (/\d{2,}/.test(s)) return true;
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s)) return true;
  if (/(mein name ist|ich heiße|ich heisse|nummer ist|lautet)/.test(s)) return true;
  if (s.split(' ').length >= 2 && !/^(ja|nein|okay|ok)$/i.test(s)) return true;
  return false;
}

/** Same auth field asked again after caller already answered — not insurance then DOB. */
export function detectRepeatedAuthentication(turns: TranscriptTurn[]): boolean {
  let lastAsked: AuthField | null = null;
  let callerAnsweredSinceAsk = false;

  for (const turn of turns) {
    if (turn.speaker === 'agent') {
      const field = authFieldFromAgent(turn.text);
      if (field) {
        if (lastAsked === field && callerAnsweredSinceAsk) return true;
        lastAsked = field;
        callerAnsweredSinceAsk = false;
      }
      continue;
    }
    if (turn.speaker === 'caller' && lastAsked && callerProvidedValue(turn.text)) {
      callerAnsweredSinceAsk = true;
    }
  }
  return false;
}

export function detectMissingAltVerification(turns: TranscriptTurn[]): boolean {
  const full = turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
  return /(habe ich nicht|nicht dabei|weiß ich nicht|weiss ich nicht).{0,60}(versicherungsnummer|versicherung)/i.test(
    full
  );
}

export function detectExplicitEscalation(turns: TranscriptTurn[]): boolean {
  const agentText = norm(turns.filter(t => t.speaker === 'agent').map(t => t.text).join(' '));
  return (
    TRANSFER_EXPLICIT.test(agentText) ||
    (TRANSFER_SOFT.test(agentText) && NEXT_STEP.test(agentText))
  );
}

export function detectSegmentSilenceIssues(segments: TranscriptSegment[]): {
  gapSeconds: number;
  quote: string;
  start?: number;
  end?: number;
  confidence: 'medium' | 'high';
} | null {
  let best: {
    gapSeconds: number;
    quote: string;
    start?: number;
    end?: number;
    confidence: 'medium' | 'high';
  } | null = null;

  for (let i = 1; i < segments.length; i++) {
    const gap = (segments[i].start || 0) - (segments[i - 1].end || 0);
    if (gap < 3) continue;

    const after = segments[i].text || '';
    const before = segments[i - 1].text || '';
    const nearby = `${before} ${after}`;
    const hasPhrase = PAUSE_CHECK_PHRASES.test(nearby);
    const confidence: 'medium' | 'high' =
      hasPhrase && gap >= 3 ? 'high' : gap >= 5 ? 'high' : gap >= 3 ? 'medium' : 'medium';

    if (gap >= 5 || (gap >= 3 && hasPhrase)) {
      const quote = (hasPhrase ? after || before : before || after).trim().slice(0, 280);
      const score = gap + (hasPhrase ? 10 : 0);
      if (!best || score > best.gapSeconds + (best.confidence === 'high' ? 10 : 0)) {
        best = {
          gapSeconds: gap,
          quote,
          start: segments[i - 1].end,
          end: segments[i].start,
          confidence
        };
      }
    }
  }
  return best;
}

export function detectInterruptionIssues(
  transcript: string,
  segments?: TranscriptSegment[]
): { quote: string; confidence: 'medium' | 'high'; start?: number } | null {
  const turns = parseTranscriptTurns(transcript, segments);
  const full = norm(transcript);

  for (let i = 0; i < turns.length - 1; i++) {
    const cur = turns[i];
    const next = turns[i + 1];
    if (cur.speaker === 'caller' && next.speaker === 'agent') {
      const curText = norm(cur.text);
      if (
        INTERRUPTION_RESTART.test(cur.text) &&
        (curText.length < 80 || /^(ich wollte|moment)/.test(curText))
      ) {
        if (cur.end != null && next.start != null && next.start - cur.end < 1.5) {
          return {
            quote: `${cur.text} … ${next.text}`.slice(0, 280),
            confidence: 'high',
            start: cur.start
          };
        }
      }
    }
    if (cur.speaker === 'caller' && next.speaker === 'caller') {
      const a = norm(cur.text);
      const b = norm(next.text);
      if (a.length > 8 && b.length > 8 && (a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20)))) {
        return {
          quote: `${cur.text} … ${next.text}`.slice(0, 280),
          confidence: 'medium',
          start: cur.start
        };
      }
    }
  }

  if (/(hallo\?|hören sie mich|hoeren sie mich).{0,40}(ich wollte|ich moechte)/i.test(full)) {
    const m = transcript.match(/[^.\n]{0,60}(hallo\?|hören sie mich|hoeren sie mich)[^.\n]{0,80}/i);
    if (m) return { quote: m[0].trim().slice(0, 280), confidence: 'high' };
  }

  return null;
}

function inferCompletion(turns: TranscriptTurn[], fullText: string): CallUnderstanding['completion_state'] {
  const text = norm(fullText);
  if (COMPLETE.test(text) && !CANNOT.test(text)) return 'completed';
  const transfer =
    TRANSFER_EXPLICIT.test(text) || (TRANSFER_SOFT.test(text) && NEXT_STEP.test(text));
  if (transfer && !COMPLETE.test(text)) return 'handoff_partial';
  if (CANNOT.test(text) && !COMPLETE.test(text)) return 'failed';
  const lastCaller = [...turns].reverse().find(t => t.speaker === 'caller')?.text || '';
  if (/(danke|auf wiedersehen|tschüss|tschuess|das war)/i.test(lastCaller) && COMPLETE.test(text)) {
    return 'completed';
  }
  return 'unclear';
}

export function completionToSolved(state: CallUnderstanding['completion_state']): SolvedStatus {
  if (state === 'completed') return 'yes';
  if (state === 'handoff_partial') return 'partially';
  return 'no';
}

export function buildAllowEvidenceFlags(u: CallUnderstanding): Record<EvidenceMomentType, boolean> {
  return {
    repeated_authentication: u.repeated_auth_failure,
    missing_alternative_verification: u.missing_alt_verification,
    caller_cut_off: u.customer_frustration,
    long_pause: false,
    wrong_workflow: u.workflow_failed && !u.request_completed,
    unresolved_request:
      !u.request_completed && u.workflow_failed && !u.human_transfer_explicit,
    escalation: u.human_transfer_explicit,
    missing_function_call: u.workflow_failed && !u.request_completed,
    function_argument_mismatch: u.workflow_failed,
    claimed_completion_without_execution: u.workflow_failed && !u.request_completed,
    avoidable_transfer: u.human_transfer_explicit && !u.request_completed,
    product_availability: false,
    missing_integration: u.workflow_failed && !u.request_completed,
    manual_highlight: true,
    other: false,
    authentication_friction: u.repeated_auth_failure,
    repeated_question: u.repeated_auth_failure,
    wrong_routing: u.workflow_failed,
    wrong_answer: !u.request_completed,
    robotic_pacing: false
  };
}

export function analyzeCallContext(
  transcript: string,
  segments?: TranscriptSegment[],
  aiHints?: {
    caller_request?: unknown;
    original_intent_summary?: string;
    solved_status?: unknown;
    call_understanding?: Record<string, unknown>;
  }
): CallUnderstanding {
  const turns = parseTranscriptTurns(transcript, segments);
  const fullText = transcript || turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
  const text = norm(fullText);

  const cu = aiHints?.call_understanding || {};
  const repeated_auth_failure =
    Boolean(cu.authentication_repeat_failure) || detectRepeatedAuthentication(turns);
  const missing_alt_verification =
    Boolean(cu.missing_alternative_verification) || detectMissingAltVerification(turns);
  const human_transfer_explicit = detectExplicitEscalation(turns);
  const human_transfer =
    human_transfer_explicit || (TRANSFER_SOFT.test(text) && NEXT_STEP.test(text));
  const authentication_normal =
    cu.authentication_normal !== false &&
    NORMAL_AUTH_SEQUENCE.test(text) &&
    !repeated_auth_failure &&
    !missing_alt_verification;

  let completion_state = inferCompletion(turns, fullText);
  if (cu.request_completed === true) completion_state = 'completed';
  if (cu.request_completed === false && completion_state === 'completed' && !COMPLETE.test(text)) {
    completion_state = inferCompletion(turns, fullText);
  }

  const request_completed = completion_state === 'completed';
  const workflow_failed =
    Boolean(cu.workflow_failed) || CANNOT.test(text) || (completion_state === 'failed' && !request_completed);
  const customer_frustration =
    Boolean(cu.customer_frustration) || FRUSTRATION.test(text) || CALLER_CONFUSION_SILENCE.test(text);

  let solved_status = completionToSolved(completion_state);
  const aiSolved = String(aiHints?.solved_status || '').toLowerCase();
  if (request_completed) solved_status = 'yes';
  else if (human_transfer && NEXT_STEP.test(text) && !request_completed) solved_status = 'partially';
  else if (aiSolved === 'yes' && request_completed) solved_status = 'yes';
  else if (aiSolved === 'partially' && human_transfer && NEXT_STEP.test(text)) solved_status = 'partially';
  else if (aiSolved === 'partially' && !human_transfer) solved_status = 'no';
  else if (solved_status === 'partially' && !(human_transfer && NEXT_STEP.test(text))) solved_status = 'no';

  const anliegen = applyIntentSafeguards(
    aiHints?.caller_request,
    String(aiHints?.original_intent_summary || cu.customer_goal || ''),
    fullText
  );

  const customer_goal =
    String(cu.customer_goal || aiHints?.original_intent_summary || '').trim() ||
    `Caller intent: ${migrateAnliegenCategory(anliegen)}`;

  const base: CallUnderstanding = {
    customer_goal,
    anliegen,
    request_completed,
    human_transfer,
    human_transfer_explicit,
    authentication_normal,
    repeated_auth_failure,
    missing_alt_verification,
    customer_frustration,
    workflow_failed,
    completion_state,
    solved_status,
    allow_evidence: {} as Record<EvidenceMomentType, boolean>
  };
  base.allow_evidence = buildAllowEvidenceFlags(base);
  const interruption = detectInterruptionIssues(fullText, segments);
  if (segments?.length) {
    const silence = detectSegmentSilenceIssues(segments);
    base.allow_evidence.long_pause = !!silence && (silence.confidence === 'high' || silence.gapSeconds >= 5);
    base.allow_evidence.caller_cut_off =
      base.allow_evidence.caller_cut_off || (!!interruption && interruption.confidence === 'high');
  } else if (CALLER_CONFUSION_SILENCE.test(text)) {
    base.allow_evidence.long_pause = true;
  }
  if (interruption?.confidence === 'high') {
    base.allow_evidence.caller_cut_off = true;
  }
  return base;
}

const NORMAL_ONLY_QUOTE =
  /^(guten tag|hallo|willkommen|bitte nennen sie|nennen sie mir|versicherungsnummer|geburtsdatum|einen moment|danke für|danke fuer)/i;

export function isNormalConversationExcerpt(quote: string, momentType: EvidenceMomentType): boolean {
  const q = norm(quote);
  if (q.length < 10) return true;
  if (CALLER_CONFUSION_SILENCE.test(q)) return false;
  if (GREETING_ONLY.test(q) && q.length < 35) return true;
  if (momentType === 'escalation') {
    if (!TRANSFER_EXPLICIT.test(q) && !TRANSFER_SOFT.test(q)) return true;
    if (AUTH_ASK_INSURANCE.test(q) || AUTH_ASK_BIRTH.test(q)) return true;
  }
  if (momentType === 'repeated_authentication') {
    if (!/(noch einmal|erneut|wieder|schon einmal|gerade gesagt|noch mal|\.\.\.|…)/.test(q)) {
      return true;
    }
  }
  if (momentType === 'long_pause' && !CALLER_CONFUSION_SILENCE.test(q) && q.length < 40) return true;
  if (
    (momentType === 'unresolved_request' || momentType === 'escalation') &&
    NORMAL_ONLY_QUOTE.test(q) &&
    !CANNOT.test(q)
  ) {
    return true;
  }
  return false;
}

export function validateEvidenceMoment(
  moment: Partial<EvidenceMoment>,
  understanding: CallUnderstanding,
  transcript: string
): { ok: boolean; reason?: string } {
  if (moment.source === 'manual') return { ok: true };

  const type = (moment.moment_type || 'other') as EvidenceMomentType;
  if (type === 'manual_highlight') return { ok: true };

  const confidence = moment.confidence || 'medium';
  if (confidence !== 'high') return { ok: false, reason: 'only high-confidence AI auto-evidence allowed' };

  const quote = String(moment.quote_or_transcript_excerpt || '').trim();
  if (quote.length < 12) return { ok: false, reason: 'quote too short' };

  if (isNormalConversationExcerpt(quote, type)) return { ok: false, reason: 'normal conversation' };

  if (!understanding.allow_evidence[type]) return { ok: false, reason: `not allowed: ${type}` };

  if (type === 'escalation' && !understanding.human_transfer_explicit && !TRANSFER_EXPLICIT.test(norm(quote))) {
    return { ok: false, reason: 'no real escalation' };
  }
  if (type === 'repeated_authentication' && !understanding.repeated_auth_failure) {
    return { ok: false, reason: 'auth sequence normal' };
  }
  if (type === 'unresolved_request' && understanding.request_completed) {
    return { ok: false, reason: 'request completed' };
  }
  if (type === 'long_pause' && !understanding.allow_evidence.long_pause) {
    return { ok: false, reason: 'no significant silence' };
  }

  const t = norm(transcript);
  const q = norm(quote);
  if (t && q.length >= 12 && !t.includes(q.slice(0, Math.min(60, q.length)))) {
    const words = q.split(' ').filter(w => w.length > 4);
    if (words.length >= 3 && words.filter(w => t.includes(w)).length / words.length < 0.5) {
      return { ok: false, reason: 'quote not in transcript' };
    }
  }

  return { ok: true };
}

/** Lighter gate for medium-confidence suggestions shown as pending AI suggested rows. */
export function validateEvidenceSuggestion(
  moment: Partial<EvidenceMoment>,
  understanding: CallUnderstanding,
  transcript: string
): { ok: boolean; reason?: string } {
  if (moment.source === 'manual') return { ok: true };

  const type = (moment.moment_type || 'other') as EvidenceMomentType;
  if (type === 'manual_highlight') return { ok: true };
  if (moment.confidence === 'low') return { ok: false, reason: 'low confidence' };

  const quote = String(moment.quote_or_transcript_excerpt || '').trim();
  if (quote.length < 12) return { ok: false, reason: 'quote too short' };
  if (isNormalConversationExcerpt(quote, type)) return { ok: false, reason: 'normal conversation' };

  const t = norm(transcript);
  const q = norm(quote);
  if (t && q.length >= 12 && !t.includes(q.slice(0, Math.min(40, q.length)))) {
    const words = q.split(' ').filter(w => w.length > 4);
    if (words.length >= 3 && words.filter(w => t.includes(w)).length / words.length < 0.4) {
      return { ok: false, reason: 'quote not in transcript' };
    }
  }

  void understanding;
  return { ok: true };
}

export function filterEvidenceList(
  raw: Partial<EvidenceMoment>[],
  understanding: CallUnderstanding,
  transcript: string,
  max = 3
): Partial<EvidenceMoment>[] {
  const confirmed: Partial<EvidenceMoment>[] = [];
  const suggested: Partial<EvidenceMoment>[] = [];
  const seen = new Set<string>();

  const dedupeKey = (e: Partial<EvidenceMoment>) =>
    `${e.moment_type}:${String(e.quote_or_transcript_excerpt || '').slice(0, 60).toLowerCase()}`;

  for (const e of raw) {
    const key = dedupeKey(e);
    if (seen.has(key)) continue;

    const strict = validateEvidenceMoment(e, understanding, transcript);
    if (strict.ok) {
      seen.add(key);
      confirmed.push({
        ...e,
        source: e.source === 'audio_listener' ? 'audio_listener' : e.source || 'ai',
        reviewer_status: 'pending'
      });
      continue;
    }

    const loose = validateEvidenceSuggestion(e, understanding, transcript);
    if (loose.ok) {
      seen.add(key);
      suggested.push({
        ...e,
        source: 'ai_suggested',
        confidence: e.confidence || 'medium',
        reviewer_status: 'pending'
      });
    }
  }

  return [...confirmed, ...suggested].slice(0, Math.max(max, 5));
}

export function detectContextualEvidence(
  understanding: CallUnderstanding,
  transcript: string,
  callId: string,
  segments?: TranscriptSegment[]
): Partial<EvidenceMoment>[] {
  const now = new Date().toISOString();
  const out: Partial<EvidenceMoment>[] = [];

  const t = norm(transcript);

  if (understanding.missing_alt_verification && understanding.allow_evidence.missing_alternative_verification) {
    const m = t.match(
      /[^.\n]{0,50}(habe ich nicht|nicht dabei|weiß ich nicht|weiss ich nicht)[^.\n]{0,50}(versicherungsnummer|versicherung)/
    );
    if (m) {
      out.push({
        call_id: callId,
        moment_type: 'missing_alternative_verification',
        severity: 'high',
        speaker: 'caller',
        quote_or_transcript_excerpt: m[0].trim().slice(0, 280),
        explanation:
          'Caller cannot provide insurance number; bot should switch to name + birthdate instead of looping.',
        recommended_fix: 'Offer alternative verification when insurance number unavailable.',
        confidence: 'high',
        source: 'ai_suggested'
      });
    }
  }

  if (understanding.repeated_auth_failure && understanding.allow_evidence.repeated_authentication) {
    const turns = parseTranscriptTurns(transcript, segments);
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].speaker !== 'agent') continue;
      const field = authFieldFromAgent(turns[i].text);
      if (!field) continue;
      const later = turns.slice(i + 1).find(t => t.speaker === 'agent' && authFieldFromAgent(t.text) === field);
      if (later) {
        out.push({
          call_id: callId,
          moment_type: 'repeated_authentication',
          severity: 'high',
          speaker: 'agent',
          quote_or_transcript_excerpt: `${turns[i].text} … ${later.text}`.slice(0, 280),
          explanation: `Agent asked for ${field} again after caller already provided it.`,
          recommended_fix: 'Persist captured auth fields; do not re-ask the same field.',
          confidence: 'high',
          source: 'ai_suggested'
        });
        break;
      }
    }
  }

  if (understanding.allow_evidence.long_pause) {
    const silence = segments?.length ? detectSegmentSilenceIssues(segments) : null;
    const silenceQuote =
      silence?.quote ||
      (CALLER_CONFUSION_SILENCE.test(t)
        ? t.match(/[^.\n]{0,80}(hallo\?|sind sie noch da|hören sie mich|hoeren sie mich|moment\?)[^.\n]{0,40}/)?.[0]
        : null);
    if (silenceQuote && (silence?.confidence === 'high' || (silence?.gapSeconds ?? 0) >= 5)) {
      out.push({
        call_id: callId,
        moment_type: 'long_pause',
        severity: (silence?.gapSeconds ?? 0) >= 5 || silence?.confidence === 'high' ? 'high' : 'medium',
        speaker: PAUSE_CHECK_PHRASES.test(silenceQuote) ? 'caller' : 'agent',
        timestamp_start_seconds: silence?.start,
        timestamp_end_seconds: silence?.end,
        quote_or_transcript_excerpt: silenceQuote.trim().slice(0, 280),
        explanation: silence
          ? `Dead air ~${Math.round(silence.gapSeconds)}s${silence.confidence === 'high' ? ' with caller line-check phrase' : ''}.`
          : 'Caller checks whether the bot is still present after silence.',
        recommended_fix: 'Progress prompts during lookups; reduce silent gaps.',
        confidence: silence?.confidence || 'high',
        source: 'ai_suggested'
      });
    }
  }

  const interruption = detectInterruptionIssues(transcript, segments);
  if (interruption && interruption.confidence === 'high' && understanding.allow_evidence.caller_cut_off) {
    out.push({
      call_id: callId,
      moment_type: 'caller_cut_off',
      severity: 'high',
      speaker: 'caller',
      timestamp_start_seconds: interruption.start,
      quote_or_transcript_excerpt: interruption.quote,
      explanation: 'Caller appears interrupted or restarts mid-intent before completing their request.',
      recommended_fix: 'Increase endpointing patience; confirm intent before changing topic.',
      confidence: 'high',
      source: 'ai_suggested'
    });
  }

  if (understanding.human_transfer_explicit && understanding.allow_evidence.escalation) {
    const m =
      transcript.match(/[^.\n]{0,20}(ich (verbinde|leite) sie[^.\n]{0,90})/i) ||
      t.match(/[^.\n]{0,20}(ich (verbinde|leite) sie[^.\n]{0,90})/);
    if (m) {
      out.push({
        call_id: callId,
        moment_type: 'escalation',
        severity: 'medium',
        speaker: 'agent',
        quote_or_transcript_excerpt: (m[1] || m[0]).trim().slice(0, 280),
        explanation: 'Explicit transfer to human agent or team.',
        recommended_fix: 'Ensure transfer reason and captured context are passed to human agent.',
        confidence: 'high',
        source: 'ai_suggested'
      });
    }
  }

  return out.slice(0, 2);
}
