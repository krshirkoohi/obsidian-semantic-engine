import { describe, it, expect } from 'vitest';
import { parseNote, resolveLink, validDate } from '../src/worker/markdown';
import { notePath, included, toBase64, fromBase64, validateMarkdown } from '../src/shared';
describe('Markdown and path boundaries',()=>{
  it('round-trips Unicode and preserves note structure',async()=>{
    const source='---\ntitle: Café\naliases: [Coffee]\ntags: [food, daily]\ndate: 2026-10-04\nstatus: done\n---\n# Supper\nDinner with [[People/Kourosh|K]] and [ideas](../Ideas.md). #cooking\n## Plan\n- [ ] Buy lemons ^task-1';
    const p=await parseNote('Days/2026-10-04.md','a'.repeat(40),source);
    expect(p.title).toBe('Café');expect(p.tags).toContain('cooking');expect(p.aliases).toEqual(['Coffee']);expect(p.properties.status).toBe('done');expect(p.dateSource).toBe('frontmatter.date');expect(p.links).toContain('People/Kourosh');expect(p.chunks[1].lineStart).toBe(10);expect(p.chunks.map(c=>c.content).join('\n')).toContain('^task-1');
    expect(fromBase64(toBase64('中文 👩🏽‍💻 Café'))).toBe('中文 👩🏽‍💻 Café');
  });
  it('ignores links, headings and tags inside code',async()=>{
    const p=await parseNote('Note.md','b'.repeat(40),'# One\n```md\n# Fake\n[[Secret]] #fake\n```\n`[[Inline]]`\n[[Real]] #valid');
    expect(p.links).toEqual(['Real']);expect(p.tags).toEqual(['valid']);expect(p.chunks).toHaveLength(1);
  });
  it('bounds long lines and gives changed versions distinct ids',async()=>{
    const a=await parseNote('a.md','a'.repeat(40),'x'.repeat(10000)),b=await parseNote('a.md','b'.repeat(40),'x'.repeat(10000));
    expect(a.chunks.every(c=>c.content.length<=1200)).toBe(true);expect(a.chunks[0].id).not.toBe(b.chunks[0].id);
  });
  it('does not treat modified time or impossible dates as event dates',async()=>{
    expect(validDate('2026-02-30')).toBeNull();expect(validDate('2024-02-29')).toBe('2024-02-29');
    expect((await parseNote('2026-10-04.md','a'.repeat(40),'note')).dateSource).toBe('filename');
    expect((await parseNote('Note.md','a'.repeat(40),'---\nupdated: 2026-10-04\n---\nnote')).date).toBeNull();
  });
  it('rejects malformed YAML and unsafe or excluded paths',async()=>{
    await expect(parseNote('a.md','a'.repeat(40),'---\na: [\n---\ntext')).rejects.toThrow();
    for(const path of ['../x.md','/x.md','a/../b.md','.obsidian/data.md','a\\b.md','a//b.md','Semantic Engine Conflicts/x.md','a/ b.md','NUL\0.md','notes.txt'])expect(()=>notePath(path)).toThrow();
    expect(included('Private/a.md',['Private'])).toBe(false);expect(included('Privately/a.md',['Private'])).toBe(true);expect(()=>validateMarkdown('x'.repeat(262145))).toThrow();
  });
  it('resolves relative links and unique aliases without guessing ambiguous titles',()=>{
    const paths=new Set(['Folder/A.md','B.md','X/Thing.md','Y/Thing.md']);
    expect(resolveLink('Folder/A.md','../B',paths,new Map())).toBe('B.md');
    expect(resolveLink('Folder/A.md','Thing',paths,new Map())).toBeNull();
    expect(resolveLink('B.md','Alias',paths,new Map([['Alias',['Folder/A.md']]]))).toBe('Folder/A.md');
  });
});
