import { useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { activeIssues, highSeverity, requestCounts } from '../utils/metrics';
import { anliegenLabels } from '../utils/anliegen';
import { fmtDate } from '../utils/dates';
import { Badge } from '../components/ui/Badge';
import { AskAiPanel } from '../components/ask-ai/AskAiPanel';
import { topPatternThreads } from '../services/patternMemoryService';
import { shortCallId } from '../utils/text';
import { PinnedCallsStrip } from '../components/calls/PinnedCallsStrip';
import { callWorkspace } from '../utils/workspace';
import {
  addPersonalNote,
  addPersonalTask,
  updatePersonalTask
} from '../services/personalWorkspaceService';

function reviewCandidateCount(call: CallReview, evidence: EvidenceMoment[]) {
  return call.review_object?.dashboard_signals.unresolved_candidate_count ||
    evidence.filter(e => e.call_id === call.id && e.reviewer_status === 'pending').length;
}

function reviewHighCount(call: CallReview, evidence: EvidenceMoment[]) {
  return call.review_object?.dashboard_signals.high_severity_count ||
    evidence.filter(e => e.call_id === call.id && e.severity === 'high' && e.reviewer_status !== 'dismissed').length;
}

function findOpenFindings(db: Database) {
  return db.calls
    .map(call => ({
      call,
      candidates: reviewCandidateCount(call, db.evidence),
      high: reviewHighCount(call, db.evidence)
    }))
    .filter(row => row.candidates > 0 || row.high > 0)
    .sort((a, b) => b.high - a.high || b.candidates - a.candidates);
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
  const [ask, setAsk] = useState(true);
  const [taskText, setTaskText] = useState('');
  const [noteText, setNoteText] = useState('');

  const issues = activeIssues(db.issues);
  const productionCalls = db.calls.filter(c => callWorkspace(c) === 'production');
  const counts = requestCounts(productionCalls);
  const patterns = topPatternThreads(db, 3);
  const pinnedCalls = productionCalls.filter(c => c.pinned);
  const pinnedIssues = issues.filter(i => i.status === 'testing' || i.severity === 'high').slice(0, 4);
  const drafts = db.drafts || [];
  const processing = drafts.filter(d => d.status === 'queued' || d.status === 'processing');
  const failed = drafts.filter(d => d.status === 'failed');
  const ready = drafts.filter(d => d.status === 'ready');
  const recentlyReviewed = [...productionCalls]
    .filter(c => c.review_status === 'reviewed' || c.review_status === 'flagged')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 5);

  const findingRows = useMemo(() => findOpenFindings(db).slice(0, 6), [db]);
  const openFindingCount = findingRows.reduce((sum, row) => sum + row.candidates + row.high, 0);
  const topTrendTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const call of db.calls) {
      for (const tag of call.review_object?.dashboard_signals.trend_tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    for (const ev of db.evidence) counts.set(ev.moment_type, (counts.get(ev.moment_type) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [db.calls, db.evidence]);

  function addTask() {
    setDb(addPersonalTask(db, taskText));
    setTaskText('');
  }

  function addNote() {
    setDb(addPersonalNote(db, noteText));
    setNoteText('');
  }

  return (
    <main className="page dashboard-page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>QA command center — queues, findings, pinned work, reminders, and project-wide AI.</p>
        </div>
        <button type="button" className="primary" onClick={() => setAsk(!ask)}>
          {ask ? 'Hide Ask AI' : 'Ask AI'}
        </button>
      </div>

      <section className="queue-grid">
        {miniQueueCard({ label: 'Processing', count: processing.length, tone: 'blue', onClick: openInbox })}
        {miniQueueCard({ label: 'Failed imports', count: failed.length, tone: failed.length ? 'red' : undefined, onClick: openInbox })}
        {miniQueueCard({ label: 'Ready for review', count: ready.length, tone: ready.length ? 'yellow' : undefined, onClick: openInbox })}
        {miniQueueCard({ label: 'High severity', count: highSeverity(db.issues, db.evidence), tone: 'red' })}
        {miniQueueCard({ label: 'Open findings', count: openFindingCount, tone: 'yellow' })}
      </section>

      {ask && <AskAiPanel db={db} setDb={setDb} />}

      <section className="grid dashboard-grid">
        <div className="panel dashboard-panel-large">
          <div className="row between wrap">
            <h2>Calls awaiting attention</h2>
            <button type="button" className="btn-sm" onClick={openInbox}>Open Inbox</button>
          </div>
          {findingRows.length ? (
            <div className="attention-list">
              {findingRows.map(({ call, candidates, high }) => (
                <button type="button" className="attention-row" key={call.id} onClick={() => openCall(call.id)}>
                  <div>
                    <strong>{shortCallId(call.call_id)}</strong>
                    <p>{call.call_summary || call.original_intent_summary || 'No summary yet.'}</p>
                  </div>
                  <span className="badge yellow">{candidates} candidates</span>
                  {high > 0 && <span className="badge red">{high} high</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No unresolved review candidates yet. Import or re-score calls to populate this.</p>
          )}
        </div>

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
      </section>

      <section className="grid dashboard-grid">
        <div className="panel">
          <h2>Trends over time</h2>
          {topTrendTags.length ? topTrendTags.map(([tag, count]) => (
            <div className="bar" key={tag}>
              <span>{tag.replace(/_/g, ' ')}</span>
              <div><i style={{ width: Math.max(8, count * 28) }} /></div>
              <b>{count}</b>
            </div>
          )) : <p className="muted">Trend tags appear as review objects and evidence accumulate.</p>}
        </div>

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
      </section>

      <section className="grid dashboard-grid">
        <div className="panel">
          <h2>Recently reviewed</h2>
          {recentlyReviewed.length ? recentlyReviewed.map(call => (
            <button type="button" className="recent-call-row" key={call.id} onClick={() => openCall(call.id)}>
              <strong>{shortCallId(call.call_id)}</strong>
              <span>{fmtDate(call.updated_at)}</span>
              <span>{call.primary_issue_label || call.solved_status}</span>
            </button>
          )) : <p className="muted">Reviewed calls will appear here.</p>}
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
          )) : <p className="muted">Re-analyze calls to build pattern threads.</p>}
        </div>
      </section>

      <section className="panel personal-workspace">
        <div className="row between wrap">
          <div>
            <h2>Personal workspace</h2>
            <p className="muted">Pinned calls, pinned issues, notes, and natural-language reminders.</p>
          </div>
        </div>

        <div className="grid dashboard-grid">
          <div>
            <h3>Pinned calls</h3>
            <PinnedCallsStrip calls={pinnedCalls} evidence={db.evidence} experiments={db.experiments} onOpen={c => openCall(c.id)} />
          </div>
          <div>
            <h3>Pinned issues</h3>
            {pinnedIssues.map(issue => (
              <button type="button" className="issue-mini-row" key={issue.id} onClick={() => openIssue(issue.id)}>
                <strong>{issue.title}</strong>
                <Badge tone={issue.severity === 'high' ? 'red' : 'yellow'}>{issue.status}</Badge>
              </button>
            ))}
            {!pinnedIssues.length && <p className="muted">Mark issues high/testing to keep them here.</p>}
          </div>
        </div>

        <div className="grid dashboard-grid">
          <div className="personal-input-block">
            <h3>Smart reminders</h3>
            <div className="row">
              <input
                value={taskText}
                onChange={e => setTaskText(e.target.value)}
                placeholder="Check Marie's cancellation calls this week"
                onKeyDown={e => {
                  if (e.key === 'Enter') addTask();
                }}
              />
              <button type="button" className="primary" onClick={addTask}>Add</button>
            </div>
            <div className="task-list">
              {(db.personalTasks || []).filter(t => t.status === 'open').slice(0, 6).map(task => (
                <article className="task-row" key={task.id}>
                  <button type="button" className="btn-sm" onClick={() => setDb(updatePersonalTask(db, task.id, { status: 'done' }))}>Done</button>
                  <div>
                    <strong>{task.normalized_title}</strong>
                    <p className="muted">
                      {[task.priority, task.due_hint, ...task.topic_tags].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </article>
              ))}
              {!(db.personalTasks || []).some(t => t.status === 'open') && <p className="muted">No open reminders.</p>}
            </div>
          </div>

          <div className="personal-input-block">
            <h3>Notes to myself</h3>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Capture a QA thought, investigation note, or dashboard idea..."
            />
            <button type="button" onClick={addNote}>Save note</button>
            <div className="notes-list">
              {(db.personalNotes || []).slice(0, 4).map(note => (
                <article className="note-row" key={note.id}>
                  <p>{note.text}</p>
                  <span className="muted">{fmtDate(note.created_at)}</span>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
