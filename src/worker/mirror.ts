import { GitHubVault } from './github';
import { parseNote, resolveLink } from './markdown';
import type { Env } from './types';
import { MAX_NOTE_BYTES } from '../shared';
const MODEL = '@cf/baai/bge-small-en-v1.5';
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const result = await env.AI.run(MODEL, { text: texts }) as { data: number[][] };
  if (!Array.isArray(result?.data) || result.data.length !== texts.length || result.data.some(v => v.length !== 384 || v.some(x => !Number.isFinite(x)))) throw new Error('Embedding service returned an invalid shape.');
  return result.data;
}
async function state(env: Env, key: string, value: unknown) {
  await env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(key, JSON.stringify(value)).run();
}
async function retire(env: Env, path: string, remove: boolean) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO vector_gc(id) SELECT id FROM chunks WHERE path=?').bind(path),
    env.DB.prepare('DELETE FROM chunks WHERE path=?').bind(path),
    env.DB.prepare('DELETE FROM raw_links WHERE source=?').bind(path),
    env.DB.prepare('DELETE FROM links WHERE source=? OR target=?').bind(path, path),
    env.DB.prepare(remove ? 'DELETE FROM notes WHERE path=?' : 'UPDATE notes SET active=0 WHERE path=?').bind(path),
    env.DB.prepare('DELETE FROM index_errors WHERE path=?').bind(path),
  ]);
}
async function indexNote(env: Env, path: string, sha: string, commit: string, content: string) {
  const parsed = await parseNote(path, sha, content);
  // Each model input is bounded below the 512-token model context for ordinary prose.
  // Unusually dense text can still be token-truncated by the model; full text stays in D1.
  for (let i = 0; i < parsed.chunks.length; i += 20) {
    const part = parsed.chunks.slice(i, i + 20);
    const metadata = JSON.stringify({tags:parsed.tags,aliases:parsed.aliases,properties:parsed.properties}).slice(0,200);
    const vectors = await embed(env, part.map(c => `${parsed.title.slice(0, 80)}\n${c.heading.slice(0, 80)}\n${metadata}\n${c.content}`));
    await env.VECTORIZE.upsert(part.map((c, j) => ({ id: c.id, values: vectors[j] })));
  }
  const queries = [
    env.DB.prepare('INSERT OR IGNORE INTO vector_gc(id) SELECT id FROM chunks WHERE path=?').bind(path),
    env.DB.prepare('DELETE FROM chunks WHERE path=?').bind(path),
    env.DB.prepare(`INSERT OR REPLACE INTO notes(path,sha,source_commit,title,content,properties,tags,aliases,date,date_source,indexed_at,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(path, sha, commit, parsed.title, content, JSON.stringify(parsed.properties), JSON.stringify(parsed.tags), JSON.stringify(parsed.aliases), parsed.date, parsed.dateSource, new Date().toISOString()),
    ...parsed.chunks.map(c => env.DB.prepare('INSERT INTO chunks(id,path,heading,content,line_start,line_end) VALUES(?,?,?,?,?,?)').bind(c.id, path, c.heading, c.content, c.lineStart, c.lineEnd)),
    env.DB.prepare('DELETE FROM raw_links WHERE source=?').bind(path),
    ...parsed.links.map(target => env.DB.prepare('INSERT OR IGNORE INTO raw_links(source,target) VALUES (?,?)').bind(path, target)),
    env.DB.prepare('DELETE FROM index_errors WHERE path=?').bind(path),
    // A retried version can have the same chunk ids as the previous version.
    ...parsed.chunks.map(c => env.DB.prepare('DELETE FROM vector_gc WHERE id=?').bind(c.id)),
  ];
  await env.DB.batch(queries);
}
async function collectGarbage(env: Env) {
  const ids = await env.DB.prepare('SELECT id FROM vector_gc LIMIT 1000').all<{id: string}>();
  if (!ids.results.length) return;
  await env.VECTORIZE.deleteByIds(ids.results.map(x => x.id));
  await env.DB.batch(ids.results.map(x => env.DB.prepare('DELETE FROM vector_gc WHERE id=?').bind(x.id)));
}
async function rebuildLinks(env: Env) {
  const notes = await env.DB.prepare('SELECT path,aliases FROM notes WHERE active=1').all<{path: string; aliases: string}>();
  const paths = new Set(notes.results.map(n => n.path)), aliases = new Map<string, string[]>();
  for (const n of notes.results) for (const a of JSON.parse(n.aliases) as string[]) aliases.set(a, [...(aliases.get(a) || []), n.path]);
  const raw = await env.DB.prepare('SELECT source,target FROM raw_links').all<{source: string; target: string}>();
  const queries = [env.DB.prepare('DELETE FROM links')];
  for (const link of raw.results) {
    const target = resolveLink(link.source, link.target, paths, aliases);
    if (paths.has(link.source) && target) queries.push(env.DB.prepare('INSERT OR IGNORE INTO links(source,target) VALUES(?,?)').bind(link.source, target));
  }
  await env.DB.batch(queries);
}
export async function syncMirror(env: Env) {
  const started = Date.now();
  const vault = new GitHubVault(env), snapshot = await vault.list();
  const old = await env.DB.prepare('SELECT path,sha,active FROM notes').all<{path: string; sha: string; active: number}>();
  const oldMap = new Map(old.results.map(n => [n.path, n]));
  const current = new Set(snapshot.notes.map(n => n.path));
  for (const note of old.results) if (!current.has(note.path)) await retire(env, note.path, true);
  const pending = snapshot.notes.filter(n => oldMap.get(n.path)?.sha !== n.sha || !oldMap.get(n.path)?.active);
  // Hide superseded content as soon as its GitHub revision is known.
  for (const note of pending) if (oldMap.get(note.path)?.active) await env.DB.prepare('UPDATE notes SET active=0 WHERE path=?').bind(note.path).run();
  const errors = await env.DB.prepare('SELECT path,attempted_at FROM index_errors').all<{path: string; attempted_at: string}>();
  const errorMap = new Map(errors.results.map(e => [e.path, e.attempted_at]));
  for (const error of errors.results) if (!current.has(error.path)) await env.DB.prepare('DELETE FROM index_errors WHERE path=?').bind(error.path).run();
  pending.sort((a,b) => (errorMap.get(a.path) || '').localeCompare(errorMap.get(b.path) || ''));
  let processed = 0, failed = 0;
  for (const note of pending.slice(0, 8)) {
    if (Date.now() - started > 20000) break;
    try {
      if((note.size || 0)>MAX_NOTE_BYTES)throw new Error('Note is too large.');
      const content = await vault.blob(note.sha);
      await indexNote(env, note.path, note.sha, snapshot.commit, content);
      processed++;
    } catch {
      failed++;
      await env.DB.prepare('INSERT OR REPLACE INTO index_errors(path,sha,error,attempted_at) VALUES(?,?,?,?)').bind(note.path, note.sha, 'Could not index this revision. Check note size/YAML and Cloudflare AI/Vectorize bindings.', new Date().toISOString()).run();
    }
  }
  await rebuildLinks(env);
  let gcPending = false;
  try { await collectGarbage(env); } catch { gcPending = true; }
  const remaining = pending.length - processed;
  const report = { source_commit: snapshot.commit, source_notes: snapshot.notes.length, indexed_notes: snapshot.notes.length - remaining, remaining, failed_this_batch: failed, processed, last_attempt: new Date().toISOString(), gc_pending: gcPending, complete: remaining === 0 };
  await state(env, 'sync', report);
  if (!remaining) await state(env, 'last_complete', { commit: snapshot.commit, at: new Date().toISOString() });
  await env.DB.prepare("DELETE FROM state WHERE key='last_error'").run();
  return { ...report, continue: pending.length > processed + failed };
}
export async function mirrorStatus(env: Env) {
  const rows = await env.DB.prepare('SELECT key,value FROM state').all<{key: string; value: string}>();
  const errors = await env.DB.prepare('SELECT path,error,attempted_at FROM index_errors ORDER BY attempted_at DESC LIMIT 20').all();
  return { ...Object.fromEntries(rows.results.map(r => [r.key, JSON.parse(r.value)])), errors: errors.results, vector_consistency: 'eventual', freshness_note: 'Search reflects the indexed snapshot. Use get_note for the current GitHub revision.' };
}
export class MirrorCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private ctx: DurableObjectState, private env: Env) {}
  private run() {
    const task = this.tail.then(async () => {
      try {
        const result = await syncMirror(this.env);
        if (result.continue) await this.ctx.storage.setAlarm(Date.now() + 30000);
        return result;
      } catch {
        await state(this.env, 'last_error', { at: new Date().toISOString(), message: 'Mirror refresh failed. Check GitHub access and Cloudflare bindings.' });
        throw new Error('Mirror refresh failed.');
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async fetch() { try { return Response.json(await this.run()); } catch { return Response.json({ error: 'Mirror refresh failed.' }, { status: 503 }); } }
  async alarm() { await this.run(); }
}
