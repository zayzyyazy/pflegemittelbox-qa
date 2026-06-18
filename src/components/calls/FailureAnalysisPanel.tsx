import { useState } from 'react';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { buildOperationalFailures, primaryOperationalFailure } from '../../utils/operationalFailures';

function tone(severity: 'high' | 'medium' | 'low') {
  if (severity === 'high') return 'red';
  if (severity === 'medium') return 'yellow';
  return 'neutral';
}

export function FailureAnalysisPanel({
  call,
  evidence = []
}: {
  call: Partial<CallReview>;
  evidence?: EvidenceMoment[];
}) {
  const [expanded, setExpanded] = useState(false);
  const failures = buildOperationalFailures(call);
  const primary = primaryOperationalFailure(call);
  const confirmed = evidence.filter(e => e.reviewer_status === 'confirmed' && e.source === 'manual');
  const isClean = !primary;

  return (
    <section className={`failure-analysis-panel trace-${isClean ? 'green' : tone(primary?.severity || 'medium')}`}>
      <div className="failure-analysis-head">
        <div>
          <h2>{isClean ? 'Marie outcome' : 'What went wrong'}</h2>
          <p className="muted failure-analysis-sub">
            {isClean
              ? 'No workflow issue detected — auth, tickets, and promised actions look consistent.'
              : 'Top workflow issue only. Phone lookup misses and low-level function noise are hidden.'}
          </p>
        </div>
        {!isClean && primary && (
          <span className={`badge ${tone(primary.severity)}`}>{primary.label}</span>
        )}
      </div>

      {isClean ? (
        <p className="failure-analysis-lead">No repeated auth, missing verification, or ticket/transfer gap detected.</p>
      ) : primary ? (
        <>
          <article className={`ops-failure-card severity-${primary.severity}`}>
            <div className="row between wrap">
              <strong>{primary.label}</strong>
              <span className={`badge ${tone(primary.severity)}`}>{primary.severity}</span>
            </div>
            <p>{primary.detail}</p>
            {primary.fix && <p className="muted ops-failure-fix"><b>Check:</b> {primary.fix}</p>}
          </article>
          {failures.length > 1 && (
            <details className="failure-analysis-details" open={expanded} onToggle={e => setExpanded((e.target as HTMLDetailsElement).open)}>
              <summary>{failures.length - 1} more check{failures.length > 2 ? 's' : ''}</summary>
              <div className="ops-failure-list">
                {failures.slice(1).map(f => (
                  <article className={`ops-failure-card severity-${f.severity}`} key={f.kind}>
                    <div className="row between wrap">
                      <strong>{f.label}</strong>
                      <span className={`badge ${tone(f.severity)}`}>{f.severity}</span>
                    </div>
                    <p>{f.detail}</p>
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      ) : null}

      {!!confirmed.length && (
        <div className="trace-flags">
          {confirmed.map(ev => (
            <span className="ops-flag confirmed" key={ev.id}>{ev.moment_type?.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}
    </section>
  );
}
