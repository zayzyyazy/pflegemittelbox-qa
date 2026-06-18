import type {
  AnliegenCategory,
  CallReview,
  MarieFunctionCall,
  MarieOperationTrace,
  MarieOperationValueCheck
} from '../types/CallReview';

function compact(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function normalizeValue(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}@.]+/gu, '');
}

function textBlob(call: Partial<CallReview>) {
  return [
    call.transcript,
    call.call_summary,
    call.original_intent_summary,
    call.caller_context,
    call.final_outcome
  ].filter(Boolean).join('\n').toLowerCase();
}

function functionNameBlob(functions: MarieFunctionCall[]) {
  return functions.map(f => f.name.toLowerCase()).join(' ');
}

function transitionBlob(call: Partial<CallReview>) {
  return (call.transitions || [])
    .map(t => `${t.from || ''} ${t.to || ''} ${t.node || ''} ${t.label || ''}`)
    .join(' ')
    .toLowerCase();
}

function expectedAction(anliegen: AnliegenCategory | undefined, blob: string): MarieOperationTrace['expected_action'] {
  if (anliegen === 'cancel_or_pause' || /kündig|kuendig|pause|pausier|stopp/.test(blob)) return 'pause_or_cancel';
  if (anliegen === 'box_or_product_change' || /box|produkt|handschuh|desinfektion|einlage|größe|groesse|inhalt/.test(blob)) return 'change_box';
  if (anliegen === 'order_status' || /liefer|sendung|tracking|status|wo ist/.test(blob)) return 'delivery_status';
  if (anliegen === 'address_or_account_change' || /adresse|anschrift|umzug|email|telefonnummer/.test(blob)) return 'address_or_account_change';
  if (anliegen === 'authentication_problem' || /geburtsdatum|versicherungsnummer|vnr/.test(blob)) return 'verify_customer';
  if (/ticket|weiterleit|transfer|kundenservice/.test(blob)) return 'ticket_or_transfer';
  return 'unknown';
}

function expectedFunctions(action: MarieOperationTrace['expected_action']) {
  switch (action) {
    case 'verify_customer':
      return ['check_birthday', 'verify_customer', 'lookup_customer'];
    case 'pause_or_cancel':
      return ['pause_box', 'cancel_box', 'update_status_box', 'create_ticket'];
    case 'change_box':
      return ['update_box', 'change_box_products', 'update_status_box'];
    case 'delivery_status':
      return ['get_delivery_status', 'get_lieferstatus', 'lookup_shipment'];
    case 'address_or_account_change':
      return ['update_customer', 'update_address', 'create_ticket'];
    case 'ticket_or_transfer':
      return ['create_ticket', 'transfer_call'];
    default:
      return [];
  }
}

function expectedMatcher(names: string[]) {
  const pieces = names
    .flatMap(name => [name, name.replace(/_/g, ''), name.replace(/_/g, '[-_]?')])
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[-_\\]\?/g, '[-_]?'));
  return pieces.length ? new RegExp(pieces.join('|'), 'i') : null;
}

function getArgValue(fn: MarieFunctionCall, keys: string[]) {
  const args = fn.arguments || {};
  for (const key of keys) {
    const exact = compact(args[key]);
    if (exact) return exact;
    const found = Object.entries(args).find(([k, v]) => k.toLowerCase().includes(key.toLowerCase()) && compact(v));
    if (found) return compact(found[1]);
  }
  return '';
}

function firstFunctionValue(functions: MarieFunctionCall[], keys: string[]) {
  for (const fn of functions) {
    const value = getArgValue(fn, keys);
    if (value) return value;
  }
  return '';
}

function valueCheck(field: MarieOperationValueCheck['field'], customerValue: string, functionValue: string): MarieOperationValueCheck {
  if (!customerValue && !functionValue) return { field, status: 'unknown' };
  if (!customerValue) return { field, function_value: functionValue, status: 'missing_customer_value' };
  if (!functionValue) return { field, customer_value: customerValue, status: 'missing_function_value' };
  return {
    field,
    customer_value: customerValue,
    function_value: functionValue,
    status: normalizeValue(customerValue) === normalizeValue(functionValue) ? 'match' : 'mismatch'
  };
}

function birthdayFromTranscript(blob: string) {
  return blob.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/)?.[1] || '';
}

function vnrFromTranscript(blob: string) {
  return blob.match(/\b(?:vnr|versicherungsnummer)\D{0,20}([a-z]?\d[\d\s./-]{5,})\b/i)?.[1]?.trim() || '';
}

