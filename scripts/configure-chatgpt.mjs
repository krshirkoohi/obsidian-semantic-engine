import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { zipSync,strToU8 } from 'fflate';
export function serverOrigin(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use the HTTPS Worker origin, with no path or credentials.');
  return u.origin;
}
export async function configureChatGPT(value,out='artifacts/chatgpt-plugin') {
  const origin=serverOrigin(value),manifest=JSON.parse(await readFile('integrations/chatgpt/plugin.json','utf8'));
  const mcp={$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{'obsidian-semantic-engine':{type:'streamable-http',url:origin+'/mcp'}}};
  await mkdir(out,{recursive:true});
  const files={'plugin.json':JSON.stringify(manifest,null,2)+'\n','mcp.json':JSON.stringify(mcp,null,2)+'\n','README.md':`Connect to ${origin}/mcp using OAuth. Enter the owner connection password on your Worker consent page. This package contains no credentials. See the repository's docs/CHATGPT.md for ChatGPT registration and installation.\n`};
  for(const [name,content] of Object.entries(files))await writeFile(out+'/'+name,content);
  await writeFile(out+'.zip',zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,strToU8(value)]))));
  return {origin,mcpUrl:origin+'/mcp',directory:out};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv[2])throw new Error('Usage: npm run configure:chatgpt -- https://your-worker.workers.dev');
  console.log(await configureChatGPT(process.argv[2]));
}
