export type PersonalTaskStatus = 'open' | 'done' | 'dismissed';
export type PersonalTaskPriority = 'low' | 'medium' | 'high';

export interface PersonalTask {
  id: string;
  text: string;
  normalized_title: string;
  priority: PersonalTaskPriority;
  status: PersonalTaskStatus;
  topic_tags: string[];
  due_hint?: string;
  source: 'manual' | 'llm_assisted';
  created_at: string;
  updated_at: string;
}
