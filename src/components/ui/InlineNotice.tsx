export function InlineNotice({
  message,
  tone = 'error',
  onDismiss
}: {
  message: string;
  tone?: 'error' | 'info';
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <p className={tone === 'error' ? 'error inline-notice' : 'muted inline-notice'}>
      {message}
      {onDismiss && (
        <button type="button" className="btn-text" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </p>
  );
}
