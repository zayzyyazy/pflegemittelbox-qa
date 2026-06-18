import type { CallReview, MarieFunctionCall } from '../types/CallReview';

export type ExplorationVerdict = 'match' | 'no_match' | 'unclear';

export type ExplorationEvidenceBasis = 'no_trace' | 'function_trace' | 'transcript_only';

export type ExplorationResult = {
  verdict: ExplorationVerdict;
  summary: string;
  needsReview: boolean;
  evidenceBasis: ExplorationEvidenceBasis;
  /** Human-readable note about what data the app could see */
  evidenceNote: string;
  /** Relevant functions found, if any */
  functionsSeen: string[];
};

const EMAIL_TICKET_FN = /send_email|create_ticket|ticket|callback|rückruf|rueckruf|mail_send|send_mail/i;

export function buildExplorationContext(brief: string): string {
  const trimmed = brief.trim();
  if (!trimmed) return '';
  return [
    'EXPLORATION FOCUS (reviewer test hypothesis — prioritize this over generic issues):',
    trimmed,
    'Answer whether this call supports or contradicts the hypothesis. Only flag when function trace or transcript gives clear evidence. If unsure, say needs manual review.'
  ].join('\n');
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function compact(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

/** Merge structured function_calls with anything we can recover from Leaping events. */
export function collectFunctionTrace(call: Partial<CallReview>): MarieFunctionCall[] {
  const out: MarieFunctionCall[] = [...(call.function_calls || [])];
  const events = call.leaping_transcript_events || [];

  for (const raw of events) {
    const e = asObj(raw);
    const type = compact(e.type).toLowerCase();
    const name = compact(e.name || e.function || e.tool_name || e.tool).toLowerCase();
    const msg = compact(e.message || e.content || e.text).toLowerCase();

    if (type === 'function_call_request' || type === 'function') {
      const status: MarieFunctionCall['status'] =
        type === 'function'
          ? (e.error ? 'error' : 'success')
          : 'unknown';
      if (name) out.push({ name, status });
      continue;
    }

    const calledInMsg = msg.match(/([a-z][a-z0-9_]*)\s+function\s+was\s+called/);
    if (calledInMsg) {
      out.push({ name: calledInMsg[1], status: 'success' });
      continue;
    }

    if ((type === 'action_start' || type === 'action_finish') && name) {
      out.push({ name, status: type === 'action_finish' ? 'success' : 'unknown' });
    }
  }

  const seen = new Set<string>();
  return out.filter(fn => {
    const key = `${fn.name}:${fn.status || 'unknown'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !!fn.name;
  });
}

function transcriptOnly(call: Partial<CallReview>) {
  return (call.transcript || '').toLowerCase();
}

function hasSuccessfulFunction(functions: MarieFunctionCall[], pattern: RegExp) {
  return functions.some(f => pattern.test(f.name) && f.status === 'success');
}

function hasUnknownFunction(functions: MarieFunctionCall[], pattern: RegExp) {
  return functions.some(f => pattern.test(f.name) && f.status !== 'success' && f.status !== 'error');
}

function relevantEmailTicketFunctions(functions: MarieFunctionCall[]) {
  return functions.filter(f => EMAIL_TICKET_FN.test(f.name));
}

/** Marie actively promised to send/record — not merely mentioning a support email address. */
function mariePromisedTicketOrEmail(transcript: string) {
  return (
    /(?:ich )?(?:erstell|lege|nehme|schick|sende|leite).{0,40}(?:ticket|eintrag|rückruf|rueckruf|callback|mail|email)/.test(transcript) ||
    /(?:ticket|eintrag|rückruf|rueckruf|callback).{0,30}(?:erstell|angelegt|aufgenommen|geschickt|gesendet)/.test(transcript) ||
    /(?:ich )?notier.{0,30}(?:anfrage|wunsch|rückruf|rueckruf)/.test(transcript)
  );
}

export function describeExplorationEvidence(call: Partial<CallReview>): {
  basis: ExplorationEvidenceBasis;
  note: string;
  functionsSeen: string[];
} {
  const all = collectFunctionTrace(call);
  const relevant = relevantEmailTicketFunctions(all);
  const fromLeaping = !!(call.leaping_call_id || call.leaping_transcript_events?.length);

  if (relevant.length) {
    return {
      basis: 'function_trace',
      note: fromLeaping
        ? 'Leaping function trace is available for this call.'
        : 'Function trace was found on this call record.',
      functionsSeen: relevant.map(f => `${f.name} (${f.status || 'unknown'})`)
    };
  }

  if (all.length) {
    return {
      basis: 'function_trace',
      note: `Other functions were logged (${all.slice(0, 4).map(f => f.name).join(', ')}${all.length > 4 ? '…' : ''}), but no send_email / ticket function.`,
      functionsSeen: []
    };
  }

  return {
    basis: 'no_trace',
    note: 'Audio-only import — no Marie function log. Open this call in Leaping (Detailed view) to verify send_email / create_ticket.',
    functionsSeen: []
  };
}

function formatExplorationVerdict(result: ExplorationResult): string {
  const label =
    result.verdict === 'match'
      ? 'Hypothesis supported'
      : result.verdict === 'no_match'
        ? 'Hypothesis not supported'
        : 'Needs your review';
  return `${label}: ${result.summary}`;
}

export function applyExplorationVerdict(
  call: Partial<CallReview>,
  brief: string
): Partial<CallReview> {
  const trimmed = brief.trim();
  if (!trimmed) {
    return {
      ...call,
      exploration_brief: undefined,
      exploration_verdict: undefined,
      needs_review: call.needs_review
    };
  }
  const exploration = evaluateExplorationBrief(call, trimmed);
  if (!exploration) return call;
  return {
    ...call,
    exploration_brief: trimmed,
    exploration_verdict: formatExplorationVerdict(exploration),
    needs_review: exploration.needsReview
  };
}

export function evaluateExplorationBrief(
  call: Partial<CallReview>,
  brief: string
): ExplorationResult | null {
  const b = brief.trim().toLowerCase();
  if (!b) return null;

  const functions = collectFunctionTrace(call);
  const relevantFns = relevantEmailTicketFunctions(functions);
  const evidence = describeExplorationEvidence(call);
  const transcript = transcriptOnly(call);

  const testsEmailTicketGap =
    /ticket|callback|rückruf|rueckruf|eintrag|send_email|email|mail/.test(b) &&
    (/not called|never|missing|without|no function|nicht|promised|versprochen/.test(b) || /send_email/.test(b));

  if (testsEmailTicketGap) {
    const emailSuccess = hasSuccessfulFunction(functions, EMAIL_TICKET_FN);
    const emailUnknown = hasUnknownFunction(functions, EMAIL_TICKET_FN);

    if (emailSuccess) {
      const names = relevantFns.map(f => f.name).join(', ') || 'email/ticket function';
      return {
        verdict: 'no_match',
        summary: `${names} completed successfully in the function trace.`,
        needsReview: false,
        evidenceBasis: 'function_trace',
        evidenceNote: evidence.note,
        functionsSeen: evidence.functionsSeen
      };
    }

    if (relevantFns.length === 0) {
      return {
        verdict: 'unclear',
        summary:
          'Cannot verify send_email / ticket from audio alone. Check Leaping Detailed view for function_call_request entries.',
        needsReview: true,
        evidenceBasis: 'no_trace',
        evidenceNote: evidence.note,
        functionsSeen: []
      };
    }

    if (emailUnknown) {
      return {
        verdict: 'unclear',
        summary:
          'Email/ticket function appears in the trace but success is unclear — confirm in Leaping before deciding.',
        needsReview: true,
        evidenceBasis: 'function_trace',
        evidenceNote: evidence.note,
        functionsSeen: evidence.functionsSeen
      };
    }

    if (mariePromisedTicketOrEmail(transcript)) {
      return {
        verdict: 'match',
        summary:
          'Marie promised ticket/callback/email handling and no successful send_email or ticket function appears in the trace.',
        needsReview: false,
        evidenceBasis: 'function_trace',
        evidenceNote: evidence.note,
        functionsSeen: evidence.functionsSeen
      };
    }

    return {
      verdict: 'unclear',
      summary:
        'Function trace has no successful email/ticket call, but transcript does not clearly show Marie promising one — review manually.',
      needsReview: true,
      evidenceBasis: relevantFns.length ? 'function_trace' : 'no_trace',
      evidenceNote: evidence.note,
      functionsSeen: evidence.functionsSeen
    };
  }

  if (/verif|insurance|versicher|auth|vnr|geburt|identif/.test(b)) {
    const repeatedInTranscript = /(nochmal|noch einmal|bitte.*wieder|komplette nummer)/.test(transcript);
    const authFns = functions.filter(f => /birthday|geburtsdatum|verify|versicher|insurance|check_customer/.test(f.name));
    if (repeatedInTranscript && /repeat|twice|again|mehrfach|nochmal/.test(b)) {
      return {
        verdict: 'match',
        summary: 'Transcript shows identification asked again after an answer.',
        needsReview: false,
        evidenceBasis: 'transcript_only',
        evidenceNote: 'Based on transcript wording only — no auth function trace required for this pattern.',
        functionsSeen: authFns.map(f => `${f.name} (${f.status || 'unknown'})`)
      };
    }
    if (authFns.length && /better|works|improv/.test(b)) {
      return {
        verdict: 'no_match',
        summary: 'Verification-related functions appear in the trace.',
        needsReview: false,
        evidenceBasis: authFns.length ? 'function_trace' : 'transcript_only',
        evidenceNote: evidence.note,
        functionsSeen: authFns.map(f => `${f.name} (${f.status || 'unknown'})`)
      };
    }
    return {
      verdict: 'unclear',
      summary: 'Auth hypothesis needs manual transcript review.',
      needsReview: true,
      evidenceBasis: authFns.length ? 'function_trace' : 'no_trace',
      evidenceNote: evidence.note,
      functionsSeen: authFns.map(f => `${f.name} (${f.status || 'unknown'})`)
    };
  }

  if (/box|product|produkt|change|wechsel|inhalt/.test(b)) {
    const boxFns = functions.filter(f => /box|update|change|product/.test(f.name));
    if (hasSuccessfulFunction(functions, /box|update|change|product/)) {
      return {
        verdict: 'no_match',
        summary: 'A box/change function completed successfully in the trace.',
        needsReview: false,
        evidenceBasis: 'function_trace',
        evidenceNote: evidence.note,
        functionsSeen: boxFns.map(f => `${f.name} (${f.status || 'unknown'})`)
      };
    }
    return {
      verdict: 'unclear',
      summary: 'Box/product hypothesis cannot be confirmed without function trace — review in Leaping or transcript.',
      needsReview: true,
      evidenceBasis: boxFns.length ? 'function_trace' : 'no_trace',
      evidenceNote: evidence.note,
      functionsSeen: boxFns.map(f => `${f.name} (${f.status || 'unknown'})`)
    };
  }

  return {
    verdict: 'unclear',
    summary: 'Exploration focus not auto-classified — review this call manually.',
    needsReview: true,
    evidenceBasis: 'no_trace',
    evidenceNote: evidence.note,
    functionsSeen: evidence.functionsSeen
  };
}
