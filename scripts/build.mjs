import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist/obsidian-semantic-engine',{recursive:true});
await build({entryPoints:['src/plugin/main.ts'],outfile:'dist/obsidian-semantic-engine/main.js',bundle:true,platform:'browser',format:'cjs',target:'es2020',external:['obsidian'],minify:true,metafile:true}).then(r=>writeFile('dist/plugin-metafile.json',JSON.stringify(r.metafile,null,2)));
for(const name of ['manifest.json','styles.css'])await copyFile(name,'dist/obsidian-semantic-engine/'+name);
await build({entryPoints:['src/worker/index.ts'],outfile:'dist/worker.mjs',bundle:true,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*'],conditions:['workerd','worker','browser'],minify:false});
console.log('Built mobile-compatible Obsidian bundle and Cloudflare Worker.');
