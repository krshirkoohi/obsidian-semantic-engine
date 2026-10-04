import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile,mkdir } from 'node:fs/promises';
export const ORIGIN='https://engine.example',SYNC_TOKEN='sync-test-'.repeat(8),PASSWORD='owner-test-'.repeat(8);
export const hash=(s:string)=>createHash('sha1').update(s).digest('hex');
export async function harness() {
  await mkdir('dist',{recursive:true});
  await build({entryPoints:['src/worker/index.ts'],outfile:'dist/test-worker.mjs',bundle:true,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*'],conditions:['workerd','worker','browser']});
  const notes=new Map<string,string>(),blobs=new Map<string,string>();let commit=0,isPrivate=true,truncated=false;
  const update=(path:string,content:string)=>{notes.set(path,content);blobs.set(hash(content),content);commit++;};
  const outbound=async(req:Request)=>{
    const url=new URL(req.url),root='/repos/test/private-vault',path=url.pathname.slice(root.length);
    if(url.hostname!=='api.github.com'||!url.pathname.startsWith(root))return Response.json({error:'Unexpected test egress'},{status:500});
    if(req.headers.get('Authorization')!=='Bearer test-github-token')return Response.json({error:'unauthorised'},{status:401});
    if(path==='')return Response.json({private:isPrivate});
    if(path.startsWith('/commits/'))return Response.json({sha:hash(String(commit)),commit:{tree:{sha:hash('tree'+commit)}}});
    if(path.startsWith('/git/trees/'))return Response.json({truncated,tree:[...notes].map(([path,c])=>({path,sha:hash(c),type:'blob',mode:'100644',size:Buffer.byteLength(c)})).concat([{path:'Link.md',sha:hash('fake symlink'),type:'blob',mode:'120000',size:5}])});
    if(path.startsWith('/git/blobs/')){const c=blobs.get(path.split('/').pop()!);return c===undefined?Response.json({},{status:404}):Response.json({encoding:'base64',content:Buffer.from(c).toString('base64')});}
    if(path.startsWith('/contents/')){
      const p=decodeURIComponent(path.slice('/contents/'.length)),body=await req.json() as any,old=notes.get(p);
      if((old===undefined?undefined:hash(old))!==body.sha)return Response.json({message:'stale'},{status:409});
      if(req.method==='PUT'){const content=Buffer.from(body.content,'base64').toString();update(p,content);return Response.json({content:{sha:hash(content)},commit:{sha:hash(String(commit))}});}
      if(req.method==='DELETE'){notes.delete(p);commit++;return Response.json({commit:{sha:hash(String(commit))}});}
    }
    return Response.json({error:'unknown fixture route'},{status:404});
  };
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
    name:'engine',modules:true,scriptPath:'dist/test-worker.mjs',compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],
    bindings:{PUBLIC_URL:ORIGIN,SYNC_TOKEN,OWNER_PASSWORD:PASSWORD,GITHUB_TOKEN:'test-github-token',GITHUB_REPOSITORY:'test/private-vault',GITHUB_BRANCH:'main',VAULT_NAME:'Test vault',EXCLUDED_PREFIXES:'Private',ENABLE_CHATGPT_WRITES:'true'},
    d1Databases:{DB:'test-db'},kvNamespaces:{OAUTH_KV:'oauth'},durableObjects:{MIRROR:{className:'MirrorCoordinator',useSQLite:true}},
    serviceBindings:{AI:{name:'services',entrypoint:'FakeAI'},VECTORIZE:{name:'services',entrypoint:'FakeVectors'}},outboundService:outbound as any,
  },{name:'services',modules:true,scriptPath:'tests/fixtures/services.mjs',compatibilityDate:'2026-10-01'}]}));
  const db=await mf.getD1Database('DB');
  const schema=await readFile('migrations/0001_initial.sql','utf8');
  // D1 exec requires one SQL statement per line, including triggers.
  await db.exec(schema.replace(/CREATE TRIGGER[\s\S]*?END;/g,s=>s.replace(/\n/g,' ')).replace(/CREATE TABLE[\s\S]*?\);/g,s=>s.replace(/\n/g,' ')));
  const bindings=await mf.getBindings();
  const call=(path:string,init:RequestInit={})=>mf.dispatchFetch(ORIGIN+path,init as any);
  const api=(path:string,method='GET',body?:unknown)=>call(path,{method,headers:{Authorization:`Bearer ${SYNC_TOKEN}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const sync=async()=>{const id=(bindings.MIRROR as any).idFromName('vault');const result=await (bindings.MIRROR as any).get(id).fetch('https://mirror.internal/sync');return result.json();};
  return {mf,db,bindings,notes,update,call,api,sync,private(value:boolean){isPrivate=value;},truncate(value:boolean){truncated=value;},close:()=>mf.dispose()};
}
