import fs from 'node:fs/promises';
import path from 'node:path';
import type {BrowserWindowConstructorOptions, MenuItemConstructorOptions, MessageBoxOptions, NativeImage, Rectangle} from 'electron';

export type CloseBehavior = 'ask' | 'tray' | 'quit';
export interface DesktopWindowPreferences {closeBehavior: CloseBehavior}
interface WindowState extends DesktopWindowPreferences {bounds?: Rectangle; maximized: boolean}

interface AppPort {
  on(event: 'before-quit', listener: (event: {preventDefault(): void}) => void): unknown;
  removeListener(event: 'before-quit', listener: (event: {preventDefault(): void}) => void): unknown;
  quit(): void;
}
interface WindowPort {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isMinimized(): boolean;
  getNormalBounds(): Rectangle;
  maximize(): void;
  minimize(): void;
  restore(): void;
  show(): void;
  hide(): void;
  focus(): void;
}
interface TrayPort {
  on(event: 'click', listener: () => void): unknown;
  setToolTip(text: string): void;
  setContextMenu(menu: any): void;
  destroy(): void;
}
interface DisplayPort {workArea: Rectangle}
export interface DesktopWindowOptions {
  directory: string;
  app: AppPort;
  screen: {getAllDisplays(): DisplayPort[]; getPrimaryDisplay(): DisplayPort};
  dialog: {showMessageBox(window: any, options: MessageBoxOptions): Promise<{response: number; checkboxChecked: boolean}>};
  createTray(icon: string | NativeImage): TrayPort;
  createMenu(template: MenuItemConstructorOptions[]): unknown;
  trayIcon: string | NativeImage;
  onFinalQuit?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  saveDebounceMs?: number;
}

const defaultBounds = {width:1440,height:920};
const fallbackWorkArea: Rectangle = {x:0,y:0,width:1920,height:1080};
const validBehavior = (value: unknown): value is CloseBehavior => value === 'ask' || value === 'tray' || value === 'quit';

function rectangle(value: unknown): Rectangle | undefined {
  if (!value || typeof value !== 'object') return;
  const source = value as Record<string, unknown>;
  if (!['x','y','width','height'].every(key => typeof source[key] === 'number' && Number.isFinite(source[key]) && Number.isSafeInteger(Math.round(source[key] as number)))) return;
  if (Math.round(source.width as number) <= 0 || Math.round(source.height as number) <= 0) return;
  return {x:Math.round(source.x as number),y:Math.round(source.y as number),width:Math.round(source.width as number),height:Math.round(source.height as number)};
}

/** Fit normal window bounds to an available work area, including displays left of the primary. */
export function fitWindowBounds(saved: Rectangle | undefined, displays: Rectangle[], primary = displays[0] ?? fallbackWorkArea): Required<Pick<BrowserWindowConstructorOptions,'x'|'y'|'width'|'height'|'minWidth'|'minHeight'>> {
  const areas = displays.map(rectangle).filter((area): area is Rectangle => !!area);
  const primaryArea = rectangle(primary) ?? areas[0] ?? fallbackWorkArea;
  if (!areas.length) areas.push(primaryArea);
  const bounds = rectangle(saved);
  let area = primaryArea;
  if (bounds) {
    let largestOverlap = 0;
    let nearestDistance = Infinity;
    for (const candidate of areas) {
      const overlap = Math.max(0,Math.min(bounds.x+bounds.width,candidate.x+candidate.width)-Math.max(bounds.x,candidate.x))
        * Math.max(0,Math.min(bounds.y+bounds.height,candidate.y+candidate.height)-Math.max(bounds.y,candidate.y));
      const dx = Math.max(candidate.x-bounds.x-bounds.width,bounds.x-candidate.x-candidate.width,0);
      const dy = Math.max(candidate.y-bounds.y-bounds.height,bounds.y-candidate.y-candidate.height,0);
      const distance = dx*dx+dy*dy;
      if (overlap > largestOverlap || (largestOverlap === 0 && overlap === 0 && distance < nearestDistance)) {
        area = candidate;
        largestOverlap = overlap;
        nearestDistance = distance;
      }
    }
  }
  const minWidth = Math.min(960,area.width);
  const minHeight = Math.min(680,area.height);
  const width = Math.min(area.width,Math.max(minWidth,bounds?.width ?? defaultBounds.width));
  const height = Math.min(area.height,Math.max(minHeight,bounds?.height ?? defaultBounds.height));
  const x = Math.max(area.x,Math.min(bounds?.x ?? area.x+Math.floor((area.width-width)/2),area.x+area.width-width));
  const y = Math.max(area.y,Math.min(bounds?.y ?? area.y+Math.floor((area.height-height)/2),area.y+area.height-height));
  return {x,y,width,height,minWidth,minHeight};
}

