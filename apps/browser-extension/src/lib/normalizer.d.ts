export type Attachment = { type: "image" | "file"; name: string; url: string };
export type SnapshotMessage = { role: string; content: string; attachments?: Attachment[] };
export type Snapshot = {
  title: string;
  platform: string;
  metadata: { url: string; captured_at: string; provider_project?: string };
  messages: SnapshotMessage[];
};
export function cleanAttachments(value: unknown): Attachment[];
export function chatPath(provider: string, url: string): string | null;
export function providerProjectFromUrl(provider: string, url: string): string;
export function chatTitle(title: string, messages: { role: string; content: string }[]): string;
export function normalizedConversation(
  provider: string,
  messages: { role: string; content: string; attachments?: unknown }[],
  title: string,
  url: string,
  options?: { providerProject?: string },
): Snapshot;
export function withoutAttachments<T>(messages: T[]): T[];
export function contentHash(conversation: Snapshot): Promise<string>;
