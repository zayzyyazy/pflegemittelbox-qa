import type { Database } from '../../services/storageService';
import { inboxPipelineMetrics } from '../../utils/pipelineMetrics';

export function InboxPipelineBar({ db }: { db: Database }) {
  const m = inboxPipelineMetrics(db);
  const parts = [
    m.processing ? `${m.processing} processing` : null,
    m.ready ? `${m.ready} ready` : null,
    m.failed ? `${m.failed} failed` : null,
    m.savedToday ? `${m.savedToday} saved today` : null
  ].filter(Boolean);

  if (!parts.length) return null;

  return (
    <div className="pipeline-bar panel">
      <span className="pipeline-label">Inbox</span>
      {parts.map((p, i) => (
        <span className={`pipeline-chip${p?.includes('failed') ? ' pipeline-chip-warn' : ''}`} key={i}>{p}</span>
      ))}
    </div>
  );
}
