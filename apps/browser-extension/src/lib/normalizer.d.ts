export type Snapshot = {
  title: string;
  platform: string;
  metadata: { url: string; captured_at: string };
  messages: { role: string; content: string }[];
};
export function normalizedConversation(provider: string, messages: { role: string; content: string }[], title: string, url: string): Snapshot;
export function contentHash(conversation: Snapshot): Promise<string>;
