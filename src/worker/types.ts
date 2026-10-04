import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  OAUTH_KV: KVNamespace;
  MIRROR: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  GITHUB_BRANCH: string;
  SYNC_TOKEN: string;
  OWNER_PASSWORD: string;
  PUBLIC_URL: string;
  VAULT_NAME: string;
  EXCLUDED_PREFIXES?: string;
  ENABLE_CHATGPT_WRITES?: string;
}
export interface NoteRow {
  path: string; sha: string; title: string; content: string; properties: string;
  tags: string; aliases: string; date: string | null; date_source: string | null; indexed_at: string;
}
export interface ChunkRow { id: string; path: string; heading: string; content: string; line_start: number; line_end: number }
