import type { Database } from '../../services/storageService';
import { estimateStorageKb } from '../../services/storageService';

export function StoragePressureBanner({
  db,
  notesFailed,
  onFreeStorage,
  onClearCalls,
  onOpenSettings,
  onDismiss
}: {
  db: Database;
  notesFailed?: boolean;
  onFreeStorage: () => void;
  onClearCalls: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  const usage = estimateStorageKb();
  const callCount = db.calls.length;
  const draftCount = (db.drafts || []).length;

  return (
    <div className="panel inline-notice storage-pressure-banner" role="alert">
      <div>
        <strong>Storage is full</strong>
        <p className="muted storage-pressure-copy">
          {notesFailed
            ? 'Could not save to the app cache. Free space or clear old calls to continue importing.'
            : `App browser cache ~${usage.totalKb} KB (limit ~5 MB) — not your Mac disk.`}
          {usage.audioKb > 0 && ` Audio cache ~${usage.audioKb} KB.`}
          {callCount > 0 && ` ${callCount} saved call${callCount === 1 ? '' : 's'}`}
          {draftCount > 0 && `, ${draftCount} in inbox`}
          .
        </p>
      </div>
      <div className="row wrap storage-pressure-actions">
        <button type="button" className="primary-soft" onClick={onFreeStorage}>
          Free storage
        </button>
        <button type="button" className="btn-danger-soft" onClick={onClearCalls}>
          Clear all calls
        </button>
        <button type="button" className="btn-sm" onClick={onOpenSettings}>
          Settings
        </button>
        <button type="button" className="btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
