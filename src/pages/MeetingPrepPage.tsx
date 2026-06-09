import { useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import { secondsToClock } from '../utils/dates';
import { downloadText, shortCallId } from '../utils/text';
import { Badge } from '../components/ui/Badge';
import { callerRequestLabels } from '../utils/anliegen';
import { groupCalls } from '../utils/callGrouping';
import { deriveMainIssue } from '../utils/issueLabels';

type Tab = 'groups' | 'issues' | 'pinned' | 'highlights' | 'unresolved';

export function MeetingPrepPage({ db }: { db: Database }) {
  const [tab, setTab] = useState<Tab>('groups');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [selectedCalls, setSelectedCalls] = useState<string[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);

  const groups = useMemo(() => groupCalls(db.calls, db.evidence), [db.calls, db.evidence]);
  const pinnedCalls = db.calls.filter(c => c.pinned);
  const unresolved = db.calls.filter(c => c.solved_status === 'no');
  const reviewerHighlights = db.evidence.filter(e => e.source === 'manual' || e.moment_type === 'manual_highlight');

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const summary = useMemo(() => {
    const groupItems = groups.filter(g => selectedGroups.includes(g.key));
    const issues = db.issues.filter(i => selectedIssues.includes(i.id));
    const calls = db.calls.filter(c => selectedCalls.includes(c.id));
    const evidence = db.evidence.filter(e => selectedEvidence.includes(e.id));

    if (!groupItems.length && !issues.length && !calls.length && !evidence.length) {
      return 'Select issue groups, pinned calls, reviewer highlights, or unresolved calls to build a meeting summary.';
    }

    const blocks: string[] = ['# Meeting prep summary', ''];

    if (groupItems.length) {
      blocks.push('## Top issue groups');
      for (const g of groupItems) {
        blocks.push(`### ${g.title} (${g.calls.length} calls)`);
        g.calls.slice(0, 5).forEach(c => {
          const ev = db.evidence.filter(e => e.call_id === c.id);
          blocks.push(`- ${shortCallId(c.call_id)} · ${c.solved_status} · ${deriveMainIssue(c, ev)}`);
        });
        blocks.push('');
      }
    }

    if (issues.length) {
      blocks.push('## Selected issues');
      for (const i of issues) {
        const linkedCalls = db.calls.filter(c => i.linked_call_ids.includes(c.id));
        blocks.push(`### ${i.title}`);
        blocks.push(`- Affected calls: ${linkedCalls.length}`);
        blocks.push(`- Suggested fix: ${i.suggested_fix}`);
        blocks.push('');
      }
    }

    if (calls.length) {
      blocks.push('## Selected calls');
      for (const c of calls) {
        const ev = db.evidence.filter(e => e.call_id === c.id);
        blocks.push(`### ${shortCallId(c.call_id)} · ${callerRequestLabels[c.anliegen]} · ${c.solved_status}`);
        blocks.push(`- ${c.call_summary || '—'}`);
        ev.filter(e => e.source === 'manual').slice(0, 2).forEach(e => {
          blocks.push(`  - Reviewer highlight: "${e.quote_or_transcript_excerpt.slice(0, 100)}"`);
        });
        blocks.push('');
      }
    }

    if (evidence.length) {
      blocks.push('## Reviewer highlights');
      for (const e of evidence) {
        const c = db.calls.find(x => x.id === e.call_id);
        blocks.push(`- ${c ? shortCallId(c.call_id) : e.call_id} @ ${secondsToClock(e.timestamp_start_seconds)}`);
        blocks.push(`  "${e.quote_or_transcript_excerpt}"`);
        if (e.reviewer_label) blocks.push(`  Label: ${e.reviewer_label}`);
        blocks.push(`  Why: ${e.explanation}`);
      }
    }

    blocks.push('', '## Suggested workflow changes');
    blocks.push('- Review top groups above and pick 1–2 experiments for next sprint.');
    blocks.push('- Use pinned calls and reviewer highlights as demo evidence in the meeting.');

    return blocks.join('\n');
  }, [db, selectedGroups, selectedIssues, selectedCalls, selectedEvidence, groups]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Meeting Prep</h1>
          <p>Pick issue groups, pinned calls, and reviewer highlights — not a giant flat list.</p>
        </div>
        <div className="row">
          <button type="button" onClick={() => navigator.clipboard.writeText(summary)}>Copy summary</button>
          <button type="button" onClick={() => downloadText('meeting-summary.md', summary)}>Export markdown</button>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>Issue groups</button>
        <button type="button" className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>Issues</button>
        <button type="button" className={tab === 'pinned' ? 'active' : ''} onClick={() => setTab('pinned')}>Pinned calls</button>
        <button type="button" className={tab === 'highlights' ? 'active' : ''} onClick={() => setTab('highlights')}>Reviewer highlights</button>
        <button type="button" className={tab === 'unresolved' ? 'active' : ''} onClick={() => setTab('unresolved')}>Unresolved</button>
      </div>

      {tab === 'groups' && (
        <section className="panel select-list">
          {groups.map(g => (
            <label className="select-row" key={g.key}>
              <input type="checkbox" checked={selectedGroups.includes(g.key)} onChange={() => toggle(selectedGroups, g.key, setSelectedGroups)} />
              <div>
                <strong>{g.title}</strong>
                <p className="muted">{g.calls.length} calls · newest {g.calls[0]?.date || '—'}</p>
              </div>
            </label>
          ))}
        </section>
      )}

      {tab === 'issues' && (
        <section className="panel select-list">
          {db.issues.map(i => (
            <label className="select-row" key={i.id}>
              <input type="checkbox" checked={selectedIssues.includes(i.id)} onChange={() => toggle(selectedIssues, i.id, setSelectedIssues)} />
              <div>
                <strong>{i.title}</strong>
                <p className="muted">{i.linked_call_ids.length} calls · {i.severity}</p>
              </div>
            </label>
          ))}
        </section>
      )}

      {tab === 'pinned' && (
        <section className="panel select-list">
          {pinnedCalls.map(c => (
            <label className="select-row" key={c.id}>
              <input type="checkbox" checked={selectedCalls.includes(c.id)} onChange={() => toggle(selectedCalls, c.id, setSelectedCalls)} />
              <div>
                <strong>{shortCallId(c.call_id)}</strong>
                <p className="muted">{callerRequestLabels[c.anliegen]} · {c.solved_status}</p>
              </div>
            </label>
          ))}
          {!pinnedCalls.length && <p className="muted">No pinned calls.</p>}
        </section>
      )}

      {tab === 'unresolved' && (
        <section className="panel select-list">
          {unresolved.map(c => (
            <label className="select-row" key={c.id}>
              <input type="checkbox" checked={selectedCalls.includes(c.id)} onChange={() => toggle(selectedCalls, c.id, setSelectedCalls)} />
              <div>
                <strong>{shortCallId(c.call_id)}</strong>
                <p className="muted">{callerRequestLabels[c.anliegen]} · {c.date}</p>
              </div>
            </label>
          ))}
        </section>
      )}

      {tab === 'highlights' && (
        <section className="panel select-list">
          {reviewerHighlights.map(e => {
            const c = db.calls.find(x => x.id === e.call_id);
            return (
              <label className="select-row" key={e.id}>
                <input type="checkbox" checked={selectedEvidence.includes(e.id)} onChange={() => toggle(selectedEvidence, e.id, setSelectedEvidence)} />
                <div>
                  <Badge tone="blue">Reviewer highlight</Badge>
                  <strong>{c ? shortCallId(c.call_id) : e.call_id}</strong>
                  <p className="clamp-cell">{e.quote_or_transcript_excerpt}</p>
                </div>
              </label>
            );
          })}
        </section>
      )}

      <section className="panel meeting-summary">
        <h2>Summary preview</h2>
        <pre className="summary-pre">{summary}</pre>
      </section>
    </main>
  );
}
