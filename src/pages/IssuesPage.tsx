import { useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import type { Issue } from '../types/Issue';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { setIssueStatus, upsertIssue } from '../services/issuesService';
import { secondsToClock } from '../utils/dates';
import { shortCallId } from '../utils/text';

export function IssuesPage({
  db,
  setDb,
  selectedIssueId,
  clearSelected,
  openCall
}: {
  db: Database;
  setDb: (db: Database) => void;
  selectedIssueId?: string;
  clearSelected: () => void;
  openCall?: (id: string, evidenceId?: string) => void;
}) {
  const [local, setLocal] = useState<Issue | null>(null);
  const selected = selectedIssueId ? db.issues.find(i => i.id === selectedIssueId) || null : local;

  const grouped = useMemo(() => {
    const pattern = db.issues.filter(i => i.pattern_thread_id);
    const manual = db.issues.filter(i => !i.pattern_thread_id);
    return { pattern, manual };
  }, [db.issues]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Issues</h1>
          <p>Recurring operational problems grouped from call patterns.</p>
        </div>
        <button type="button" className="primary" onClick={() => setLocal({ id: '', title: '', category: 'Other', severity: 'medium', status: 'active', description: '', suggested_fix: '', notes: '', linked_call_ids: [], created_at: '', updated_at: '' })}>Add issue</button>
      </div>
      <section className="panel">
        <h2>From pattern memory</h2>
        <div className="issue-grid">
          {grouped.pattern.map(i => (
            <IssueCard key={i.id} issue={i} db={db} onOpen={() => setLocal(i)} />
          ))}
        </div>
      </section>
      {grouped.manual.length > 0 && (
        <section className="panel">
          <h2>Manual issues</h2>
          <div className="issue-grid">
            {grouped.manual.map(i => (
              <IssueCard key={i.id} issue={i} db={db} onOpen={() => setLocal(i)} />
            ))}
          </div>
        </section>
      )}
      {selected && (
        <IssueDetail issue={selected} db={db} setDb={setDb} onClose={() => { setLocal(null); clearSelected(); }} openCall={openCall} />
      )}
    </main>
  );
}

function IssueCard({ issue, db, onOpen }: { issue: Issue; db: Database; onOpen: () => void }) {
  const linkedCalls = db.calls.filter(c => issue.linked_call_ids.includes(c.id));
  const pinnedCount = linkedCalls.filter(c => c.pinned).length;
  const unresolvedCount = linkedCalls.filter(c => c.solved_status === 'no').length;
  const evidence = db.evidence.filter(
    e => e.issue_id === issue.id || issue.linked_evidence_ids?.includes(e.id)
  );
  const latestCall = linkedCalls.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const topEvidence = evidence.slice(0, 2);
  return (
    <article className="issue-card" onClick={onOpen}>
      <div className="row between">
        <h3>{issue.title}</h3>
        <Badge tone={issue.severity === 'high' ? 'red' : issue.severity === 'medium' ? 'yellow' : 'neutral'}>{issue.severity}</Badge>
      </div>
      <Badge tone="blue">{issue.status}</Badge>
      {issue.confidence && <Badge tone="neutral">{issue.confidence} confidence</Badge>}
      <p className="clamp-cell">{issue.description}</p>
      <p className="meta">
        {linkedCalls.length} calls · {pinnedCount} pinned · {unresolvedCount} unresolved · {evidence.length} evidence
        {latestCall ? ` · latest ${latestCall.date}` : ''}
      </p>
      {topEvidence.map(e => (
        <div className="mini" key={e.id}>
          <Badge tone={e.source === 'manual' ? 'blue' : 'yellow'}>
            {e.source === 'manual' ? 'Reviewer highlight' : 'AI suggested'}
          </Badge>
          <span className="muted">{shortCallId(db.calls.find(c => c.id === e.call_id)?.call_id || e.call_id)}</span>
          <p className="clamp-cell">{e.quote_or_transcript_excerpt}</p>
        </div>
      ))}
      <p><b>Fix:</b> {issue.suggested_fix}</p>
      <button type="button" className="btn-sm primary-soft" onClick={e => { e.stopPropagation(); onOpen(); }}>Open issue</button>
    </article>
  );
}

function IssueDetail({
  issue,
  db,
  setDb,
  onClose,
  openCall
}: {
  issue: Issue;
  db: Database;
  setDb: (db: Database) => void;
  onClose: () => void;
  openCall?: (id: string, evidenceId?: string) => void;
}) {
  const [draft, setDraft] = useState(issue);
  const evidence = db.evidence.filter(e => e.issue_id === issue.id || issue.linked_evidence_ids?.includes(e.id));
  const calls = db.calls.filter(c => issue.linked_call_ids.includes(c.id));

  return (
    <Modal title={issue.title || 'Issue detail'} onClose={onClose} wide>
      <div className="detail-grid">
        <section className="form-grid">
          <label className="field"><span>Title</span><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label className="field"><span>Severity</span><select value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value as Issue['severity'] })}><option>low</option><option>medium</option><option>high</option></select></label>
          <label className="field"><span>Status</span><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Issue['status'] })}><option>active</option><option>investigating</option><option>testing</option><option>resolved</option></select></label>
          <label className="field"><span>Description</span><textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className="field"><span>Suggested fix</span><textarea value={draft.suggested_fix} onChange={e => setDraft({ ...draft, suggested_fix: e.target.value })} /></label>
          <button type="button" className="primary" onClick={() => setDb(upsertIssue(db, draft))}>Save issue</button>
        </section>
        <section>
          <h3>Linked calls ({calls.length})</h3>
          {calls.map(c => (
            <div className="mini" key={c.id}>
              <button type="button" className="link-button" onClick={() => openCall?.(c.id)}>{shortCallId(c.call_id)}</button>
              <p>{c.call_summary}</p>
            </div>
          ))}
          <h3>Evidence moments</h3>
          {evidence.map(e => (
            <div className="evidence" key={e.id}>
              <Badge tone={e.severity === 'high' ? 'red' : 'yellow'}>{e.moment_type.replace(/_/g, ' ')}</Badge>
              <b>{secondsToClock(e.timestamp_start_seconds)}</b>
              <blockquote>{e.quote_or_transcript_excerpt}</blockquote>
              <p>{e.explanation}</p>
              {openCall && (
                <button type="button" className="btn-sm" onClick={() => openCall(e.call_id, e.id)}>Open call</button>
              )}
            </div>
          ))}
          <div className="row wrap">
            <button type="button" onClick={() => setDb(setIssueStatus(db, issue.id, 'testing'))}>Mark testing</button>
            <button type="button" onClick={() => setDb(setIssueStatus(db, issue.id, 'resolved'))}>Resolve</button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
