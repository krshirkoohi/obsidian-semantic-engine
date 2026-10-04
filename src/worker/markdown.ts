import { parseDocument } from 'yaml';
import { digest, notePath } from '../shared';
export interface ParsedNote {
  title: string; properties: Record<string, unknown>; tags: string[]; aliases: string[];
  date: string | null; dateSource: string | null;
  links: string[]; chunks: { id: string; heading: string; content: string; lineStart: number; lineEnd: number }[];
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value ? value : null;
}
export async function parseNote(path: string, sha: string, text: string): Promise<ParsedNote> {
  notePath(path);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let properties: Record<string, unknown> = {}, start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((s, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(s));
    if (end > 0) {
      const doc = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true });
      if (doc.errors.length) throw new Error('Invalid YAML frontmatter.');
      const value = doc.toJS({ maxAliasCount: 30 });
      if (value && typeof value === 'object' && !Array.isArray(value)) properties = value;
      start = end + 1;
    }
  }
  const base = path.split('/').pop()!.replace(/\.md$/i, '');
  const title = typeof properties.title === 'string' ? properties.title : (lines.slice(start).find(l => /^#\s+/.test(l))?.replace(/^#\s+/, '') || base);
  const date = validDate(properties.date) || validDate(base);
  const dateSource = validDate(properties.date) ? 'frontmatter.date' : date ? 'filename' : null;
  const tags = new Set(strings(properties.tags).flatMap(x => x.split(/[\s,]+/)).map(x => x.replace(/^#/, '')).filter(Boolean));
  const links = new Set<string>();
  const chunks: ParsedNote['chunks'] = [];
  let heading = title, buffer: string[] = [], lineStart = start + 1, inCode = false, fence = '';
  async function flush(end: number) {
    const content = buffer.join('\n').trim();
    if (content) chunks.push({ id: await digest(`${path}\0${sha}\0${chunks.length}`), heading, content, lineStart, lineEnd: end });
    buffer = []; lineStart = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const mark = line.match(/^\s*(`{3,}|~{3,})/);
    if (mark) { if (!inCode) { inCode = true; fence = mark[1][0]; } else if (mark[1][0] === fence) inCode = false; }
    if (!inCode && !mark) {
      if (/^#{1,6}\s+/.test(line)) { await flush(i); heading = line.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, ''); }
      const scan = line.replace(/`[^`]*`/g, '');
      for (const m of scan.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) links.add(m[1].split('#')[0]);
      for (const m of scan.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        try { const link = decodeURIComponent(m[1]); if (!/^[a-z][a-z\d+.-]*:/i.test(link)) links.add(link.split('#')[0]); } catch { /* Invalid URL escapes are plain text. */ }
      }
      for (const m of scan.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(m[1]);
    }
    // Bound every embedding input, including exceptionally long source lines.
    for (let j = 0; j < Math.max(1, line.length); j += 1200) {
      const part = line.slice(j, j + 1200);
      if (buffer.join('\n').length + part.length > 1200) await flush(i + 1);
      if (!buffer.length) lineStart = i + 1;
      buffer.push(part);
    }
  }
  await flush(lines.length);
  if (!chunks.length) chunks.push({ id: await digest(`${path}\0${sha}\0${0}`), heading: title, content: title, lineStart: 1, lineEnd: lines.length });
  return { title, properties, tags: [...tags], aliases: strings(properties.aliases), date, dateSource, links: [...links].filter(Boolean), chunks };
}
export function resolveLink(source: string, link: string, paths: Set<string>, aliases: Map<string, string[]>): string | null {
  const target = link.replace(/\.md$/i, '');
  const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const parts: string[] = [];
  for (const part of (dir + target).split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  const relative = parts.join('/') + '.md';
  if (paths.has(relative)) return relative;
  if (paths.has(target + '.md')) return target + '.md';
  const matches = [...paths].filter(p => p.replace(/\.md$/i, '').split('/').pop() === target);
  if (matches.length === 1) return matches[0];
  const alias = aliases.get(target) || [];
  return matches.length === 0 && alias.length === 1 ? alias[0] : null;
}
