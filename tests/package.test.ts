import {describe,it,expect} from 'vitest';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import {configureChatGPT,serverOrigin} from '../scripts/configure-chatgpt.mjs';
import {makeConfig} from '../scripts/deploy.mjs';
describe('distribution and setup',()=>{
  it('builds an Obsidian bundle without Node, Electron or filesystem dependencies',async()=>{
    const result=await build({entryPoints:['src/plugin/main.ts'],bundle:true,platform:'browser',format:'cjs',target:'es2020',external:['obsidian'],write:false,metafile:true});
    const imports=Object.values(result.metafile.outputs).flatMap(o=>o.imports.map(i=>i.path));
    expect(imports).toEqual(['obsidian']);
    const manifest=JSON.parse(await readFile('manifest.json','utf8'));expect(manifest.isDesktopOnly).toBe(false);expect(manifest.id).toBe('semantic-engine');
  });
  it('generates a per-deployment portable MCP package without credentials',async()=>{
    const out='dist/test-chatgpt-plugin';
    try {
      await configureChatGPT('https://engine.example',out);
      const files=unzipSync(new Uint8Array(await readFile(out+'.zip')));
      const mcp=JSON.parse(strFromU8(files['mcp.json']));
      expect(mcp.mcpServers['obsidian-semantic-engine']).toEqual({type:'streamable-http',url:'https://engine.example/mcp'});
      const metadata=JSON.parse(strFromU8(files['plugin.json']));expect(metadata.name).toBe('obsidian-semantic-engine');
      expect(Object.keys(files).sort()).toEqual(['README.md','mcp.json','plugin.json']);
    } finally {await rm(out,{recursive:true,force:true});await rm(out+'.zip',{force:true});}
  });
  it('validates installer input and clears template resource IDs',async()=>{
    const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
    const config=makeConfig(base,{name:'my-engine',repository:'owner/private-vault',origin:'https://engine.example',branch:'main',vaultName:'My Vault'});
    expect(config.vars.PUBLIC_URL).toBe('https://engine.example');expect(config.d1_databases).toBeUndefined();expect(config.kv_namespaces).toBeUndefined();expect(config.vectorize).toBeUndefined();
    expect(base.d1_databases).toHaveLength(1);
    for(const url of ['http://engine.example','https://user:pass@engine.example','https://engine.example/mcp','https://engine.example?key=secret'])expect(()=>serverOrigin(url)).toThrow();
    expect(()=>makeConfig(base,{name:'bad;command',repository:'a/b',origin:'https://e.example',branch:'main',vaultName:'Vault'})).toThrow();
  });
});
