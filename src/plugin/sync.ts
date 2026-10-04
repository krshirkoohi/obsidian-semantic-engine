import { digest, included, type BaseNote, type NoteContent, type RemoteNote } from '../shared';
export interface LocalVault {
  paths(): Promise<string[]>;
  read(path: string): Promise<string | null>;
  replace(path: string, content: string, expected: string | null): Promise<void>;
  trash(path: string, expected: string): Promise<void>;
  conflict(path: string, remote: string, sha: string): Promise<void>;
}
export interface RemoteVault {
  list(): Promise<RemoteNote[]>;
  read(path: string): Promise<NoteContent>;
  write(path: string, content: string, sha: string | null): Promise<RemoteNote>;
  remove(path: string, sha: string): Promise<void>;
}
export interface SyncState {
  files: Record<string, BaseNote>;
  deleted: string[];
  conflicts: Record<string,string>;
}
export const emptyState = (): SyncState => ({files:{},deleted:[],conflicts:{}});
export async function syncVault(local:LocalVault, remote:RemoteVault, state:SyncState, checkpoint:()=>Promise<void>, excluded:string[] = []) {
  const remoteNotes=(await remote.list()).filter(n=>included(n.path,excluded));
  const remoteMap=new Map(remoteNotes.map(n=>[n.path,n]));
  const paths=new Set([...(await local.paths()).filter(p=>included(p,excluded)),...remoteMap.keys(),...Object.keys(state.files).filter(p=>included(p,excluded))]);
  const deletions:{path:string;sha:string}[]=[];
  let pulled=0,pushed=0,deleted=0;
  const failures:string[]=[];
  for (const path of [...paths].sort()) {
    try {
      const text=await local.read(path), r=remoteMap.get(path), base=state.files[path];
      const hash=text===null?null:await digest(text);
      if(text!==null) state.deleted=state.deleted.filter(p=>p!==path);
      if(text===null&&!r) {delete state.files[path];delete state.conflicts[path];state.deleted=state.deleted.filter(p=>p!==path);await checkpoint();continue;}
      if(text===null&&r) {
        if(base&&state.deleted.includes(path)) {
          if(r.sha!==base.sha) {state.conflicts[path]='Deleted here, edited on GitHub. Restore or resolve this note before deleting it.';failures.push(path);await checkpoint();continue;}
          deletions.push({path,sha:base.sha});continue;
        }
        const fresh=await remote.read(path);
        await local.replace(path,fresh.content,null);
        state.files[path]={sha:fresh.sha,hash:await digest(fresh.content)};delete state.conflicts[path];pulled++;await checkpoint();continue;
      }
      if(text!==null&&!r) {
        if(base) {
          if(hash===base.hash) {await local.trash(path,text);delete state.files[path];delete state.conflicts[path];deleted++;await checkpoint();continue;}
          state.conflicts[path]='Edited here, deleted on GitHub. Choose which version to keep.';failures.push(path);await checkpoint();continue;
        }
        const written=await remote.write(path,text,null);
        state.files[path]={sha:written.sha,hash:hash!};delete state.conflicts[path];pushed++;await checkpoint();continue;
      }
      if(text!==null&&r) {
        if(base&&r.sha===base.sha) {
          if(hash!==base.hash) {const written=await remote.write(path,text,base.sha);state.files[path]={sha:written.sha,hash:hash!};pushed++;}
          delete state.conflicts[path];await checkpoint();continue;
        }
        const fresh=await remote.read(path), remoteHash=await digest(fresh.content);
        if(hash===remoteHash) {state.files[path]={sha:fresh.sha,hash:remoteHash};delete state.conflicts[path];await checkpoint();continue;}
        if(base&&hash===base.hash) {
          await local.replace(path,fresh.content,text);state.files[path]={sha:fresh.sha,hash:remoteHash};delete state.conflicts[path];pulled++;await checkpoint();continue;
        }
        await local.conflict(path,fresh.content,fresh.sha);
        state.conflicts[path]='Both copies differ. Your note is unchanged; the GitHub copy is in Semantic Engine Conflicts.';failures.push(path);await checkpoint();
      }
    } catch(e) {failures.push(path);state.conflicts[path]=e instanceof Error?e.message:'Sync failed; changes kept locally.';await checkpoint();}
  }
  // Finish uploads before deletions: a failed rename upload must not delete the source.
  if(!failures.length) for(const item of deletions) {
    try {
      if(await local.read(item.path)!==null) continue;
      await remote.remove(item.path,item.sha);delete state.files[item.path];delete state.conflicts[item.path];state.deleted=state.deleted.filter(p=>p!==item.path);deleted++;await checkpoint();
    } catch(e) {failures.push(item.path);state.conflicts[item.path]=e instanceof Error?e.message:'Delete failed.';await checkpoint();}
  }
  return {pulled,pushed,deleted,conflicts:[...new Set(failures)]};
}
