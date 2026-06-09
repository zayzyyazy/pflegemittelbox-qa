import type { Database } from './storageService';
import type { Issue } from '../types/Issue';
import type { PatternThread } from '../types/PatternThread';
import { callerRequestLabels } from '../utils/anliegen';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';
import { refreshPatternMemory } from './patternMemoryService';

function anliegenList(pattern: PatternThread) {
  return Object.keys(pattern.caller_request_counts || {})
    .map(k => callerRequestLabels[k as keyof typeof callerRequestLabels] || k)
    .filter(Boolean);
}

export function syncIssuesFromPatterns(db: Database): Database {
  const patterns = db.patternThreads || [];
  const now = nowIso();
  let issues = [...db.issues];

  for (const pattern of patterns) {
    if (pattern.kind === 'caller_intent' || pattern.call_ids.length < 2) continue;

    const existing = issues.find(i => i.pattern_thread_id === pattern.id);
    const severity: Issue['severity'] =
      pattern.confidence === 'high' ? 'high' : pattern.confidence === 'medium' ? 'medium' : 'low';
    const topEvidence = pattern.evidence_ids.slice(0, 8);
    const linkedEvidence = db.evidence.filter(e => topEvidence.includes(e.id));

    const issue: Issue = {
      id: existing?.id || id('issue'),
      title: pattern.title,
      category: pattern.kind,
      severity,
      status: existing?.status || 'active',
      description: `${pattern.description} (${pattern.call_ids.length} calls).`,
      suggested_fix: pattern.suggested_fix,
      notes: existing?.notes || `Auto-synced from pattern thread ${pattern.id}.`,
      linked_call_ids: pattern.call_ids,
      linked_evidence_ids: linkedEvidence.map(e => e.id),
      affected_anliegen: anliegenList(pattern),
      pattern_thread_id: pattern.id,
      confidence: pattern.confidence,
      experiment_id: existing?.experiment_id,
      created_at: existing?.created_at || now,
      updated_at: now,
      resolved_at: existing?.resolved_at
    };

    if (existing) {
      issues = issues.map(i => (i.id === existing.id ? issue : i));
    } else if (!issues.some(i => i.title === pattern.title)) {
      issues = [issue, ...issues];
    }

  }

  let evidence = db.evidence;
  for (const issue of issues) {
    if (!issue.pattern_thread_id || !issue.linked_evidence_ids?.length) continue;
    const set = new Set(issue.linked_evidence_ids);
    evidence = evidence.map(e =>
      set.has(e.id) && !e.issue_id ? { ...e, issue_id: issue.id } : e
    );
  }

  return { ...db, issues, evidence };
}

export function finalizeDatabaseState(db: Database): Database {
  return syncIssuesFromPatterns(refreshPatternMemory(db));
}
