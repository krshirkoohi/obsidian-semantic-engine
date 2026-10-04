import { spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir,rm,chmod } from 'node:fs/promises';
import { createInterface,emitKeypressEvents } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import { configureChatGPT,serverOrigin } from './configure-chatgpt.mjs';
const configFile='wrangler.deploy.json';
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
function wrangler(args) {
  const r=spawnSync(process.execPath,[cli,...args,'--config',configFile],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(r.error||r.status!==0)throw new Error(`Wrangler ${args[0]} failed. Fix the reported error and rerun npm run deploy; created resources are kept.`);
}
async function readJSON(path) {try{return parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function question(label,fallback='') {
  if(!process.stdin.isTTY){if(fallback)return fallback;throw new Error(`${label} is required. Use an interactive terminal or the documented environment variable.`);}
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const value=await new Promise(resolve=>rl.question(label+(fallback?` [${fallback}]`:'')+': ',resolve));rl.close();return value.trim()||fallback;
}
async function secret(label) {
  if(!process.stdin.isTTY)throw new Error(`${label} is required. Set GITHUB_TOKEN in the environment or run in an interactive terminal.`);
  process.stdout.write(label+': ');emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';const finish=()=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const key=(text,k)=>{if(k?.ctrl&&k.name==='c'){finish();reject(new Error('Cancelled.'));}else if(k?.name==='return'){finish();resolve(value);}else if(k?.name==='backspace')value=value.slice(0,-1);else if(text&&!k?.ctrl)value+=text;};
    process.stdin.on('keypress',key);
  });
}
export function makeConfig(base,{name,repository,origin,branch,vaultName}) {
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(name))throw new Error('Worker name must be 2-49 lowercase letters, digits or hyphens.');
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw new Error('Repository must be owner/name.');
  if(!branch||!vaultName)throw new Error('Branch and vault name are required.');
  const config=structuredClone(base);config.name=name;
  config.vars={...config.vars,PUBLIC_URL:serverOrigin(origin),GITHUB_REPOSITORY:repository,GITHUB_BRANCH:branch,VAULT_NAME:vaultName};
  delete config.d1_databases;delete config.kv_namespaces;delete config.vectorize;
  return config;
}
export async function deploy() {
  if(process.argv.includes('--dry-run')) {
    const r=spawnSync(process.execPath,[cli,'deploy','--config','wrangler.jsonc','--dry-run','--outdir','dist/wrangler'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    if(r.status!==0)throw new Error('Deployment dry run failed.');return;
  }
  let config=await readJSON(configFile);
  if(!config){
    const repository=process.env.OSE_REPOSITORY||await question('Private GitHub notes repository (owner/name)');
    const name=process.env.OSE_WORKER_NAME||await question('Unique Cloudflare Worker name','semantic-engine');
    const origin=process.env.OSE_PUBLIC_URL||await question('Worker HTTPS URL (name.account-subdomain.workers.dev)');
    const branch=process.env.OSE_BRANCH||await question('GitHub branch','main');
    const vaultName=process.env.OSE_VAULT_NAME||await question('Obsidian vault name','My Vault');
    config=makeConfig(await readJSON('wrangler.jsonc'),{name,repository,origin,branch,vaultName});
    await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
  }
  const githubToken=process.env.GITHUB_TOKEN||await secret('GitHub fine-grained token (Contents read/write on this private vault only)');
  const headers={Authorization:`Bearer ${githubToken}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'obsidian-semantic-engine-installer'};
  const repo=await fetch(`https://api.github.com/repos/${config.vars.GITHUB_REPOSITORY}`,{headers,redirect:'manual'});
  if(!repo.ok||!(await repo.json()).private)throw new Error('The GitHub token must access a private notes repository.');
  const branch=await fetch(`https://api.github.com/repos/${config.vars.GITHUB_REPOSITORY}/commits/${encodeURIComponent(config.vars.GITHUB_BRANCH)}`,{headers,redirect:'manual'});
  if(!branch.ok)throw new Error('Initialise the private repository with a README and confirm the branch name.');
  if(!process.env.CLOUDFLARE_API_TOKEN)wrangler(['login']);
  if(!config.d1_databases?.length){wrangler(['d1','create',config.name,'--binding','DB','--update-config']);config=await readJSON(configFile);}
  if(!config.kv_namespaces?.length){wrangler(['kv','namespace','create',config.name+'-oauth','--binding','OAUTH_KV','--update-config']);config=await readJSON(configFile);}
  if(!config.vectorize?.length){wrangler(['vectorize','create',config.name,'--dimensions','384','--metric','cosine','--binding','VECTORIZE','--update-config']);config=await readJSON(configFile);}
  for(const db of config.d1_databases)if(db.binding==='DB')db.migrations_dir='migrations';
  await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
  wrangler(['d1','migrations','apply','DB','--remote']);
  await mkdir('artifacts',{recursive:true});
  const credentials=await readJSON('artifacts/connection.credentials.json')||{server:config.vars.PUBLIC_URL,deviceSyncToken:randomBytes(32).toString('hex'),ownerConnectionPassword:randomBytes(32).toString('hex')};
  if(credentials.server!==config.vars.PUBLIC_URL)throw new Error('Saved credentials belong to a different server. Use a separate project checkout for each deployment.');
  await writeFile('artifacts/connection.credentials.json',JSON.stringify(credentials,null,2)+'\n',{mode:0o600});await chmod('artifacts/connection.credentials.json',0o600);
  const secrets='artifacts/deploy.credentials.json';
  await writeFile(secrets,JSON.stringify({GITHUB_TOKEN:githubToken,SYNC_TOKEN:credentials.deviceSyncToken,OWNER_PASSWORD:credentials.ownerConnectionPassword}),{mode:0o600});
  try{wrangler(['deploy','--secrets-file',secrets]);}finally{await rm(secrets,{force:true});}
  const health=await fetch(config.vars.PUBLIC_URL+'/health');
  if(!health.ok)throw new Error('Worker deployed but health check failed. Check PUBLIC_URL before connecting devices.');
  const locked=await fetch(config.vars.PUBLIC_URL+'/api/notes');if(locked.status!==401)throw new Error('Authentication smoke test failed. Do not connect notes.');
  await configureChatGPT(config.vars.PUBLIC_URL);
  console.log(`Deployment is reachable at ${config.vars.PUBLIC_URL}.\nCredentials: artifacts/connection.credentials.json (keep private).\nChatGPT MCP: ${config.vars.PUBLIC_URL}/mcp\nInstall guide: docs/INSTALL.md\nRun npm run smoke -- --write to check indexing with a temporary test note.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)deploy().catch(e=>{console.error(e.message);process.exitCode=1;});
