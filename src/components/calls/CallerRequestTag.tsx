import type { AnliegenCategory } from '../../types/CallReview';
import { callerRequestLabels, callerRequestTone } from '../../utils/anliegen';

export function CallerRequestTag({ category }: { category: AnliegenCategory }) {
  const tone = callerRequestTone[category] || 'slate';
  return <span className={`request-tag request-tag-${tone}`}>{callerRequestLabels[category] || category}</span>;
}
