import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {MenuItemConstructorOptions, MessageBoxOptions, Rectangle} from 'electron';
import {DesktopWindowController,fitWindowBounds,type DesktopWindowOptions} from '../electron/desktop-window';

class FakeWindow extends EventEmitter {
  bounds: Rectangle = {x:100,y:80,width:1100,height:780};
  maximized=false;
  minimized=false;
  destroyed=false;
  hidden=false;
  focused=false;
  maximizeCount=0;
  preventCount=0;
  isDestroyed() {return this.destroyed;}
  isMaximized() {return this.maximized;}
  isMinimized() {return this.minimized;}
  getNormalBounds() {return {...this.bounds};}
  maximize() {this.maximized=true;this.maximizeCount++;this.emit('maximize');}
  minimize() {this.minimized=true;}
  restore() {this.minimized=false;}
  show() {this.hidden=false;}
  hide() {this.hidden=true;}
  focus() {this.focused=true;}
  requestClose() {
    let prevented=false;
    this.emit('close',{preventDefault:() => {prevented=true;this.preventCount++;}});
    if (!prevented) {this.destroyed=true;this.emit('closed');}
  }
}
class FakeApp extends EventEmitter {
  quitCalls=0;
  actualQuits=0;
  onAllowedQuit?: () => void;
  quit() {
    this.quitCalls++;
    let prevented=false;
    this.emit('before-quit',{preventDefault:() => {prevented=true;}});
    if (!prevented) {this.actualQuits++;this.onAllowedQuit?.();}
  }
}
class FakeTray extends EventEmitter {
  destroyed=false;
  tooltip='';
  menu: MenuItemConstructorOptions[]=[];
  setToolTip(text: string) {this.tooltip=text;}
  setContextMenu(menu: MenuItemConstructorOptions[]) {this.menu=menu;}
  destroy() {this.destroyed=true;}
}
function deferredChoice() {
  let resolve!: (choice: {response:number;checkboxChecked:boolean}) => void;
  const promise = new Promise<{response:number;checkboxChecked:boolean}>(done => {resolve=done;});
  return {promise,resolve};
}
async function fixture(overrides: Partial<DesktopWindowOptions>={},saved?: unknown) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-window-'));
  if (saved !== undefined) await fs.writeFile(path.join(directory,'desktop-window.json'),typeof saved === 'string' ? saved : JSON.stringify(saved));
  const app=new FakeApp(),window=new FakeWindow(),tray=new FakeTray();
  const errors: unknown[]=[];
  const dialogs: MessageBoxOptions[]=[];
  const choice=deferredChoice();
  const options: DesktopWindowOptions = {
    directory,app,
    screen:{getAllDisplays:() => [{workArea:{x:0,y:0,width:1920,height:1040}}],getPrimaryDisplay:() => ({workArea:{x:0,y:0,width:1920,height:1040}})},
    dialog:{showMessageBox:async(_window,options) => {dialogs.push(options);return choice.promise;}},
    createTray:() => tray,createMenu:template => template,trayIcon:'test-icon.ico',
    onError:error => {errors.push(error);},saveDebounceMs:10,...overrides
  };
  const controller=await DesktopWindowController.load(options);
  const read=async() => JSON.parse(await fs.readFile(path.join(directory,'desktop-window.json'),'utf8'));
  const cleanup=async() => {controller.dispose();await fs.rm(directory,{recursive:true,force:true});};
  return {directory,controller,app,window,tray,errors,dialogs,choice,read,cleanup};
}
async function until(check: () => boolean) {
  const deadline=Date.now()+2000;
  while (!check()) {
    if (Date.now()>deadline) throw new Error('窗口状态未按预期更新');
    await new Promise(resolve => setTimeout(resolve,5));
  }
}

