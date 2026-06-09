import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import type { Experiment } from '../../types/Experiment';
import { shortCallId } from '../../utils/text';
import { deriveMainIssue } from '../../utils/issueLabels';
import { ResultPill } from './ResultPill';

export function PinnedCallsStrip({
  calls,
  evidence,
  experiments = [],
  onOpen
}: {
  calls: CallReview[];
  evidence: EvidenceMoment[];
  experiments?: Experiment[];
  onOpen: (call: CallReview) => void;
}) {
  const pinned = calls.filter(c => c.pinned || c.critical);
  if (!pinned.length) return null;

  return (
    <section className="panel pinned-strip">
      <h2>Pinned Calls</h2>
      <div className="compact-card-grid">
        {pinned.map(c => {
          const ev = evidence.filter(e => e.call_id === c.id);
          const mainIssue = deriveMainIssue(c, ev);
          const experiment = c.pin_experiment_id
            ? experiments.find(e => e.id === c.pin_experiment_id)
            : undefined;
          return (
            <article className="compact-call-card pinned-card" key={c.id}>
              <div className="row between">
                <strong>{shortCallId(c.call_id)}</strong>
                <div className="row wrap">
                  {c.bot_version && <span className="badge neutral">{c.bot_version}</span>}
                  {c.critical && <span className="badge red">critical</span>}
                </div>
              </div>
              <p className="clamp-cell">{mainIssue}</p>
              <ResultPill status={c.solved_status} />
              {(c.conversational_quality != null || c.operational_reliability != null) && (
                <p className="muted meta">
                  Conv {c.conversational_quality ?? '—'}/10 · Ops {c.operational_reliability ?? '—'}/10
                </p>
              )}
              {c.pin_note && <p className="muted clamp-cell"><b>Why pinned:</b> {c.pin_note}</p>}
              {experiment && <p className="muted meta">Experiment: {experiment.experiment_name}</p>}
              <button type="button" className="btn-sm primary-soft" onClick={() => onOpen(c)}>
                Open
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
