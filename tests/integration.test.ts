import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { createHash,randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { harness,ORIGIN,PASSWORD,SYNC_TOKEN,hash } from './helpers';
let h:Awaited<ReturnType<typeof harness>>;
async function authorisation(write=false){
  const registration=await h.call('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Integration test client',redirect_uris:['https://client.example/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
  expect(registration.status).toBe(201);
  const client=await registration.json() as any;
  const verifier=Array.from(randomBytes(48),b=>b.toString(16).padStart(2,'0')).join(''),challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback',response_type:'code',scope:write?'notes:read notes:write offline_access':'notes:read offline_access',code_challenge:challenge,code_challenge_method:'S256',resource:ORIGIN+'/mcp',state:'state-123'});
  const consent=await h.call('/authorize?'+query),html=await consent.text();
  expect(consent.status).toBe(200);
  const handle=html.match(/name="handle" value="([^"]+)"/)?.[1];expect(handle).toBeTruthy();
  const cookie=consent.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const form=new URLSearchParams({handle:handle!,decision:'approve',password:PASSWORD,...(write?{write:'yes'}:{})});
  const approved=await h.call('/authorize',{method:'POST',headers:{Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),redirect:'manual'});
  expect(approved.status).toBe(302);
  const redirect=new URL(approved.headers.get('Location')!);expect(redirect.searchParams.get('state')).toBe('state-123');
  const tokenBody=new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://client.example/callback',code:redirect.searchParams.get('code')!,code_verifier:verifier,resource:ORIGIN+'/mcp'});
  return {client,tokenBody,cookie,handle:handle!,form};
}
async function token(write=false){
  const auth=await authorisation(write);
  const res=await h.call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:auth.tokenBody.toString()});
  expect(res.status).toBe(200);return {...auth,...await res.json() as any};
}
async function rpc(access:string,method:string,params:any={}){
  const response=await h.call('/mcp',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  return {response,body:await response.json() as any};
}
describe('Cloudflare workerd, D1, KV, OAuth and MCP integration',()=>{
  beforeAll(async()=>{
    h=await harness();
    h.update('Days/2026-10-04.md','---\ntags: [food]\ndate: 2026-10-04\n---\n# Supper\nWe ate lemon chicken for supper. [[People/Kourosh]]');
    h.update('People/Kourosh.md','---\naliases: [K]\n---\n# Kourosh\nFirst installation test.');
    h.update('Private/Secret.md','Never expose this private folder.');
    h.update('.obsidian/token.md','Never expose application settings.');
  });
  afterAll(async()=>{await h?.close();});
  it('fails closed on every private entry point and rejects query-string keys',async()=>{
    for(const path of ['/api/notes','/api/status','/api/note?path=People/Kourosh.md','/mcp','/mcp?apiKey='+SYNC_TOKEN]){const r=await h.call(path);expect(r.status,path).toBe(401);expect(await r.text()).not.toContain('lemon chicken');}
    expect((await h.call('/sse')).status).toBe(404);expect((await h.call('/messages')).status).toBe(404);
    expect((await h.call('/mcp',{headers:{Authorization:`Bearer ${SYNC_TOKEN}`}})).status).toBe(401);
  });
  it('publishes correct OAuth discovery and challenges',async()=>{
    const response=await h.call('/mcp');expect(response.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
    const metadataUrl=response.headers.get('WWW-Authenticate')!.match(/resource_metadata="([^"]+)"/)![1];
    const protectedResource=await (await h.call(new URL(metadataUrl).pathname)).json() as any;expect(protectedResource.resource).toBe(ORIGIN+'/mcp');
    const metadata=await (await h.call('/.well-known/oauth-authorization-server')).json() as any;expect(metadata.code_challenge_methods_supported).toContain('S256');expect(metadata.client_id_metadata_document_supported).toBe(true);
  });
  it('indexes only eligible Markdown and resolves graph links',async()=>{
    const result=await h.sync();expect(result.complete).toBe(true);expect(result.indexed_notes).toBe(2);
    const rows=await h.db.prepare('SELECT path FROM notes').all();expect(rows.results).toHaveLength(2);
    const links=await h.db.prepare('SELECT * FROM links').all();expect(links.results).toContainEqual({source:'Days/2026-10-04.md',target:'People/Kourosh.md'});
    const second=await h.sync();expect(second.processed).toBe(0);
  });
  it('performs hybrid retrieval with citations, date and tag filters',async()=>{
    const response=await h.api('/api/search','POST',{query:'evening meal',tag:'food',date_from:'2026-10-01',date_to:'2026-10-31'}),data=await response.json() as any;
    expect(response.status).toBe(200);expect(data.results[0].id).toBe('Days/2026-10-04.md');expect(data.results[0].matched_by).toContain('semantic');expect(data.results[0].url).toContain('/blob/');expect(data.results[0].obsidian_url).toContain('obsidian://open');
    const invalid=await h.api('/api/search','POST',{query:'food',date_from:'2026-02-30'});expect(invalid.status).toBe(400);
  });
  it('uses lexical fallback during an embedding outage and reports it',async()=>{
    await (h.bindings.AI as any).setFailure(true);
    const data=await (await h.api('/api/search','POST',{query:'lemon chicken'})).json() as any;
    expect(data.semantic).toBe('unavailable');expect(data.results[0].text).toContain('lemon chicken');
    await (h.bindings.AI as any).setFailure(false);
  });
  it('refuses public repositories, truncated inventories, symlinks and excluded paths',async()=>{
    h.private(false);expect((await h.api('/api/notes')).status).toBe(403);h.private(true);
    h.truncate(true);expect((await h.api('/api/notes')).status).toBe(413);h.truncate(false);
    expect((await h.api('/api/note?path=Link.md')).status).toBe(404);
    for(const path of ['Private/Secret.md','.obsidian/token.md','../token.md'])expect((await h.api('/api/note?path='+encodeURIComponent(path))).status).toBeGreaterThanOrEqual(400);
  });
  it('completes OAuth PKCE, scopes the token and rejects reused codes',async()=>{
    const read=await token();expect(read.access_token).toBeTruthy();expect(read.refresh_token).toBeTruthy();
    const listed=await rpc(read.access_token,'tools/list');expect(listed.response.status).toBe(200);expect(listed.body.result.tools.map((t:any)=>t.name)).not.toContain('write_note');
    const attempt=await rpc(read.access_token,'tools/call',{name:'write_note',arguments:{path:'oops.md',content:'oops',expected_sha:null}});expect(attempt.body.error||attempt.body.result?.isError).toBeTruthy();expect(h.notes.has('oops.md')).toBe(false);
    const unauthorised=await h.api('/api/note','PUT',{path:'a.md',content:'x'});expect(unauthorised.status).toBe(400);
    const replay=await h.call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:read.tokenBody.toString()});expect(replay.status).toBe(400);
    expect((await rpc(read.access_token,'tools/list')).response.status).toBe(401);
  });
  it('rejects a wrong PKCE verifier and browserless consent replay',async()=>{
    const auth=await authorisation();auth.tokenBody.set('code_verifier','wrong'.repeat(12));
    const bad=await h.call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:auth.tokenBody.toString()});expect(bad.status).toBe(400);
    const csrf=await h.call('/authorize',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/x-www-form-urlencoded'},body:auth.form.toString()});expect(csrf.status).toBe(400);
    const wrongOrigin=await h.call('/authorize',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'},body:auth.form.toString()});expect(wrongOrigin.status).toBe(403);
  });
  it('connects using the official MCP client and retrieves source notes',async()=>{
    const read=await token();const client=new Client({name:'integration',version:'1.0.0'});
    const transport=new StreamableHTTPClientTransport(new URL(ORIGIN+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${read.access_token}`}},fetch:((input:any,init:any)=>h.mf.dispatchFetch(input.toString(),init)) as any});
    await client.connect(transport);
    const tools=await client.listTools();expect(tools.tools.some(t=>t.name==='search')).toBe(true);
    const result=await client.callTool({name:'search',arguments:{query:'lemon chicken'}});expect(result.isError).not.toBe(true);
    const fetched=await client.callTool({name:'fetch',arguments:{id:'Days/2026-10-04.md'}});expect((fetched.content as any)[0].text).toContain('lemon chicken');
    await client.close();
  });
  it('writes with OAuth consent, rejects stale revisions and deletes safely',async()=>{
    const write=await token(true);
    const created=await rpc(write.access_token,'tools/call',{name:'write_note',arguments:{path:'Test.md',content:'# Test\nCreated through MCP',expected_sha:null}});expect(created.body.result?.isError).not.toBe(true);expect(h.notes.get('Test.md')).toContain('Created through MCP');
    const sha=hash(h.notes.get('Test.md')!);h.update('Test.md','newer device edit');
    const conflict=await rpc(write.access_token,'tools/call',{name:'write_note',arguments:{path:'Test.md',content:'overwrite',expected_sha:sha}});expect(conflict.body.result.isError).toBe(true);expect(h.notes.get('Test.md')).toBe('newer device edit');
    const removed=await rpc(write.access_token,'tools/call',{name:'delete_note',arguments:{path:'Test.md',expected_sha:hash('newer device edit')}});expect(removed.body.result?.isError).not.toBe(true);expect(h.notes.has('Test.md')).toBe(false);
  });
  it('hides superseded revisions on index failure and recovers',async()=>{
    h.update('People/Kourosh.md','---\ntags: [\n---\nBad frontmatter');
    const report=await h.sync();expect(report.complete).toBe(false);
    const active=await h.db.prepare('SELECT active FROM notes WHERE path=?').bind('People/Kourosh.md').first<any>();expect(active.active).toBe(0);
    h.update('People/Kourosh.md','# Kourosh\nRecovered note.');expect((await h.sync()).complete).toBe(true);
    const errors=await h.db.prepare('SELECT * FROM index_errors').all();expect(errors.results).toEqual([]);
  });
  it('removes deleted notes and stale vectors from search results',async()=>{
    h.notes.delete('Days/2026-10-04.md');await h.sync();
    const data=await (await h.api('/api/search','POST',{query:'lemon chicken'})).json() as any;
    expect(data.results.some((r:any)=>r.id==='Days/2026-10-04.md')).toBe(false);
  });
  it('rejects filenames that collide across desktop and mobile filesystems',async()=>{
    h.update('Case.md','one');h.update('case.md','two');
    try {expect((await h.api('/api/notes')).status).toBe(409);}finally{h.notes.delete('Case.md');h.notes.delete('case.md');}
  });
  it('processes multiple batches without a malformed note starving the queue',async()=>{
    h.update('000-bad.md','---\ninvalid: [\n---\ntext');
    for(let i=0;i<20;i++)h.update(`Batch/note-${String(i).padStart(2,'0')}.md`,`# Batch ${i}\nDistinct test sentence ${i}`);
    let report:any;for(let i=0;i<4;i++)report=await h.sync();
    expect(report.remaining).toBe(1);expect(report.continue).toBe(false);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE active=1 AND path LIKE 'Batch/%'").first<any>()).n).toBe(20);
    h.notes.delete('000-bad.md');expect((await h.sync()).complete).toBe(true);
    expect((await h.db.prepare('SELECT * FROM index_errors').all()).results).toEqual([]);
  });
  it('serialises simultaneous refresh requests',async()=>{
    h.update('Concurrent.md','# Concurrent\nA new note.');
    const reports=await Promise.all([h.sync(),h.sync()]);expect(reports.reduce((n:number,r:any)=>n+r.processed,0)).toBe(1);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE path='Concurrent.md'").first<any>()).n).toBe(1);
  });
  it('rejects an OAuth token exchange for the wrong resource',async()=>{
    const auth=await authorisation();auth.tokenBody.set('resource','https://different.example/mcp');
    const response=await h.call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:auth.tokenBody.toString()});expect(response.status).toBe(400);
  });
  it('refreshes an OAuth connection and keeps its read scope',async()=>{
    const initial=await token();
    const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:initial.refresh_token,client_id:initial.client.client_id,resource:ORIGIN+'/mcp'});
    const response=await h.call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});expect(response.status).toBe(200);
    const refreshed=await response.json() as any;const tools=await rpc(refreshed.access_token,'tools/list');expect(tools.response.status).toBe(200);expect(tools.body.result.tools.some((t:any)=>t.name==='write_note')).toBe(false);
  });
  it('rate-limits repeated registration attempts',async()=>{
    let response:any;for(let i=0;i<21;i++)response=await h.call('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.23'},body:'{}'});
    expect(response.status).toBe(429);
  });
  it('rejects hostile origins, oversized requests and unconfigured hosts',async()=>{
    expect((await h.call('/api/notes',{headers:{Origin:'https://evil.example',Authorization:`Bearer ${SYNC_TOKEN}`}})).status).toBe(403);
    expect((await h.call('/api/search',{method:'POST',body:'x'.repeat(540000)})).status).toBe(413);
    expect((await h.mf.dispatchFetch('https://wrong.example/mcp')).status).toBe(421);
  });
});
