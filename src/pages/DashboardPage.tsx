import { useState } from 'react';
import type { Database } from '../services/storageService';
import { activeIssues, highSeverity, requestCounts, evidenceForIssue, lastSeenForIssue } from '../utils/metrics';
import { anliegenLabels } from '../utils/anliegen';
import { fmtDate } from '../utils/dates';
import { Badge } from '../components/ui/Badge';
import { AskAiPanel } from '../components/ask-ai/AskAiPanel';
import { setIssueStatus } from '../services/issuesService';

export function DashboardPage({ db, setDb, openIssue }: { db: Database; setDb: (db: Database) => void; openIssue: (id: string) => void }) {
  const [ask, setAsk] = useState(false);
  const issues = activeIssues(db.issues);
  const focus = issues.find(i => i.severity === 'high') || issues[0];
  const counts = requestCounts(db.calls);
  return <main className="page">
    <div className="page-head"><div><h1>Dashboard</h1><p>Issue and evidence-first QA operations.</p></div><button className="primary" onClick={() => setAsk(!ask)}>Ask AI</button></div>
    {ask && <AskAiPanel db={db} setDb={setDb} />}
    <div className="cards"><div className="stat"><span>Active issues</span><strong>{issues.length}</strong></div><div className="stat"><span>Calls reviewed</span><strong>{db.calls.length}</strong></div><div className="stat"><span>High severity</span><strong>{highSeverity(db.issues, db.evidence)}</strong></div><div className="stat"><span>Experiments running</span><strong>{db.experiments.filter(e => e.result === 'inconclusive').length}</strong></div></div>
    {focus && <section className="panel focus"><div><h2>Current Focus</h2><h3>{focus.title}</h3><p>{focus.description}</p><p><b>Next step:</b> {focus.suggested_fix}</p><p><b>Success signal:</b> fewer linked high-severity evidence moments in new calls.</p></div><div className="stack"><button onClick={() => setDb(setIssueStatus(db, focus.id, 'testing'))}>Mark testing</button><button onClick={() => setDb(setIssueStatus(db, focus.id, 'resolved'))}>Resolve</button><button>+ Experiment</button><button onClick={() => setAsk(true)}>Ask AI</button></div></section>}
    <section className="grid two"><div className="panel"><h2>Top caller requests</h2>{counts.map(c => <div className="bar" key={c.key}><span>{anliegenLabels[c.key]}</span><div><i style={{ width: Math.max(8, c.count * 34) }} /></div><b>{c.count}</b></div>)}</div><div className="panel"><h2>Recent Evidence</h2>{db.evidence.slice(0, 3).map(e => <div className="mini" key={e.id}><Badge tone={e.severity === 'high' ? 'red' : 'yellow'}>{e.moment_type}</Badge><strong>{db.calls.find(c => c.id === e.call_id)?.call_id}</strong><p>{e.explanation}</p></div>)}</div></section>
    <section className="panel"><div className="row between"><h2>Active Problems</h2><button>Show all</button></div><div className="issue-grid">{issues.slice(0, 3).map(i => <article className="issue-card" key={i.id}><div className="row between"><h3>{i.title}</h3><Badge tone={i.severity === 'high' ? 'red' : i.severity === 'medium' ? 'yellow' : 'neutral'}>{i.severity}</Badge></div><p>{i.description}</p><div className="meta"><span>{i.linked_call_ids.length} affected calls</span><span>{evidenceForIssue(db.evidence, i.id).length} moments</span><span>Last seen {fmtDate(lastSeenForIssue(i, db.calls))}</span></div><p><b>Action:</b> {i.suggested_fix}</p><div className="row wrap"><button onClick={() => openIssue(i.id)}>View</button><button onClick={() => setDb(setIssueStatus(db, i.id, 'testing'))}>Mark testing</button><button onClick={() => setDb(setIssueStatus(db, i.id, 'resolved'))}>Resolve</button><button>Experiment</button><button>Notes</button></div></article>)}</div></section>
    <section className="panel"><h2>Experiments</h2>{db.experiments.map(e => <div className="list-row" key={e.id}><strong>{e.experiment_name}</strong><span>{e.changed_setting}</span><Badge tone="blue">{e.result}</Badge></div>)}</section>
  </main>;
}
