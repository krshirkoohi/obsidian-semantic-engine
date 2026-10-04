import { HttpError, included, notePath, validateMarkdown, fromBase64, toBase64, MAX_NOTE_BYTES, type RemoteNote } from '../shared';
import type { Env } from './types';
type TreeEntry = { path: string; sha: string; type: string; mode: string; size?: number };
export class GitHubVault {
  private root: string;
  readonly excluded: string[];
  constructor(private env: Env) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') || !env.GITHUB_TOKEN || !env.GITHUB_BRANCH) throw new HttpError(503, 'Vault is not configured.');
    this.root = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
    this.excluded = (env.EXCLUDED_PREFIXES || '').split('\n').map(s => s.trim()).filter(Boolean);
  }
  allowed(path: string): string {
    notePath(path);
    if (!included(path, this.excluded)) throw new HttpError(403, 'This path is excluded from the mirror.');
    return path;
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    const res = await fetch(this.root + path, {
      method, headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'obsidian-semantic-engine', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: 'manual',
    });
    if (!res.ok) {
      if ([409, 422].includes(res.status)) throw new HttpError(409, 'The note changed on another device. Refresh before editing.');
      if (res.status === 404) throw new HttpError(404, 'Note or repository not found. Check repository access.');
      if (res.status === 403 || res.status === 429) throw new HttpError(503, 'GitHub rate limit or permission restriction. Retry later.');
      throw new HttpError(502, 'GitHub request failed. Check deployment credentials.');
    }
    return res.json();
  }
  async ensurePrivate(): Promise<void> {
    const repo = await this.request('');
    if (!repo.private) throw new HttpError(403, 'The notes repository must be private.');
  }
  async list(): Promise<{ commit: string; notes: RemoteNote[] }> {
    await this.ensurePrivate();
    const commit = await this.request(`/commits/${encodeURIComponent(this.env.GITHUB_BRANCH)}`);
    const tree = await this.request(`/git/trees/${commit.commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new HttpError(413, 'GitHub returned a truncated tree. Split the vault before syncing.');
    const notes = (tree.tree as TreeEntry[]).filter(x => x.type === 'blob' && ['100644','100755'].includes(x.mode) && included(x.path, this.excluded)).map(x => ({ path: x.path, sha: x.sha, size: x.size }));
    const names = new Set<string>();
    for (const note of notes) {
      const name = note.path.toLowerCase();
      if (names.has(name)) throw new HttpError(409, 'The vault contains filenames that differ only by letter case. Rename them before syncing across devices.');
      names.add(name);
    }
    if (notes.length > 5000) throw new HttpError(413, 'This release supports at most 5,000 Markdown notes per vault.');
    return { commit: commit.sha, notes };
  }
  async blob(sha: string): Promise<string> {
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new HttpError(400, 'Invalid revision.');
    const blob = await this.request(`/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new HttpError(502, 'Unexpected GitHub encoding.');
    const content = fromBase64(blob.content);
    validateMarkdown(content);
    return content;
  }
  async read(path: string) {
    this.allowed(path);
    const snapshot = await this.list();
    const note = snapshot.notes.find(n=>n.path===path);
    if (!note) throw new HttpError(404, 'Note is not an included regular Markdown file.');
    if ((note.size || 0)>MAX_NOTE_BYTES) throw new HttpError(413, 'This note exceeds 256 KiB. Split it before syncing.');
    const content = await this.blob(note.sha);
    return { path, sha: note.sha, content, commit: snapshot.commit };
  }
  async write(path: string, content: string, expectedSha: string | null) {
    this.allowed(path); validateMarkdown(content); await this.ensurePrivate();
    if (expectedSha !== null && !/^[a-f0-9]{40,64}$/.test(expectedSha)) throw new HttpError(400, 'A valid expected revision is required.');
    const result = await this.request(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, 'PUT', {
      message: `Update ${path} via Semantic Engine`, content: toBase64(content), branch: this.env.GITHUB_BRANCH,
      ...(expectedSha ? { sha: expectedSha } : {}),
    });
    return { path, sha: result.content.sha as string, commit: result.commit.sha as string };
  }
  async remove(path: string, expectedSha: string) {
    this.allowed(path); await this.ensurePrivate();
    if (!/^[a-f0-9]{40,64}$/.test(expectedSha)) throw new HttpError(400, 'A valid expected revision is required.');
    const result = await this.request(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, 'DELETE', {
      message: `Delete ${path} via Semantic Engine`, sha: expectedSha, branch: this.env.GITHUB_BRANCH,
    });
    return { path, deleted: true, commit: result.commit.sha as string };
  }
}
