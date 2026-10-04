import { Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, normalizePath, Modal } from 'obsidian';
import { CONFLICT_FOLDER, digest, endpoint, included, HttpError, type NoteContent, type RemoteNote } from '../shared';
import { emptyState, syncVault, type LocalVault, type RemoteVault, type SyncState } from './sync';
interface Settings { server:string; enabled:boolean; intervalSeconds:number }
const defaults:Settings={server:'',enabled:false,intervalSeconds:60};
export default class SemanticEnginePlugin extends Plugin {
  settings:Settings=defaults;
  state:SyncState=emptyState();
  token='';busy=false;status='Not connected';
  private statusEl!:HTMLElement;
  private timer:number|undefined;
  private suppress=new Set<string>();
  private excluded:string[]=[];
  private stateKey() {return `semantic-engine:${this.app.vault.getName()}:${this.settings.server}`;}
  private loadDevice() {
    this.token=this.app.loadLocalStorage(this.stateKey()+':token')||'';
    this.state=this.app.loadLocalStorage(this.stateKey()+':state')||emptyState();
  }
  async checkpoint() {this.app.saveLocalStorage(this.stateKey()+':state',this.state);}
  async onload() {
    this.settings={...defaults,...await this.loadData()};this.loadDevice();
    this.statusEl=this.addStatusBarItem();this.setStatus('Ready');
    this.addSettingTab(new EngineSettings(this));
    this.addRibbonIcon('refresh-cw','Sync Semantic Engine',()=>void this.sync(true));
    this.addCommand({id:'sync-now',name:'Sync now',callback:()=>void this.sync(true)});
    this.addCommand({id:'show-status',name:'Show sync status',callback:()=>void this.showStatus()});
    this.addCommand({id:'resolve-local',name:'Resolve current note conflict: keep this device copy',callback:()=>void this.resolve('local')});
    this.addCommand({id:'resolve-remote',name:'Resolve current note conflict: use GitHub copy',callback:()=>void this.resolve('remote')});
    this.registerEvent(this.app.vault.on('create',()=>this.schedule()));
    this.registerEvent(this.app.vault.on('modify',()=>this.schedule()));
    this.registerEvent(this.app.vault.on('delete',file=>{
      if(!this.suppress.has(file.path)) {const deleted=Object.keys(this.state.files).filter(p=>p===file.path||p.startsWith(file.path+'/'));this.state.deleted=[...new Set([...this.state.deleted,...deleted])];void this.checkpoint();}
      this.schedule();
    }));
    this.registerEvent(this.app.vault.on('rename',(file,old)=>{
      if(!this.suppress.has(old)) {const deleted=Object.keys(this.state.files).filter(p=>p===old||p.startsWith(old+'/'));this.state.deleted=[...new Set([...this.state.deleted,...deleted])];void this.checkpoint();}
      this.schedule();
    }));
    this.registerInterval(window.setInterval(()=>{if(this.settings.enabled) void this.sync();},Math.max(30,this.settings.intervalSeconds)*1000));
    this.registerDomEvent(document,'visibilitychange',()=>{if(document.visibilityState==='visible')this.schedule();});
    this.app.workspace.onLayoutReady(()=>this.schedule());
  }
  onunload() {if(this.timer)window.clearTimeout(this.timer);}
  private schedule() {if(!this.settings.enabled)return;if(this.timer)window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.sync(),2500);}
  private setStatus(text:string) {this.status=text;this.statusEl?.setText(`Semantic Engine: ${text}`);}
  async saveSettings() {await this.saveData(this.settings);}
  async setServer(value:string) {
    if(this.busy)throw new Error('Wait until sync finishes before changing the server.');
    this.settings.server=value?endpoint(value.trim()):'';this.settings.enabled=false;await this.saveSettings();this.loadDevice();
  }
  saveToken(value:string) {this.token=value.trim();this.app.saveLocalStorage(this.stateKey()+':token',this.token);}
  private async api<T>(path:string,method='GET',body?:unknown):Promise<T> {
    const base=endpoint(this.settings.server);
    if(this.token.length<32)throw new Error('Add the device sync token in plugin settings.');
    const result=await requestUrl({url:base+path,method,headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),throw:false});
    if(result.status>=400){let error='Server request failed. Changes remain on this device.';try{error=result.json.error||error;}catch{}throw new HttpError(result.status,error);}
    return result.json as T;
  }
  private remote():RemoteVault {return {
    list:async()=>(await this.api<{notes:RemoteNote[]}>('/api/notes')).notes,
    read:path=>this.api<NoteContent>('/api/note?path='+encodeURIComponent(path)),
    write:(path,content,sha)=>this.api<RemoteNote>('/api/note','PUT',{path,content,expected_sha:sha}),
    remove:async(path,sha)=>{await this.api('/api/note','DELETE',{path,expected_sha:sha});},
  };}
  private async folders(path:string) {
    const parts=path.split('/');parts.pop();let prefix='';
    for(const p of parts) {prefix=prefix?prefix+'/'+p:p;if(!this.app.vault.getAbstractFileByPath(prefix)){try{await this.app.vault.createFolder(prefix);}catch(e){if(!this.app.vault.getAbstractFileByPath(prefix))throw e;}}}
  }
  private local():LocalVault {return {
    paths:async()=>this.app.vault.getMarkdownFiles().map(f=>f.path).filter(p=>included(p,this.excluded)),
    read:async path=>{const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?this.app.vault.read(f):null;},
    replace:async(path,content,expected)=>{
      this.suppress.add(path);
      try {
        const file=this.app.vault.getAbstractFileByPath(path);
        if(expected===null) {if(file)throw new Error('A local note appeared during sync. Retry to compare both copies.');await this.folders(path);await this.app.vault.create(normalizePath(path),content);}
        else {if(!(file instanceof TFile))throw new Error('The local note moved during sync.');await this.app.vault.process(file,current=>{if(current!==expected)throw new Error('The local note changed during sync. Retry.');return content;});}
      } finally {this.suppress.delete(path);}
    },
    trash:async(path,expected)=>{
      const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))return;
      // Never remove a newer local edit. Obsidian's vault trash retains the removed file.
      if(await this.app.vault.read(file)!==expected)throw new Error('The local note changed during sync.');
      this.suppress.add(path);try{await this.app.vault.trash(file,false);}finally{this.suppress.delete(path);}
    },
    conflict:async(path,content,sha)=>{const copy=`${CONFLICT_FOLDER}/${path.replace(/\.md$/i,'')}.remote-${sha.slice(0,12)}.md`;if(!this.app.vault.getAbstractFileByPath(copy)){await this.folders(copy);await this.app.vault.create(copy,content);}},
  };}
  async sync(notify=false) {
    if(this.busy)return;
    if(!this.settings.enabled){if(notify)new Notice('Enable sync in Semantic Engine settings after reviewing the server and exclusions.');return;}
    this.busy=true;this.setStatus('Syncing');
    try {
      const config=await this.api<{excluded_prefixes:string[]}>('/api/config');this.excluded=config.excluded_prefixes;
      const result=await syncVault(this.local(),this.remote(),this.state,()=>this.checkpoint(),this.excluded);
      this.setStatus(result.conflicts.length?`${result.conflicts.length} notes need attention`:'Synced');
      if(result.pushed||result.deleted)await this.api('/api/sync','POST',{});
      if(notify||result.conflicts.length)new Notice(`Semantic Engine: ${result.pushed} uploaded, ${result.pulled} downloaded, ${result.deleted} deleted. ${result.conflicts.length} notes need attention.`);
    }catch(e){this.setStatus('Offline or needs attention');if(notify)new Notice(e instanceof Error?e.message:'Sync failed.');}
    finally{this.busy=false;}
  }
  async showStatus() {
    const modal=new Modal(this.app);modal.titleEl.setText('Semantic Engine status');
    modal.contentEl.createEl('p',{text:this.status});
    for(const [path,reason] of Object.entries(this.state.conflicts))modal.contentEl.createEl('p',{text:`${path}: ${reason}`});
    modal.open();
    try {const status=await this.api('/api/status');modal.contentEl.createEl('pre',{text:JSON.stringify(status,null,2)});}catch(e){modal.contentEl.createEl('p',{text:e instanceof Error?e.message:'Not connected.'});}
  }
  async resolve(choice:'local'|'remote') {
    const file=this.app.workspace.getActiveFile();
    if(!file||!this.state.conflicts[file.path]){new Notice('Open the original conflicting note first.');return;}
    if(this.busy){new Notice('Wait for sync to finish.');return;}
    this.busy=true;
    try {
      const local=await this.app.vault.read(file);
      let remote:NoteContent;
      try{remote=await this.remote().read(file.path);}catch(e){
        if(e instanceof HttpError&&e.status===404&&choice==='local'){const saved=await this.remote().write(file.path,local,null);this.state.files[file.path]={sha:saved.sha,hash:await digest(local)};delete this.state.conflicts[file.path];await this.checkpoint();new Notice('Local note restored to GitHub.');return;}
        throw e;
      }
      // Save both versions before explicitly resolving the conflict.
      await this.local().conflict(file.path,remote.content,remote.sha);
      if(choice==='remote')await this.local().conflict(file.path,local,await digest(local));
      if(choice==='remote')await this.local().replace(file.path,remote.content,local);
      this.state.files[file.path]={sha:remote.sha,hash:await digest(remote.content)};delete this.state.conflicts[file.path];await this.checkpoint();
      new Notice(choice==='local'?'Conflict resolved. Sync will upload this device copy.':'GitHub copy restored.');
    }catch(e){new Notice(e instanceof Error?e.message:'Could not resolve conflict.');}
    finally{this.busy=false;}
    this.schedule();
  }
}
class EngineSettings extends PluginSettingTab {
  constructor(private plugin:SemanticEnginePlugin){super(plugin.app,plugin);}
  display() {
    const {containerEl}=this;containerEl.empty();containerEl.createEl('h2',{text:'Semantic Engine'});
    containerEl.createEl('p',{text:'Connect each device to the same private vault. Only Markdown notes sync. GitHub keeps note history. Cloudflare stores the mirror and processes embeddings. ChatGPT receives tool results. No data is sent until you enable sync.'});
    new Setting(containerEl).setName('Server URL').setDesc('Your Cloudflare Worker HTTPS address. Changing this pauses sync.').addText(t=>t.setValue(this.plugin.settings.server).setPlaceholder('https://your-engine.workers.dev').onChange(value=>{void this.plugin.setServer(value).catch(()=>{});}));
    new Setting(containerEl).setName('Device sync token').setDesc('Stored on this device. It is separate from the owner connection password used for ChatGPT.').addText(t=>{t.inputEl.type='password';t.setValue(this.plugin.token).onChange(v=>this.plugin.saveToken(v));});
    new Setting(containerEl).setName('Enable sync').setDesc('Uploads local Markdown and downloads remote changes. First-sync differences create conflict copies. Mobile sync runs while Obsidian is open.').addToggle(t=>t.setValue(this.plugin.settings.enabled).onChange(async v=>{this.plugin.settings.enabled=v;await this.plugin.saveSettings();if(v)void this.plugin.sync(true);}));
    new Setting(containerEl).setName('Sync now').addButton(b=>b.setButtonText('Sync').onClick(()=>void this.plugin.sync(true)));
    new Setting(containerEl).setName('Status and conflicts').addButton(b=>b.setButtonText('Show status').onClick(()=>void this.plugin.showStatus()));
    containerEl.createEl('p',{text:'Do not run another bidirectional sync service over these notes at the same time. Attachments, Canvas files, hidden folders and Semantic Engine Conflicts are excluded. Ask the deployment owner to configure other excluded folders.'});
  }
}
