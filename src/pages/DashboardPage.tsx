import { useState } from 'react';
import type { Database } from '../services/storageService';
import { activeIssues, highSeverity, requestCounts } from '../utils/metrics';
import { anliegenLabels } from '../utils/anliegen';
import { fmtDate } from '../utils/dates';
import { Badge } from '../components/ui/Badge';
import { AskAiPanel } from '../components/ask-ai/AskAiPanel';
import { setIssueStatus } from '../services/issuesService';
import { topPatternThreads } from '../services/patternMemoryService';
import { shortCallId } from '../utils/text';
import { PinnedCallsStrip } from '../components/calls/PinnedCallsStrip';
import { callWorkspace } from '../utils/workspace';

export function DashboardPage({
  db,
  setDb,
  openIssue,
  openCall
}: {
  db: Database;
  setDb: (db: Database) => void;
  openIssue: (id: string) => void;
  openCall: (id: string, evidenceId?: string) => void;
}) {
  const [ask, setAsk] = useState(false);
  const issues = activeIssues(db.issues);
  const patterns = topPatternThreads(db, 3);
  const focus = issues.find(i => i.pattern_thread_id) || issues.find(i => i.severity === 'high') || issues[0];
  const productionCalls = db.calls.filter(c => callWorkspace(c) === 'production');
  const counts = requestCounts(productionCalls);
  const pinnedCalls = productionCalls.filter(c => c.pinned);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Marie QA overview — pinned examples, patterns, and production call trends.</p>
        </div>
        <button type="button" className="primary" onClick={() => setAsk(!ask)}>Ask AI</button>
      </div>
      {ask && <AskAiPanel db={db} setDb={setDb} />}
      <PinnedCallsStrip
        calls={pinnedCalls}
        evidence={db.evidence}
        experiments={db.experiments}
        onOpen={c => openCall(c.id)}
      />
      <div className="cards">
        <div className="stat"><span>Active issues</span><strong>{issues.length}</strong></div>
        <div className="stat"><span>Production calls</span><strong>{productionCalls.length}</strong></div>
        <div className="stat"><span>Pinned</span><strong>{pinnedCalls.length}</strong></div>
        <div className="stat"><span>High severity</span><strong>{highSeverity(db.issues, db.evidence)}</strong></div>
        <div className="stat"><span>Pattern threads</span><strong>{db.patternThreads?.length || 0}</strong></div>
      </div>
      {focus && (
        <section className="panel focus">
          <div>
            <h2>Current focus</h2>
            <h3>{focus.title}</h3>
            <p>{focus.description}</p>
            <p><b>Next step:</b> {focus.suggested_fix}</p>
          </div>
          <div className="stack">
            <button type="button" onClick={() => openIssue(focus.id)}>View issue</button>
            <button type="button" onClick={() => setDb(setIssueStatus(db, focus.id, 'testing'))}>Mark testing</button>
          </div>
        </section>
      )}
      <section className="grid two">
        <div className="panel">
          <h2>Top recurring patterns</h2>
          {patterns.length ? patterns.map(p => (
            <article className="pattern-card" key={p.id}>
              <div className="row between">
                <strong>{p.title}</strong>
                <Badge tone={p.confidence === 'high' ? 'red' : p.confidence === 'medium' ? 'yellow' : 'neutral'}>{p.confidence}</Badge>
              </div>
              <p className="muted">{p.description}</p>
              <p className="meta">{p.call_ids.length} calls · last seen {fmtDate(p.last_seen)}</p>
              <div className="row wrap">
                {p.call_ids.slice(0, 3).map(cid => {
                  const c = db.calls.find(x => x.id === cid);
                  return c ? (
                    <button type="button" className="btn-sm" key={cid} onClick={() => openCall(c.id)}>
                      {shortCallId(c.call_id)}
                    </button>
                  ) : null;
                })}
              </div>
            </article>
          )) : <p className="muted">Re-analyze calls to build pattern threads.</p>}
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
      <section className="panel">
        <h2>Active problems (from patterns)</h2>
        <div className="issue-grid">
          {issues.filter(i => i.pattern_thread_id).slice(0, 6).map(i => (
            <article className="issue-card" key={i.id}>
              <div className="row between">
                <h3>{i.title}</h3>
                <Badge tone={i.severity === 'high' ? 'red' : i.severity === 'medium' ? 'yellow' : 'neutral'}>{i.severity}</Badge>
              </div>
              <p>{i.description}</p>
              <p className="meta">{i.linked_call_ids.length} calls · {(i.linked_evidence_ids || []).length} evidence moments</p>
              <button type="button" className="btn-sm" onClick={() => openIssue(i.id)}>View</button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
