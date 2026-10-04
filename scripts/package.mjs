import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
await mkdir('artifacts',{recursive:true});
const entries={};
for(const file of ['main.js','manifest.json','styles.css']){
  const bytes=await readFile('dist/obsidian-semantic-engine/'+file);entries[manifest.id+'/'+file]=new Uint8Array(bytes);await copyFile('dist/obsidian-semantic-engine/'+file,'artifacts/'+file);
}
const archive=`semantic-engine-${manifest.version}.zip`;
await writeFile('artifacts/'+archive,zipSync(entries,{level:9}));
const sums=[];
for(const file of ['main.js','manifest.json','styles.css',archive])sums.push(createHash('sha256').update(await readFile('artifacts/'+file)).digest('hex')+'  '+file);
await writeFile('artifacts/SHA256SUMS.txt',sums.join('\n')+'\n');
console.log('Created installable Obsidian plugin and SHA-256 checksums in artifacts/.');
