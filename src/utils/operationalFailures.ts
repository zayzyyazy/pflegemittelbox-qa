import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { buildMarieOperationTrace } from './marieOperationTrace';

export type OperationalFailureKind =
  | 'repeated_authentication'
  | 'verification_missing'
  | 'ticket_not_created'
  | 'ticket_creation_failed'
  | 'claimed_not_done'
  | 'transferred_instead'
  | 'transfer_broken'
  | 'arg_mismatch'
  | 'action_not_executed'
  | 'call_dropped'
  | 'function_error';

export type OperationalFailure = {
  kind: OperationalFailureKind;
  label: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
  fix?: string;
};

const KIND_LABELS: Record<OperationalFailureKind, string> = {
  repeated_authentication: 'Repeated authentication',
  verification_missing: 'No authentication',
  ticket_not_created: 'Ticket/callback promised — not created',
  ticket_creation_failed: 'Ticket creation failed',
  claimed_not_done: 'Said done — not executed',
  transferred_instead: 'Transferred instead of doing it',
  transfer_broken: 'Transfer promised — did not happen',
  arg_mismatch: 'Wrong value sent to function',
  action_not_executed: 'Promised action missing',
  call_dropped: 'Call dropped early',
  function_error: 'Function failed'
};

const KIND_PRIORITY: Record<OperationalFailureKind, number> = {
  repeated_authentication: 0,
  verification_missing: 1,
  ticket_creation_failed: 2,
  ticket_not_created: 3,
  claimed_not_done: 4,
  transferred_instead: 5,
  transfer_broken: 6,
  arg_mismatch: 7,
  action_not_executed: 8,
  call_dropped: 9,
  function_error: 10
};

const ROUTINE_LOOKUP = /get_customer_by_phone|customer_by_phone|lookup.*phone|find_customer|search_customer/i;

function isRoutineLookupFailure(name: string) {
  return ROUTINE_LOOKUP.test(name);
}

function sortFailures(out: OperationalFailure[]) {
  return out.sort((a, b) => {
    const rank = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (rank !== 0) return rank;
    const sev = { high: 0, medium: 1, low: 2 };
    return sev[a.severity] - sev[b.severity];
  });
}

