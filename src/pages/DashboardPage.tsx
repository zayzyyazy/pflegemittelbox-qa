import { useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import { activeIssues, highSeverity, requestCounts } from '../utils/metrics';
import { anliegenLabels } from '../utils/anliegen';
import { fmtDate } from '../utils/dates';
import { Badge } from '../components/ui/Badge';
import { topPatternThreads } from '../services/patternMemoryService';
import { shortCallId } from '../utils/text';
import { PinnedCallsStrip } from '../components/calls/PinnedCallsStrip';
import { callWorkspace } from '../utils/workspace';
import { rankCallsByUrgency, type CatastropheLevel } from '../utils/callUrgency';
import { CallerRequestTag } from '../components/calls/CallerRequestTag';
import { ResultPill } from '../components/calls/ResultPill';
import { LeapingImportButton, LeapingImportNotice, useLeapingImport } from '../components/calls/LeapingImportBar';

function catastropheTone(level: CatastropheLevel): 'red' | 'yellow' | 'blue' | 'neutral' {
  if (level === 'critical') return 'red';
  if (level === 'high') return 'yellow';
  if (level === 'medium') return 'blue';
  return 'neutral';
}

function miniQueueCard({
  label,
  count,
  tone,
  onClick
}: {
  label: string;
  count: number;
  tone?: 'red' | 'yellow' | 'blue' | 'green';
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`queue-card ${tone || ''}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

export function DashboardPage({
  db,
  setDb,
  openInbox,
  openIssue,
  openCall
}: {
  db: Database;
  setDb: (db: Database) => void;
  openInbox: () => void;
  openIssue: (id: string) => void;
  openCall: (id: string, evidenceId?: string) => void;
}) {
  const leaping = useLeapingImport(db, setDb);
  const issues = activeIssues(db.issues);
  const productionCalls = db.calls.filter(c => callWorkspace(c) === 'production');
  const counts = requestCounts(productionCalls);
  const patterns = topPatternThreads(db, 3);
  const pinnedCalls = productionCalls.filter(c => c.pinned);
  const drafts = db.drafts || [];
  const processing = drafts.filter(d => d.status === 'queued' || d.status === 'processing');
  const failed = drafts.filter(d => d.status === 'failed');
  const ready = drafts.filter(d => d.status === 'ready');

  const urgentCalls = useMemo(
    () => rankCallsByUrgency(productionCalls, db.evidence, 10),
    [productionCalls, db.evidence]
  );
  const criticalCount = urgentCalls.filter(u => u.catastrophe === 'critical').length;

  return (
    <main className="page dashboard-page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Start here — review the worst calls first, then triage the rest.</p>
        </div>
        <div className="row wrap">
          <LeapingImportButton db={db} importing={leaping.importing} onImport={() => void leaping.runImport()} />
        </div>
      </div>

      <LeapingImportNotice message={leaping.message} lastImportAt={leaping.lastImportAt} />

      <section className="queue-grid">
        {miniQueueCard({ label: 'Review now', count: urgentCalls.length, tone: urgentCalls.length ? 'red' : undefined })}
        {miniQueueCard({ label: 'Critical', count: criticalCount, tone: criticalCount ? 'red' : undefined })}
        {miniQueueCard({ label: 'Ready drafts', count: ready.length, tone: ready.length ? 'yellow' : undefined, onClick: openInbox })}
        {miniQueueCard({ label: 'Failed imports', count: failed.length, tone: failed.length ? 'red' : undefined, onClick: openInbox })}
        {miniQueueCard({ label: 'High issues', count: highSeverity(db.issues, db.evidence), tone: 'yellow' })}
      </section>

      <section className="panel dashboard-priority-panel">
        <div className="row between wrap">
          <div>
            <h2>Suggested calls to review</h2>
            <p className="muted">Ranked by urgency and catastrophe — function failures, auth loops, unnecessary forwards, dropped calls.</p>
          </div>
          <button type="button" className="btn-sm primary-soft" onClick={() => openCall(urgentCalls[0]?.call.id || '')} disabled={!urgentCalls.length}>
            Open top call
          </button>
        </div>

        {urgentCalls.length ? (
          <div className="urgency-list">
            {urgentCalls.map(row => (
              <button type="button" className={`urgency-row urgency-${row.catastrophe}`} key={row.call.id} onClick={() => openCall(row.call.id)}>
                <div className="urgency-main">
                  <div className="row wrap">
                    <strong>{shortCallId(row.call.call_id)}</strong>
                    <Badge tone={catastropheTone(row.catastrophe)}>{row.catastrophe}</Badge>
                    <CallerRequestTag category={row.call.anliegen} />
                    {row.call.marie_main_result ? (
                      <span className="result-pill result-partially">{row.call.marie_main_result.replace(/_/g, ' ')}</span>
                    ) : (
                      <ResultPill status={row.call.solved_status} />
                    )}
                  </div>
                  <p className="urgency-summary">{row.call.primary_issue_label || row.call.call_summary || row.reasons[0]}</p>
                  <p className="muted urgency-action">{row.suggestedAction}</p>
                  {row.reasons.length > 0 && (
                    <ul className="urgency-reasons">
                      {row.reasons.map(reason => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="urgency-meta">
                  <span className="badge yellow">{row.pendingFindings} open</span>
                  {row.highFindings > 0 && <span className="badge red">{row.highFindings} high</span>}
                  <span className="muted">{row.call.date}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Import Leaping calls or audio — urgent items will appear here automatically.</p>
        )}
      </section>

      <section className="grid dashboard-grid">
        <div className="panel">
          <h2>High severity issues</h2>
          {issues.filter(i => i.severity === 'high').slice(0, 5).map(issue => (
            <button type="button" className="issue-mini-row" key={issue.id} onClick={() => openIssue(issue.id)}>
              <strong>{issue.title}</strong>
              <span>{issue.linked_call_ids.length} calls</span>
            </button>
          ))}
          {!issues.some(i => i.severity === 'high') && <p className="muted">No high severity issues.</p>}
        </div>

        <div className="panel">
          <h2>Recurring patterns</h2>
          {patterns.length ? patterns.map(p => (
            <article className="pattern-card" key={p.id}>
              <div className="row between">
                <strong>{p.title}</strong>
                <Badge tone={p.confidence === 'high' ? 'red' : p.confidence === 'medium' ? 'yellow' : 'neutral'}>{p.confidence}</Badge>
              </div>
              <p className="muted">{p.description}</p>
              <p className="meta">{p.call_ids.length} calls · last seen {fmtDate(p.last_seen)}</p>
            </article>
          )) : <p className="muted">Patterns build as you review and link calls.</p>}
        </div>
      </section>

      <section className="grid dashboard-grid">
        <div className="panel">
          <h2>Top caller requests</h2>
          {counts.filter(c => c.count > 0).map(c => (
            <div className="bar" key={c.key}>
              <span>{anliegenLabels[c.key as keyof typeof anliegenLabels]}</span>
              <div><i style={{ width: Math.max(8, c.count * 34) }} /></div>
              <b>{c.count}</b>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Pinned examples</h2>
          <PinnedCallsStrip calls={pinnedCalls} evidence={db.evidence} experiments={db.experiments} onOpen={c => openCall(c.id)} />
          {!pinnedCalls.length && <p className="muted">Pin exemplar calls from review to keep them here.</p>}
        </div>
      </section>

      {(processing.length > 0 || ready.length > 0) && (
        <section className="panel">
          <div className="row between wrap">
            <h2>Inbox pipeline</h2>
            <button type="button" className="btn-sm" onClick={openInbox}>Open Inbox</button>
          </div>
          <p className="muted">{processing.length} processing · {ready.length} ready for review</p>
        </section>
      )}
    </main>
  );
}
