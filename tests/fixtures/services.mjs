import { WorkerEntrypoint } from 'cloudflare:workers';
const vectors=new Map();let fail=false;
function vector(text) {
  const v=Array(384).fill(0);const words=text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  for(let w of words){if(['supper','dinner','meal','food','eating'].includes(w))w='meal';let h=0;for(const c of w)h=(h*31+c.charCodeAt(0))>>>0;v[h%384]+=1;}
  const norm=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;return v.map(x=>x/norm);
}
export class FakeAI extends WorkerEntrypoint {
  async run(_model,input){if(fail)throw new Error('simulated provider outage');return {data:input.text.map(vector)};}
  async setFailure(value){fail=value;}
}
export class FakeVectors extends WorkerEntrypoint {
  async upsert(items){if(fail)throw new Error('simulated provider outage');for(const item of items)vectors.set(item.id,item.values);return {mutationId:'fixture'};}
  async deleteByIds(ids){for(const id of ids)vectors.delete(id);return {mutationId:'fixture'};}
  async query(values,options){if(fail)throw new Error('simulated provider outage');return {count:vectors.size,matches:[...vectors].map(([id,v])=>({id,score:v.reduce((s,x,i)=>s+x*values[i],0)})).sort((a,b)=>b.score-a.score).slice(0,options.topK)};}
}
export default {fetch(){return new Response('test services');}};