export function buildOperationalFailures(call: Partial<CallReview>): OperationalFailure[] {
  const trace = call.operation_trace || buildMarieOperationTrace(call);
  const functions = call.function_calls || [];
  const fnNames = functions.map(f => f.name.toLowerCase());
  const transitions = (call.transitions || [])
    .map(t => `${t.from || ''} ${t.to || ''} ${t.node || ''} ${t.label || ''}`)
    .join(' ')
    .toLowerCase();
  const blob = [
    call.transcript,
    call.call_summary,
    call.original_intent_summary
  ].filter(Boolean).join('\n').toLowerCase();
  const meaningfulErrors = functions.filter(f => f.status === 'error' && !isRoutineLookupFailure(f.name));

  const out: OperationalFailure[] = [];
  const push = (kind: OperationalFailureKind, detail: string, severity: 'high' | 'medium' | 'low', fix?: string) => {
    if (out.some(f => f.kind === kind)) return;
    out.push({ kind, label: KIND_LABELS[kind], severity, detail, fix });
  };

  const birthdayChecks = fnNames.filter(n => /birthday|geburtsdatum/.test(n));
  const authChecks = fnNames.filter(n => /birthday|geburtsdatum|verify|auth|versicher|insurance|check_customer/.test(n));
  const authPrompts = (blob.match(/geburtsdatum|versicherungsnummer|versichertennummer|noch einmal|wiederhol/g) || []).length;
  if (
    birthdayChecks.length > 1 ||
    (authChecks.length >= 3 && authPrompts >= 2) ||
    call.identification_problem ||
    call.repeated_question
  ) {
    push(
      'repeated_authentication',
      'Marie asked for birthday, insurance number, or other identification more than once.',
      'high',
      'Persist successful verification and stop re-asking after the caller already answered.'
    );
  }

  const accountWorkflow =
    /liefer|box|kündig|kuendig|pause|adresse|status|änder|aender/.test(blob) ||
    ['order_status', 'box_or_product_change', 'cancel_or_pause', 'address_or_account_change'].includes(call.anliegen || '');
  const authAttempted = fnNames.some(n =>
    /birthday|geburtsdatum|verify|auth|versicher|insurance|check_customer|lookup_customer|get_customer/.test(n)
  );
  const accountAction = fnNames.some(n => /delivery|pause|cancel|update|ticket|box|status/.test(n));
  if (accountWorkflow && accountAction && !authAttempted) {
    push(
      'verification_missing',
      'Marie handled an account-specific request without attempting customer verification.',
      'high',
      'Require insurance number or birthday verification before account actions.'
    );
  }

  const ticketFns = functions.filter(f => /ticket|callback|rückruf|rueckruf/.test(f.name.toLowerCase()));
  const ticketErrored = ticketFns.find(f => f.status === 'error');
  if (ticketErrored) {
    push(
      'ticket_creation_failed',
      `Ticket/callback function ${ticketErrored.name} returned an error.`,
      'high',
      'Inspect ticket API response and retry or escalate honestly to the caller.'
    );
  }

  const ticketClaimed = /ticket|eintrag|aufnehmen|rückruf|rueckruf|zurückruf|zurueckruf|aufnehmen.*anfrage/.test(blob);
  const ticketCreated = ticketFns.some(f => f.status === 'success');
  if (ticketClaimed && !ticketCreated && !ticketErrored) {
    push(
      'ticket_not_created',
      'Marie said she would create a ticket or record a callback, but no successful ticket/callback function ran.',
      'high',
      'Require create_ticket success before telling the caller it is recorded.'
    );
  }

  if (trace.status === 'claimed_without_execution' || (trace.observed.completion_claimed && !trace.observed.execution_event)) {
    push(
      'claimed_not_done',
      'Marie said the action was completed, but no successful function or execution event was detected.',
      'high',
      'Require a successful function result before confirming pause, cancel, box change, or ticket.'
    );
  }

  if (
    meaningfulErrors.length === 0 &&
    (trace.status === 'transferred_instead' ||
      (trace.observed.transfer_claimed && !trace.observed.execution_event && trace.capability_supported))
  ) {
    push(
      'transferred_instead',
      `Caller wanted ${trace.expected_action.replace(/_/g, ' ')}, but Marie transferred instead of executing.`,
      'high',
      'Check routing and capability gating before transfer fallback.'
    );
  }

  const transferClaimed = /weiterleit|verbinde ich sie|leite.*weiter/.test(blob);
  const transferEvent =
    /transfer|handoff|weiterleit/.test(transitions) ||
    functions.some(f => /transfer|handoff/.test(f.name.toLowerCase()) && f.status === 'success');
  if (transferClaimed && !transferEvent) {
    push(
      'transfer_broken',
      'Marie said she would transfer the call, but no transfer transition or function succeeded.',
      'medium',
      'Verify transfer event emission and fallback when transfer fails.'
    );
  }

  if (trace.status === 'arg_mismatch') {
    const mismatch = trace.value_checks.find(c => c.status === 'mismatch');
    push(
      'arg_mismatch',
      mismatch
        ? `Customer ${mismatch.field} "${mismatch.customer_value}" differs from function value "${mismatch.function_value}".`
        : 'A customer-provided value differs from what was sent to a function.',
      'high',
      'Compare transcript capture against function arguments before executing changes.'
    );
  }

  if (trace.status === 'not_called' || trace.status === 'requested_no_result') {
    push('action_not_executed', trace.reason, 'high', 'Review intent routing and function-call emission for this workflow.');
  }

  if (meaningfulErrors.length) {
    const failed = meaningfulErrors.map(f => f.name).join(', ');
    push(
      'function_error',
      `Function error: ${failed}.`,
      'high',
      'Inspect function arguments, API response, and fallback handling.'
    );
  } else if (trace.status === 'failed') {
    push('function_error', trace.reason, 'high');
  }

  if ((call.marie_call_status === 'dropped' || call.leaping_status === 'dropped') && call.marie_main_result !== 'unresolved') {
    push(
      'call_dropped',
      'Call status is dropped although outcome signals suggest the conversation may have completed.',
      'medium',
      'Review whether Marie hung up or lost the caller before finishing the workflow.'
    );
  }

  return sortFailures(out);
}

