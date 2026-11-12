import fs from 'node:fs/promises';
import path from 'node:path';
import type { Settings, SavedWorkspace } from '../shared/types';
import { normalizePostUrl } from './forum';

export const defaults: Settings = {theme: 'system', uiFontSize:16, fontSize:18, nodeSeekPro:false, compact:false, restoreTabs:true, defaultSource:'auto'};
export function validateSettings(value: unknown): Settings {
  const v = value as Partial<Settings> | null;
  const uiFontSize=v?.uiFontSize ?? defaults.uiFontSize;
  const fontSize=v?.fontSize===13?14:v?.fontSize;
  const nodeSeekPro=v?.nodeSeekPro ?? false;
  if (!v || !['system', 'light', 'dark'].includes(v.theme!) || !Number.isInteger(fontSize) || fontSize! < 14 || fontSize! > 40 || !Number.isInteger(uiFontSize) || uiFontSize < 14 || uiFontSize > 28 || typeof v.compact !== 'boolean' || typeof v.restoreTabs !== 'boolean' || !['auto', 'rss'].includes(v.defaultSource!)) throw new Error('设置参数无效');
  if(typeof nodeSeekPro!=='boolean')throw new Error('脚本设置无效');
  return {theme:v.theme!, fontSize:fontSize!, uiFontSize, nodeSeekPro, compact:v.compact, restoreTabs:v.restoreTabs, defaultSource:v.defaultSource!};
}
export function validateBlockedUsers(value: unknown): number[] {
  if(!Array.isArray(value) || value.length>1000 || value.some(id=>!Number.isSafeInteger(id) || id<=0 || id>1_000_000_000)) throw new Error('屏蔽用户列表无效');
  return [...new Set(value)];
}
export function validateWorkspace(value: unknown): SavedWorkspace {
  const v = value as SavedWorkspace | null;
  if (!v || !Array.isArray(v.tabs) || v.tabs.length > 30) throw new Error('最多保留 30 个阅读标签');
  const seen = new Set<string>();
  const tabs = v.tabs.map(p => {
    const url = normalizePostUrl(p.url);
    const id = new URL(url).pathname.match(/^\/post-(\d+)-/)![1];
    if (seen.has(id) || typeof p.title !== 'string') throw new Error('阅读标签无效');
    seen.add(id);
    return {id, url, title:p.title.slice(0,500), author: typeof p.author === 'string' ? p.author.slice(0,100) : '', category: typeof p.category === 'string' ? p.category.slice(0,40) : '', published: typeof p.published === 'string' ? p.published.slice(0,50) : '', summary: ''};
  });
  const scrollPositions:Record<string,number>={};
  if(v.scrollPositions&&typeof v.scrollPositions==='object')for(const [id,value] of Object.entries(v.scrollPositions)){if(seen.has(id)&&Number.isFinite(value)&&value>=0&&value<=100000000)scrollPositions[id]=value;}
  return {tabs, activeId: typeof v.activeId === 'string' && seen.has(v.activeId) ? v.activeId : null,overviewOpen:typeof v.overviewOpen==='boolean'?v.overviewOpen:true,scrollPositions};
}
export class Store {
  settings: Settings = {...defaults};
  workspace: SavedWorkspace = {tabs: [], activeId: null};
  blockedUsers: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, 'preferences.json'), 'utf8'));
      this.settings = validateSettings(value.settings);
      try { this.workspace = validateWorkspace(value.workspace); } catch { /* Ignore outdated workspace. */ }
      try { this.blockedUsers = validateBlockedUsers(value.blockedUsers || []); } catch { /* Ignore malformed old preferences. */ }
    } catch { /* First run or corrupt preferences: use safe defaults. */ }
  }
  save() {
    const snapshot = JSON.stringify({settings:this.settings, workspace:this.settings.restoreTabs ? this.workspace : {tabs:[],activeId:null,overviewOpen:this.workspace.overviewOpen ?? true},blockedUsers:this.blockedUsers}, null, 2);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, {recursive:true});
      const target = path.join(this.directory, 'preferences.json');
      await fs.writeFile(target + '.tmp', snapshot, 'utf8');
      await fs.rename(target + '.tmp', target);
    });
    return this.queue;
  }
}
