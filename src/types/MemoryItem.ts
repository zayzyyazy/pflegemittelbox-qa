export type MemoryScope = 'project' | 'issue' | 'call' | 'experiment';
export type MemorySource = 'manual' | 'auto_from_call' | 'auto_from_issue' | 'auto_from_experiment';
export type Importance = 'low' | 'medium' | 'high';
export interface MemoryItem { id: string; scope: MemoryScope; memory_text: string; source: MemorySource; importance: Importance; created_at: string; updated_at: string; }