test('window placement retains negative monitor coordinates and fits current work areas',() => {
  const left={x:-1920,y:0,width:1920,height:1040},primary={x:0,y:0,width:1920,height:1040};
  assert.deepEqual(fitWindowBounds({x:-1800,y:120,width:1100,height:800},[left,primary],primary),{
    x:-1800,y:120,width:1100,height:800,minWidth:960,minHeight:680
  });
  assert.deepEqual(fitWindowBounds({x:-1800,y:120,width:1500,height:950},[primary],primary),{
    x:0,y:90,width:1500,height:950,minWidth:960,minHeight:680
  });
  assert.deepEqual(fitWindowBounds({x:1800,y:950,width:5000,height:5000},[primary],primary),{
    x:0,y:0,width:1920,height:1040,minWidth:960,minHeight:680
  });
  assert.deepEqual(fitWindowBounds({x:-30,y:20,width:200,height:100},[{x:-800,y:30,width:800,height:600}]),{
    x:-800,y:30,width:800,height:600,minWidth:800,minHeight:600
  });
  assert.deepEqual(fitWindowBounds(undefined,[primary],primary),{
    x:240,y:60,width:1440,height:920,minWidth:960,minHeight:680
  });
});

test('corrupt or untrusted saved state recovers and close preference validation preserves current value',async() => {
  const f=await fixture({},'broken json');
  try {
    assert.deepEqual(f.controller.getPreferences(),{closeBehavior:'ask'});
    assert.equal(f.errors.length,1);
    await assert.rejects(f.controller.setCloseBehavior('destroy'),/关闭窗口行为无效/);
    await f.controller.setCloseBehavior('tray');
    assert.deepEqual(f.controller.getPreferences(),{closeBehavior:'tray'});
    assert.equal((await f.read()).closeBehavior,'tray');
  } finally {await f.cleanup();}
  const invalid=await fixture({}, {bounds:{x:1,y:null,width:-1,height:Infinity},closeBehavior:'evil',maximized:'true'});
  try {
    assert.deepEqual(invalid.controller.getPreferences(),{closeBehavior:'ask'});
    assert.equal(invalid.controller.createOptions().width,1440);
    invalid.controller.attach(invalid.window);
    invalid.controller.restore();
    assert.equal(invalid.window.maximizeCount,0);
  } finally {await invalid.cleanup();}
});

test('normal bounds and maximized state survive resize debounce and a restart',async() => {
  const f=await fixture();
  let restored: DesktopWindowController | undefined;
  try {
    f.controller.attach(f.window);
    f.window.bounds={x:240,y:90,width:1200,height:800};
    f.window.emit('move');
    f.window.bounds={x:210,y:110,width:1280,height:820};
    f.window.emit('resize');
    f.window.maximize();
    await until(() => !f.errors.length && f.window.maximizeCount===1);
    await new Promise(resolve => setTimeout(resolve,35));
    const saved=await f.read();
    assert.deepEqual(saved.bounds,{x:210,y:110,width:1280,height:820});
    assert.equal(saved.maximized,true);
    f.window.minimize();
    f.window.maximized=false;
    await f.controller.flush();
    assert.equal((await f.read()).maximized,true);
    restored=await DesktopWindowController.load({
      directory:f.directory,app:new FakeApp(),
      screen:{getAllDisplays:() => [{workArea:{x:0,y:0,width:1920,height:1040}}],getPrimaryDisplay:() => ({workArea:{x:0,y:0,width:1920,height:1040}})},
      dialog:{showMessageBox:async() => ({response:2,checkboxChecked:false})},
      createTray:() => new FakeTray(),createMenu:template => template,trayIcon:'test.ico'
    });
    assert.deepEqual(restored.createOptions(),{x:210,y:110,width:1280,height:820,minWidth:960,minHeight:680});
    const next=new FakeWindow();restored.attach(next);restored.restore();
    assert.equal(next.maximizeCount,1);
  } finally {restored?.dispose();await f.cleanup();}
});

test('repeated closes share one dialog, remember tray choice, and restore through its icon and menu',async() => {
  const f=await fixture();
  try {
    f.controller.attach(f.window);
    f.window.requestClose();f.window.requestClose();f.window.requestClose();
    assert.equal(f.dialogs.length,1);
    assert.equal(f.window.preventCount,3);
    assert.deepEqual(f.dialogs[0].buttons,['最小化到托盘','退出程序','取消']);
    assert.equal(f.dialogs[0].checkboxLabel,'记住我的选择');
    f.choice.resolve({response:0,checkboxChecked:true});
    await until(() => f.window.hidden);
    assert.equal(f.window.destroyed,false);
    assert.equal((await f.read()).closeBehavior,'tray');
    f.tray.emit('click');
    assert.equal(f.window.hidden,false);assert.equal(f.window.focused,true);
    f.window.requestClose();
    assert.equal(f.window.hidden,true);assert.equal(f.dialogs.length,1);
    const show=f.tray.menu.find(item => item.label==='显示主窗口');
    assert.ok(show?.click);(show.click as () => void)();
    assert.equal(f.window.hidden,false);
    await f.controller.flush();
    f.controller.dispose();
    assert.equal(f.tray.destroyed,true);
    assert.equal(f.app.listenerCount('before-quit'),0);
  } finally {await f.cleanup();}
});