export function primaryOperationalFailure(call: Partial<CallReview>): OperationalFailure | undefined {
  return buildOperationalFailures(call)[0];
}

export function topOperationalLabel(call: Partial<CallReview>): string | undefined {
  return primaryOperationalFailure(call)?.label;
}

export function hasHighSeverityOperationalFailure(call: Partial<CallReview>): boolean {
  return buildOperationalFailures(call).some(f => f.severity === 'high');
}

const OPERATIONAL_MOMENT_TYPES = new Set([
  'repeated_authentication',
  'missing_alternative_verification',
  'missing_integration',
  'avoidable_transfer',
  'claimed_completion_without_execution',
  'missing_function_call',
  'function_argument_mismatch',
  'escalation',
  'unresolved_request',
  'wrong_workflow'
]);

export function isOperationalEvidence(ev: Partial<EvidenceMoment>): boolean {
  const type = String(ev.moment_type || '');
  if (ev.source === 'system_rule' && OPERATIONAL_MOMENT_TYPES.has(type)) return true;
  if (ev.source === 'manual') return true;
  if (ev.source === 'audio_listener' && ev.severity === 'high') return true;
  if ((ev.source === 'ai' || ev.source === 'ai_suggested') && ev.severity === 'high' && ev.quote_or_transcript_excerpt?.trim()) return true;
  if (type === 'repeated_authentication' && ev.severity === 'high') return true;
  return false;
}

function momentForKind(kind: OperationalFailureKind): EvidenceMoment['moment_type'] {
  return kind === 'repeated_authentication' ? 'repeated_authentication' :
    kind === 'function_error' ? 'missing_integration' :
    kind === 'claimed_not_done' ? 'claimed_completion_without_execution' :
    kind === 'transferred_instead' ? 'avoidable_transfer' :
    kind === 'ticket_not_created' || kind === 'ticket_creation_failed' ? 'missing_function_call' :
    kind === 'verification_missing' ? 'missing_alternative_verification' :
    kind === 'action_not_executed' ? 'missing_function_call' :
    kind === 'call_dropped' ? 'unresolved_request' :
    kind === 'transfer_broken' ? 'escalation' :
    kind === 'arg_mismatch' ? 'function_argument_mismatch' :
    'other';
}

export function mergeEvidenceForDisplay(
  call: Partial<CallReview>,
  evidence: EvidenceMoment[]
): EvidenceMoment[] {
  const operational = evidence.filter(e => isOperationalEvidence(e));
  const manual = evidence.filter(e => e.source === 'manual' && !operational.includes(e));
  const seen = new Set<string>();
  const deduped: EvidenceMoment[] = [];
  for (const ev of [...operational, ...manual]) {
    const key = `${ev.moment_type}:${ev.explanation?.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  const primary = primaryOperationalFailure(call);
  if (primary) {
    const synthetic: EvidenceMoment = {
      id: `ops:${primary.kind}`,
      call_id: call.id || '',
      speaker: 'unknown',
      moment_type: momentForKind(primary.kind),
      severity: primary.severity,
      explanation: primary.detail,
      recommended_fix: primary.fix || '',
      source: 'system_rule',
      reviewer_status: 'pending',
      quote_or_transcript_excerpt: '',
      voice_cue_notes: '',
      created_at: '',
      updated_at: ''
    };
    if (!deduped.some(e => e.moment_type === synthetic.moment_type)) {
      return [synthetic, ...deduped].slice(0, 2);
    }
  }

  if (!deduped.length && primary) {
    return [{
      id: `ops:${primary.kind}`,
      call_id: call.id || '',
      speaker: 'unknown',
      moment_type: momentForKind(primary.kind),
      severity: primary.severity,
      explanation: primary.detail,
      recommended_fix: primary.fix || '',
      source: 'system_rule',
      reviewer_status: 'pending',
      quote_or_transcript_excerpt: '',
      voice_cue_notes: '',
      created_at: '',
      updated_at: ''
    }];
  }

  return deduped.slice(0, 2);
}