export function buildMarieOperationTrace(call: Partial<CallReview>): MarieOperationTrace {
  const functions = call.function_calls || [];
  const blob = textBlob(call);
  const names = functionNameBlob(functions);
  const transitions = transitionBlob(call);
  const action = expectedAction(call.anliegen, blob);
  const expected = expectedFunctions(action);
  const matcher = expectedMatcher(expected);
  const relevantFunctions = matcher ? functions.filter(f => matcher.test(f.name)) : [];
  const verificationCalled = functions.some(f => /birthday|geburtsdatum|verify|auth|lookup_customer|check_customer/.test(f.name.toLowerCase()));
  const customerVnr = compact(call.vnr) || vnrFromTranscript(blob);
  const customerBirthday = compact(call.birthday) || birthdayFromTranscript(blob);
  const customerPhone = compact(call.phone);
  const customerEmail = compact(call.email);
  const functionVnr = firstFunctionValue(functions, ['vnr', 'insurance', 'versicherungsnummer', 'customer_id']);
  const functionBirthday = firstFunctionValue(functions, ['birthday', 'birthdate', 'geburtsdatum', 'dob']);
  const functionPhone = firstFunctionValue(functions, ['phone', 'telefon']);
  const functionEmail = firstFunctionValue(functions, ['email', 'mail']);
  const value_checks = [
    valueCheck('vnr', customerVnr, functionVnr),
    valueCheck('birthday', customerBirthday, functionBirthday),
    valueCheck('phone', customerPhone, functionPhone),
    valueCheck('email', customerEmail, functionEmail)
  ].filter(check => check.status !== 'unknown');
  const argMismatch = value_checks.some(check => check.status === 'mismatch');
  const needsAuth = action !== 'unknown' && action !== 'ticket_or_transfer';
  const missing: Array<'vnr' | 'birthday'> = [];
  if (needsAuth && !customerVnr) missing.push('vnr');
  if (needsAuth && !customerBirthday) missing.push('birthday');
  const transferClaimed = /weiterleit|verbinde|transfer|kundenservice|mitarbeiter/.test(blob);
  const transferEvent = /transfer|handoff|weiterleit/.test(transitions) || functions.some(f => /transfer|handoff/.test(f.name.toLowerCase()));
  const completionClaimed = /habe (das|es).*(geändert|geaendert|pausiert|gekündigt|gekuendigt|veranlasst|erstellt)|ist (jetzt )?(geändert|geaendert|pausiert|gekündigt|gekuendigt)|ich (pausiere|kündige|kuendige|ändere|aendere)/.test(blob);
  const executionEvent = relevantFunctions.some(f => f.status === 'success') ||
    functions.some(f => /update|pause|cancel|kündig|kuendig|ticket|mail|email/.test(f.name.toLowerCase()) && f.status === 'success');
  const requestedWithoutResult = relevantFunctions.some(f => f.status === 'unknown');
  const failed = relevantFunctions.some(f => f.status === 'error') || functions.some(f => f.status === 'error');
  const functionCalled = relevantFunctions.length > 0 || functions.length > 0;
  const capabilitySupported = action !== 'unknown' && action !== 'ticket_or_transfer';
  const reviewer_flags: string[] = [];
  const evidence_summary: string[] = [];

  let status: MarieOperationTrace['status'] = 'not_applicable';
  let reason = 'No supported Marie operation was confidently detected.';

  if (argMismatch) {
    status = 'arg_mismatch';
    reason = 'A customer-provided value appears to differ from the value sent to a function.';
    reviewer_flags.push('value mismatch');
  } else if (failed) {
    status = 'failed';
    reason = 'A relevant function call returned an error.';
    reviewer_flags.push('function failed');
  } else if (completionClaimed && !executionEvent) {
    status = 'claimed_without_execution';
    reason = 'Marie appears to claim an action was completed, but no successful execution event was detected.';
    reviewer_flags.push('claimed done, no function');
  } else if (capabilitySupported && transferClaimed && !executionEvent) {
    status = 'transferred_instead';
    reason = 'The caller asked for a supported workflow, but Marie appears to transfer or forward instead of executing it.';
    reviewer_flags.push('avoidable transfer');
  } else if (capabilitySupported && missing.length && !functionCalled && !transferClaimed && !completionClaimed) {
    status = 'missing_precondition';
    reason = `Function may not have run because required customer value(s) are missing: ${missing.join(', ')}.`;
    reviewer_flags.push('missing precondition');
  } else if (capabilitySupported && !functionCalled && !executionEvent) {
    status = 'not_called';
    reason = 'The call looks like a supported workflow, but no expected function was detected.';
    reviewer_flags.push('expected function not called');
  } else if (requestedWithoutResult) {
    status = 'requested_no_result';
    reason = 'A relevant function was requested, but no matching successful result was detected.';
    reviewer_flags.push('function request unresolved');
  } else if (functionCalled || executionEvent) {
    status = 'succeeded';
    reason = 'A relevant function/execution event was detected.';
  }

  if (customerVnr) evidence_summary.push(`Customer VNR: ${customerVnr}`);
  if (customerBirthday) evidence_summary.push(`Customer birthday: ${customerBirthday}`);
  if (relevantFunctions.length) evidence_summary.push(`Relevant functions: ${relevantFunctions.map(f => `${f.name} (${f.status || 'unknown'})`).join(', ')}`);
  if (transferClaimed) evidence_summary.push(`Transfer language detected${transferEvent ? ' with transfer event' : ' without transfer event'}.`);
  if (completionClaimed) evidence_summary.push(`Completion claim detected${executionEvent ? ' with execution event' : ' without execution event'}.`);

  return {
    expected_action: action,
    expected_functions: expected,
    capability_supported: capabilitySupported,
    preconditions: {
      needs_vnr: needsAuth,
      needs_birthday: needsAuth,
      customer_provided_vnr: !!customerVnr,
      customer_provided_birthday: !!customerBirthday,
      verification_function_called: verificationCalled,
      missing
    },
    customer_values: {
      vnr: customerVnr || undefined,
      birthday: customerBirthday || undefined,
      phone: customerPhone || undefined,
      email: customerEmail || undefined
    },
    observed: {
      function_called: functionCalled,
      requested_without_result: requestedWithoutResult,
      function_failed: failed,
      transfer_claimed: transferClaimed,
      transfer_event: transferEvent,
      completion_claimed: completionClaimed,
      execution_event: executionEvent
    },
    value_checks,
    status,
    reason,
    reviewer_flags,
    evidence_summary
  };
}

export function operationTraceSeverity(trace: MarieOperationTrace): 'low' | 'medium' | 'high' {
  if (trace.status === 'arg_mismatch' || trace.status === 'failed' || trace.status === 'claimed_without_execution') return 'high';
  if (trace.status === 'transferred_instead' || trace.status === 'not_called' || trace.status === 'requested_no_result') return 'high';
  if (trace.status === 'missing_precondition') return 'medium';
  return 'low';
}
