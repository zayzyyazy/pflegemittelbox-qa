import type { CallReview } from '../../types/CallReview';

export function ResultPill({ status }: { status: CallReview['solved_status'] }) {
  return <span className={`result-pill result-${status}`}>{status}</span>;
}
