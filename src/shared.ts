export const MAX_NOTE_BYTES = 256 * 1024;
export const CONFLICT_FOLDER = 'Semantic Engine Conflicts';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function notePath(path: string): string {
  if (!path || path.length > 500 || /[\\\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || !/\.md$/i.test(path)) {
    throw new HttpError(400, 'Use a relative Markdown path.');
  }
  const parts = path.split('/');
  if (parts.some(p => !p || p.startsWith('.') || p.endsWith('.') || p !== p.trim() || /[:*?"<>|]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || parts[0] === CONFLICT_FOLDER || path !== path.normalize('NFC')) {
    throw new HttpError(400, 'Hidden, reserved and unsafe paths are not allowed.');
  }
  return path;
}
export function included(path: string, excluded: string[] = []): boolean {
  try { notePath(path); } catch { return false; }
  return !excluded.some(p => { const clean = p.trim().replace(/\/$/, ''); return clean && (path === clean || path.startsWith(clean + '/')); });
}
export function validateMarkdown(content: string): void {
  if (typeof content !== 'string' || content.includes('\0') || new TextEncoder().encode(content).length > MAX_NOTE_BYTES) {
    throw new HttpError(413, 'Markdown must be UTF-8 text, at most 256 KiB.');
  }
}
export async function digest(text: string, algorithm = 'SHA-256'): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function fromBase64(value: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/\s/g, '')), c => c.charCodeAt(0)));
}
export function endpoint(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) throw new Error('Use the HTTPS Worker origin, without a path or credentials.');
  return u.origin;
}
export interface RemoteNote { path: string; sha: string; size?: number }
export interface NoteContent extends RemoteNote { content: string }
export interface BaseNote { sha: string; hash: string }
