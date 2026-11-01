export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  preferences: {
    review_required?: boolean;
    sensitive_review?: boolean;
    onboarding_step?: number;
    connection?: string;
    semantic_enabled?: boolean;
  };
  created_at: string;
};
export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  status: string;
  created_at: string;
};
export type Memory = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  content: string;
  category: string;
  confidence: number;
  importance: number;
  sensitivity: string;
  status: string;
  reason: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Conversation = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  platform: string;
  message_count: number;
  processing_status: string;
  created_at: string;
  excluded: boolean;
  source_metadata?: Record<string, unknown>;
};
export type Activity = {
  id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};
export type Version = {
  id: string;
  content: string;
  category: string;
  status: string;
  version: number;
  created_at: string;
};
export type Source = {
  id: string;
  memory_id: string;
  conversation_id: string;
  message_id: string;
  evidence: string;
};
