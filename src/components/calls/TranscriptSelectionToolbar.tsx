export function TranscriptSelectionToolbar({
  quote,
  lineCount,
  onCreateEvidence,
  onClear
}: {
  quote: string;
  lineCount: number;
  onCreateEvidence: () => void;
  onClear: () => void;
}) {
  return (
    <div className="selection-toolbar">
      <p className="selection-toolbar-label">
        {lineCount > 1 ? `${lineCount} lines` : '1 line'}:{' '}
        <em>"{quote.slice(0, 80)}{quote.length > 80 ? '…' : ''}"</em>
      </p>
      <div className="row wrap">
        <button type="button" className="btn-sm primary-soft" onClick={onCreateEvidence}>
          Create evidence
        </button>
        <button type="button" className="btn-sm" onClick={onClear}>
          Deselect
        </button>
      </div>
    </div>
  );
}