/** Owns only the main window's placement, close preference, and tray lifecycle. */
export class DesktopWindowController {
  private state: WindowState = {maximized:false,closeBehavior:'ask'};
  private window?: WindowPort;
  private tray?: TrayPort;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private pendingDialog = false;
  private dialogAbort?: AbortController;
  private quitting = false;
  private quitAllowed = false;
  private quitPromise?: Promise<void>;
  private disposed = false;
  private readonly filename: string;
  private readonly beforeQuit = (event: {preventDefault(): void}) => {
    if (this.quitAllowed) return;
    // app.quit(), including automation shutdown, must bypass the close question.
    event.preventDefault();
    void this.quit();
  };
  private readonly changed = () => {
    this.capture();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {this.timer=undefined;void this.flush().catch(error => this.report(error));},this.options.saveDebounceMs ?? 200);
  };
  private readonly closing = (event: {preventDefault(): void}) => {
    if (this.quitAllowed || this.disposed) return;
    event.preventDefault();
    if (this.quitting || this.pendingDialog) return;
    if (this.state.closeBehavior === 'quit') {void this.quit();return;}
    if (this.state.closeBehavior === 'tray') {this.hideToTray();return;}
    this.pendingDialog = true;
    void this.askClose().finally(() => {this.pendingDialog=false;});
  };
  private readonly closed = () => {
    void this.flush().catch(error => this.report(error));
    this.detach();
  };

  constructor(private readonly options: DesktopWindowOptions) {
    this.filename = path.join(options.directory,'desktop-window.json');
    options.app.on('before-quit',this.beforeQuit);
  }

  static async load(options: DesktopWindowOptions): Promise<DesktopWindowController> {
    const controller = new DesktopWindowController(options);
    try {
      const value: unknown = JSON.parse(await fs.readFile(controller.filename,'utf8'));
      if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        controller.state = {bounds:rectangle(source.bounds),maximized:source.maximized === true,closeBehavior:validBehavior(source.closeBehavior) ? source.closeBehavior : 'ask'};
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') controller.report(error);
    }
    return controller;
  }

  createOptions() {
    const displays = this.options.screen.getAllDisplays().map(display => display.workArea);
    return fitWindowBounds(this.state.bounds,displays,this.options.screen.getPrimaryDisplay().workArea);
  }

  attach(window: WindowPort): void {
    if (this.disposed) throw new Error('窗口控制器已释放');
    this.detach();
    this.window = window;
    for (const event of ['move','resize','maximize','unmaximize']) window.on(event,this.changed);
    window.on('close',this.closing);
    window.on('closed',this.closed);
  }

  /** Apply after attach; the caller retains control of ready-to-show. */
  restore(): void {
    if (this.state.maximized && this.window && !this.window.isDestroyed()) this.window.maximize();
  }

  getPreferences(): DesktopWindowPreferences {return {closeBehavior:this.state.closeBehavior};}

  async setCloseBehavior(value: unknown): Promise<DesktopWindowPreferences> {
    if (!validBehavior(value)) throw new Error('关闭窗口行为无效');
    this.state.closeBehavior = value;
    await this.flush();
    return this.getPreferences();
  }

  show(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Explicit exits can use quit(); allowQuit() is available for a synchronous shutdown path. */
  allowQuit(): void {
    this.quitting = true;
    this.quitAllowed = true;
    this.dialogAbort?.abort();
  }

  quit(): Promise<void> {
    if (this.quitPromise) return this.quitPromise;
    this.quitting = true;
    this.dialogAbort?.abort();
    this.quitPromise = (async () => {
      try {await this.flush();} catch (error) {this.report(error);}
      try {await this.options.onFinalQuit?.();} catch (error) {this.report(error);}
      this.allowQuit();
      this.options.app.quit();
    })();
    return this.quitPromise;
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.capture();
    const snapshot = JSON.stringify({version:1,...this.state},null,2)+'\n';
    const write = this.writes.catch(() => {}).then(async () => {
      await fs.mkdir(this.options.directory,{recursive:true});
      await fs.writeFile(this.filename+'.tmp',snapshot,'utf8');
      await fs.rename(this.filename+'.tmp',this.filename);
    });
    this.writes = write;
    return write;
  }

  dispose(): void {
    this.disposed = true;
    this.dialogAbort?.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.detach();
    this.options.app.removeListener('before-quit',this.beforeQuit);
    this.tray?.destroy();
    this.tray = undefined;
  }

  private capture(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || window.isMinimized()) return;
    const bounds = rectangle(window.getNormalBounds());
    if (bounds) this.state.bounds = bounds;
    this.state.maximized = window.isMaximized();
  }

  private detach(): void {
    if (!this.window) return;
    for (const event of ['move','resize','maximize','unmaximize']) this.window.removeListener(event,this.changed);
    this.window.removeListener('close',this.closing);
    this.window.removeListener('closed',this.closed);
    this.window = undefined;
  }

  private hideToTray(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    this.capture();
    void this.flush().catch(error => this.report(error));
    try {
      if (!this.tray) {
        const tray = this.options.createTray(this.options.trayIcon);
        try {
          tray.setToolTip('SeekDesk Windows');
          tray.setContextMenu(this.options.createMenu([
            {label:'显示主窗口',click:() => this.show()},
            {type:'separator'},
            {label:'退出程序',click:() => {void this.quit();}}
          ]));
          tray.on('click',() => this.show());
          this.tray = tray;
        } catch (error) {tray.destroy();throw error;}
      }
      window.hide();
    } catch (error) {
      this.report(error);
      window.minimize();
    }
  }

  private async askClose(): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const abort = new AbortController();
    this.dialogAbort = abort;
    try {
      const choice = await this.options.dialog.showMessageBox(window,{
        type:'question',title:'关闭 SeekDesk Windows',message:'请选择关闭窗口时的操作',
        detail:'最小化到托盘后，客户端会继续运行。点击托盘图标可恢复窗口。',
        buttons:['最小化到托盘','退出程序','取消'],defaultId:0,cancelId:2,noLink:true,
        checkboxLabel:'记住我的选择',checkboxChecked:false,signal:abort.signal
      });
      if (this.quitting || this.disposed || window !== this.window || window.isDestroyed()) return;
      if (choice.response !== 0 && choice.response !== 1) return;
      if (choice.checkboxChecked) {
        this.state.closeBehavior = choice.response === 0 ? 'tray' : 'quit';
        try {await this.flush();} catch (error) {this.report(error);}
      }
      if (this.quitting || this.disposed) return;
      if (choice.response === 0) this.hideToTray();
      else await this.quit();
    } catch (error) {this.report(error);}
    finally {if (this.dialogAbort === abort) this.dialogAbort=undefined;}
  }

  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error('保存桌面窗口状态失败',error);
  }
}
