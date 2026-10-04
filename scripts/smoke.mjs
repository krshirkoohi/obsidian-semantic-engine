import { readFile } from 'node:fs/promises';
const saved=JSON.parse(await readFile('artifacts/connection.credentials.json','utf8'));
const origin=saved.server,headers={Authorization:`Bearer ${saved.deviceSyncToken}`,'Content-Type':'application/json'};
async function api(path,method='GET',body){const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(`${method} ${path} failed (${response.status}).`);return response.json();}
if((await fetch(origin+'/api/notes')).status!==401)throw new Error('Unauthenticated vault request was not rejected.');
if((await fetch(origin+'/mcp')).status!==401)throw new Error('Unauthenticated MCP request was not rejected.');
console.log('Authentication boundaries passed.');
await api('/api/notes');console.log('Private GitHub repository access passed.');
if(process.argv.includes('--write')){
  const id=crypto.randomUUID(),path=`Semantic Engine Tests/${id}.md`,content=`# Installation test ${id}\nThe silver otter enjoys lemon soup.\n`;
  let sha;
  try{
    ({sha}=await api('/api/note','PUT',{path,content,expected_sha:null}));
    const fetched=await api('/api/note?path='+encodeURIComponent(path));if(fetched.content!==content)throw new Error('GitHub round trip did not preserve content.');
    await api('/api/sync','POST',{});
    let found=false;
    for(let i=0;i<12;i++){
      const result=await api('/api/search','POST',{query:'silver otter lemon soup',path_prefix:'Semantic Engine Tests/',limit:20});
      if(result.results.some(r=>r.id===path)){if(result.semantic!=='available')throw new Error('Lexical search passed, but the embedding service is unavailable.');found=true;break;}
      console.log(`Waiting for the mirror (${i+1}/12)...`);await new Promise(r=>setTimeout(r,5000));
    }
    if(!found)throw new Error('The temporary test note did not appear in the mirror within 60 seconds. Check /api/status.');
    console.log('GitHub create/read and live Cloudflare embedding/search passed.');
  }finally{if(sha){await api('/api/note','DELETE',{path,expected_sha:sha});console.log('Temporary note deleted from the current vault. Its test-only content remains in Git history.');}}
}
console.log('Check complete. OAuth client tests run separately in npm test.');
