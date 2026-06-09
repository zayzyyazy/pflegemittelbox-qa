import type { Database } from './storageService';
import type { PatternThread } from '../types/PatternThread';
import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { callerRequestLabels } from '../utils/anliegen';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';

type PatternDef = {
  key: string;
  title: string;
  kind: PatternThread['kind'];
  description: string;
  suggested_fix: string;
  match: (call: CallReview, evidence: EvidenceMoment[]) => boolean;
  phrases?: string[];
};

const DEFS: PatternDef[] = [
  {
    key: 'cancel_to_pause',
    title: 'Cancellation intent is converted into pause flow',
    kind: 'workflow',
    description: 'Callers ask to cancel or stop delivery but the bot steers toward pause or retention.',
    suggested_fix: 'After explicit cancellation intent, confirm full cancel vs temporary pause before offering pause.',
    phrases: ['kündigen', 'pause', 'pausieren'],
    match: (c, ev) =>
      c.anliegen === 'cancel_or_pause' &&
      (ev.some(e => e.moment_type === 'wrong_workflow') ||
        /pause|pausieren/i.test(c.transcript) && /kündig|kuendig/i.test(c.transcript))
  },
  {
    key: 'auth_repeat',
    title: 'Authentication repeats after customer provides number',
    kind: 'agent_failure',
    description: 'Versicherungsnummer or Geburtsdatum requested again after caller already answered.',
    suggested_fix: 'Persist captured auth fields and confirm once; switch to name+DOB if insurance number unavailable.',
    phrases: ['versicherungsnummer', 'geburtsdatum'],
    match: (c, ev) =>
      ev.some(e => e.moment_type === 'repeated_authentication') ||
      (c.identification_problem && c.anliegen !== 'authentication_problem')
  },
  {
    key: 'order_no_lookup',
    title: 'Order status cannot be answered without shipment lookup',
    kind: 'issue_cluster',
    description: 'Delivery or order-status calls fail when shipment data is missing.',
    suggested_fix: 'Add shipment lookup or faster honest fallback before escalation.',
    phrases: ['lieferung', 'paket', 'keinen zugriff'],
    match: (c, ev) =>
      c.anliegen === 'order_status' &&
      (ev.some(e => e.moment_type === 'missing_integration') || c.missing_integration)
  },
  {
    key: 'still_there_silence',
    title: 'Long silence causes caller to check if bot is still present',
    kind: 'agent_failure',
    description: 'Dead air or long lookup gaps; agent or caller checks connection.',
    suggested_fix: 'Add short progress acknowledgements during lookups; reduce dead air before "Sind Sie noch da?".',
    phrases: ['sind sie noch da', 'hallo?', 'hören sie mich'],
    match: (_c, ev) => ev.some(e => e.moment_type === 'long_pause')
  },
  {
    key: 'product_unavailable',
    title: 'Product change flow loops on unavailable items',
    kind: 'workflow',
    description: 'Box/product change calls struggle when requested items are unavailable.',
    suggested_fix: 'Clearly explain alternatives when a product is unavailable; avoid looping menus.',
    phrases: ['nicht verfügbar', 'nicht verfuegbar', 'alternative'],
    match: (c, ev) =>
      c.anliegen === 'box_or_product_change' &&
      ev.some(e => e.moment_type === 'product_availability' || e.moment_type === 'unresolved_request')
  },
  {
    key: 'missing_alt_verify',
    title: 'No alternative verification when insurance number missing',
    kind: 'agent_failure',
    description: 'Caller lacks Versicherungsnummer but bot keeps asking for it.',
    suggested_fix: 'If caller cannot provide insurance number, switch to name + birthdate verification.',
    phrases: ['habe ich nicht', 'versicherungsnummer'],
    match: (_c, ev) => ev.some(e => e.moment_type === 'missing_alternative_verification')
  }
];

function bumpCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

export function rebuildPatternThreads(db: Database): PatternThread[] {
  const now = nowIso();
  const threads: PatternThread[] = [];

  for (const def of DEFS) {
    const call_ids: string[] = [];
    const evidence_ids: string[] = [];
    const caller_request_counts: Record<string, number> = {};
    const main_issue_counts: Record<string, number> = {};
    const workflow_nodes: string[] = [];
    let last_seen = '';

    for (const call of db.calls) {
      const ev = db.evidence.filter(e => e.call_id === call.id);
      if (!def.match(call, ev)) continue;
      call_ids.push(call.id);
      evidence_ids.push(...ev.map(e => e.id));
      bumpCount(caller_request_counts, call.anliegen);
      if (call.primary_issue_label) bumpCount(main_issue_counts, call.primary_issue_label);
      if (call.workflow_node) workflow_nodes.push(call.workflow_node);
      if (!last_seen || call.date > last_seen) last_seen = call.date;
    }

    if (call_ids.length === 0) continue;

    const confidence: PatternThread['confidence'] =
      call_ids.length >= 4 ? 'high' : call_ids.length >= 2 ? 'medium' : 'low';

    threads.push({
      id: `pattern_${def.key}`,
      title: def.title,
      kind: def.kind,
      description: def.description,
      caller_request_counts,
      main_issue_counts,
      recurring_phrases: def.phrases || [],
      workflow_nodes: [...new Set(workflow_nodes)].slice(0, 5),
      call_ids: [...new Set(call_ids)],
      evidence_ids: [...new Set(evidence_ids)].slice(0, 20),
      last_seen: last_seen || now.slice(0, 10),
      confidence,
      suggested_fix: def.suggested_fix,
      created_at: now,
      updated_at: now
    });
  }

  for (const call of db.calls) {
    const key = call.anliegen;
    const existing = threads.find(t => t.id === `pattern_intent_${key}`);
    const count = db.calls.filter(c => c.anliegen === key).length;
    if (count < 2) continue;
    if (existing) continue;
    threads.push({
      id: `pattern_intent_${key}`,
      title: `Recurring caller intent: ${callerRequestLabels[key]}`,
      kind: 'caller_intent',
      description: `${count} reviewed calls with caller request "${callerRequestLabels[key]}".`,
      caller_request_counts: { [key]: count },
      main_issue_counts: {},
      recurring_phrases: [],
      workflow_nodes: [],
      call_ids: db.calls.filter(c => c.anliegen === key).map(c => c.id),
      evidence_ids: [],
      last_seen: call.date,
      confidence: count >= 5 ? 'high' : 'medium',
      suggested_fix: 'Review workflow completion rate for this intent.',
      created_at: now,
      updated_at: now
    });
  }

  return threads.sort((a, b) => b.call_ids.length - a.call_ids.length);
}

export function topPatternThreads(db: Database, limit = 3) {
  return (db.patternThreads || []).slice(0, limit);
}

export function refreshPatternMemory(db: Database): Database {
  return { ...db, patternThreads: rebuildPatternThreads(db) };
}
