import { safeStringify } from '../../utils/safeJson';

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  if (value == null) return '';
  return typeof value === 'string' ? value : safeStringify(value);
}

export function LeapingTranscriptEvents({ events }: { events?: unknown[] }) {
  const rows = Array.isArray(events) ? events.slice(0, 200) : [];
  if (!rows.length) return null;

  return (
    <div className="leaping-events">
      <div className="row between wrap">
        <strong>Leaping transcript events</strong>
        {events && events.length > rows.length && (
          <span className="muted">Showing first {rows.length} of {events.length}</span>
        )}
      </div>
      {rows.map((raw, index) => {
        const ev = asObj(raw);
        const type = text(ev.type) || 'unknown';
        const key = `${type}-${index}`;
        if (type === 'message' || type === 'chat_message') {
          return (
            <article className="leaping-event" key={key}>
              <span className="badge blue">{text(ev.sender) || 'message'}</span>
              <p>{text(ev.text) || '(empty message)'}</p>
            </article>
          );
        }
        if (type === 'function_call_request') {
          return (
            <article className="leaping-event" key={key}>
              <span className="badge yellow">function request</span>
              <strong>{text(ev.name) || 'unknown function'}</strong>
              <details>
                <summary>Arguments</summary>
                <pre className="debug-json">{safeStringify(ev.args || {})}</pre>
              </details>
            </article>
          );
        }
        if (type === 'function') {
          return (
            <article className="leaping-event" key={key}>
              <span className={ev.error ? 'badge red' : 'badge green'}>{ev.error ? 'function error' : 'function result'}</span>
              <strong>{text(ev.name) || 'unknown function'}</strong>
              <details>
                <summary>{ev.error ? 'Error' : 'Returned'}</summary>
                <pre className="debug-json">{safeStringify(ev.error || ev.returned || null)}</pre>
              </details>
            </article>
          );
        }
        if (type === 'field_update') {
          return (
            <article className="leaping-event" key={key}>
              <span className="badge neutral">field update</span>
              <p><strong>{text(ev.field)}</strong>: {text(ev.old_value)} {'->'} {text(ev.new_value)}</p>
            </article>
          );
        }
        if (type === 'transition') {
          return (
            <article className="leaping-event" key={key}>
              <span className="badge blue">transition</span>
              <p>{text(ev.name) || 'node'} {'->'} {text(ev.to_name) || text(ev.to) || 'unknown'}</p>
            </article>
          );
        }
        if (type === 'start' || type === 'end') {
          return (
            <article className="leaping-event" key={key}>
              <span className="badge neutral">{type}</span>
              {ev.summary != null && <p>{text(ev.summary)}</p>}
              <details>
                <summary>Fields</summary>
                <pre className="debug-json">{safeStringify(ev.fields || {})}</pre>
              </details>
            </article>
          );
        }
        return (
          <article className="leaping-event" key={key}>
            <span className="badge neutral">{type}</span>
            <details>
              <summary>Event JSON</summary>
              <pre className="debug-json">{safeStringify(ev)}</pre>
            </details>
          </article>
        );
      })}
    </div>
  );
}