test('cancel leaves the window open and ignores the remember checkbox',async() => {
  const f=await fixture();
  try {
    f.controller.attach(f.window);f.window.requestClose();
    f.choice.resolve({response:2,checkboxChecked:true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.hidden,false);assert.equal(f.window.destroyed,false);
    assert.deepEqual(f.controller.getPreferences(),{closeBehavior:'ask'});
    assert.equal(f.app.quitCalls,0);
  } finally {await f.cleanup();}
});

test('a failed tray keeps the application available as a minimized window',async() => {
  const f=await fixture({createTray:() => {throw new Error('tray unavailable');}}, {closeBehavior:'tray'});
  try {
    f.controller.attach(f.window);f.window.requestClose();
    assert.equal(f.window.minimized,true);assert.equal(f.window.hidden,false);assert.equal(f.window.destroyed,false);
    assert.equal(f.errors.length,1);
    f.controller.show();
    assert.equal(f.window.minimized,false);assert.equal(f.window.focused,true);
    await f.controller.flush();
  } finally {await f.cleanup();}
});

test('confirmed quit persists the preference and normal bounds before cleanup and app.quit',async() => {
  const order: string[]=[];
  const f=await fixture({onFinalQuit:async() => {
    const saved=await f.read();
    assert.equal(saved.closeBehavior,'quit');assert.deepEqual(saved.bounds,f.window.bounds);
    order.push('cleanup');
  }});
  try {
    f.controller.attach(f.window);
    f.app.onAllowedQuit=() => {order.push('quit');f.window.requestClose();};
    f.window.requestClose();f.choice.resolve({response:1,checkboxChecked:true});
    await until(() => f.app.actualQuits===1);
    assert.deepEqual(order,['cleanup','quit']);
    assert.equal(f.window.destroyed,true);assert.equal(f.dialogs.length,1);
    assert.equal(f.app.actualQuits,1);
    await f.controller.flush();
  } finally {await f.cleanup();}
});

test('app.quit bypasses an unanswered close dialog and shutdown cannot open a second prompt',async() => {
  const f=await fixture();
  try {
    f.controller.attach(f.window);
    f.app.onAllowedQuit=() => f.window.requestClose();
    f.window.requestClose();
    f.app.quit();
    await f.controller.quit();
    assert.equal(f.dialogs[0].signal?.aborted,true);
    assert.equal(f.app.actualQuits,1);assert.equal(f.window.destroyed,true);
    assert.equal(f.dialogs.length,1);
    f.choice.resolve({response:0,checkboxChecked:true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.hidden,false);
    assert.equal((await f.read()).closeBehavior,'ask');
    await f.controller.flush();
  } finally {await f.cleanup();}
});

test('concurrent quit requests cannot bypass the pending save and cleanup',async() => {
  let release!: () => void;
  let cleanupStarted=false;
  const cleanupGate=new Promise<void>(resolve => {release=resolve;});
  const f=await fixture({onFinalQuit:async() => {cleanupStarted=true;await cleanupGate;}});
  try {
    f.controller.attach(f.window);
    f.app.onAllowedQuit=() => f.window.requestClose();
    f.app.quit();
    await until(() => cleanupStarted);
    f.app.quit();f.window.requestClose();
    assert.equal(f.app.actualQuits,0);assert.equal(f.window.destroyed,false);assert.equal(f.dialogs.length,0);
    release();
    await f.controller.quit();
    assert.equal(f.app.actualQuits,1);assert.equal(f.window.destroyed,true);
    await f.controller.flush();
  } finally {release();await f.cleanup();}
});
