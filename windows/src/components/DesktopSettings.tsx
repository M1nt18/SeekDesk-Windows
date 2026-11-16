import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react';
import type { CloseBehavior, UpdateState } from '../../shared/desktop';
import './desktop-settings.css';

const releasesUrl = 'https://github.com/M1nt18/SeekDesk-Windows/releases';

export function DesktopCloseSettings() {
  const [behavior, setBehavior] = useState<CloseBehavior>('ask');
  const [automaticUpdates,setAutomaticUpdates]=useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const preferencesRevision = useRef(0);
  const savingPreference = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const reload = () => {
      if (savingPreference.current) return;
      const requestRevision = ++preferencesRevision.current;
      Promise.resolve().then(() => window.seekdesk.getDesktopPreferences()).then(preferences => {
        if (active && preferencesRevision.current === requestRevision) {
          setBehavior(preferences.closeBehavior);
          setAutomaticUpdates(preferences.automaticUpdates!==false);
          setError('');
        }
      }).catch(() => {
        if (active && preferencesRevision.current === requestRevision) setError('暂时无法读取窗口设置，请稍后重试。');
      }).finally(() => {
        if (active && preferencesRevision.current === requestRevision) setLoading(false);
      });
    };
    reload();
    window.addEventListener('focus', reload);
    return () => { active = false; mounted.current = false; window.removeEventListener('focus', reload); };
  }, []);

  async function save(next: CloseBehavior) {
    const requestRevision = ++preferencesRevision.current;
    savingPreference.current = true;
    setSaving(true);
    setError('');
    try {
      const preferences = await window.seekdesk.setCloseBehavior(next);
      if (mounted.current && preferencesRevision.current === requestRevision) {setBehavior(preferences.closeBehavior);setAutomaticUpdates(preferences.automaticUpdates!==false);}
    } catch {
      if (mounted.current && preferencesRevision.current === requestRevision) setError('窗口设置保存失败，请重试。');
    } finally {
      savingPreference.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function saveAutomaticUpdates(next:boolean) {
    const requestRevision=++preferencesRevision.current;
    savingPreference.current=true;setSaving(true);setError('');
    try {
      const preferences=await window.seekdesk.setAutomaticUpdates(next);
      if(mounted.current&&preferencesRevision.current===requestRevision){setBehavior(preferences.closeBehavior);setAutomaticUpdates(preferences.automaticUpdates!==false);}
    }catch{if(mounted.current&&preferencesRevision.current===requestRevision)setError('自动检查更新设置保存失败，请重试。');}
    finally{savingPreference.current=false;if(mounted.current)setSaving(false);}
  }

  return <section className="desktop-close-settings" data-testid="desktop-close-settings" aria-labelledby="desktop-close-title">
    <h2 id="desktop-close-title">桌面窗口</h2>
    <div className="setting-row">
      <div><strong id="desktop-close-label">关闭主窗口</strong><p id="desktop-close-help">选择点击窗口关闭按钮后的行为。</p></div>
      <select aria-labelledby="desktop-close-label" aria-describedby="desktop-close-help" value={behavior} disabled={loading || saving} onChange={event => void save(event.target.value as CloseBehavior)}>
        <option value="ask">每次询问</option>
        <option value="tray">最小化到托盘</option>
        <option value="quit">退出程序</option>
      </select>
    </div>
    <p className="desktop-settings-note">窗口大小和位置会自动保存，下次启动时恢复。</p>
    <div className="setting-row">
      <div><strong id="automatic-updates-label">自动检查应用更新</strong><p id="automatic-updates-help">关闭后仍可在“关于”中手动检查更新。</p></div>
      <button className={'toggle'+(automaticUpdates?' checked':'')} role="switch" aria-labelledby="automatic-updates-label" aria-describedby="automatic-updates-help" aria-checked={automaticUpdates} disabled={loading||saving} onClick={()=>void saveAutomaticUpdates(!automaticUpdates)}><span/></button>
    </div>
    {saving && <p className="desktop-settings-note" role="status">正在保存…</p>}
    {error && <p className="desktop-settings-error" role="alert">{error}</p>}
  </section>;
}

type UpdateAction = 'check' | 'apply' | 'cancel';

function updateDescription(state: UpdateState) {
  if(state.status==='downloaded'&&state.errorCode==='prepare')return '当前编辑内容未能保存，更新尚未安装，请稍后重试。';
  if(state.status==='downloaded'&&state.applying)return '更新文件已准备好，即将自动安装并重启，请稍候…';
  if(state.status==='downloaded'&&state.errorCode==='install')return '上次未能启动更新，点击“安装并重启”即可重试，无需重新下载。';
  if (state.manualOnly && state.status === 'available') return '此版本尚未提供在线更新文件，请前往发布页下载安装。';
  switch (state.status) {
    case 'idle': return state.automaticChecks===false?'自动检查已关闭，可点击“检查更新”手动查询。':'启动时会自动检查新版本，发现更新后可一键完成。';
    case 'checking': return '正在检查是否有可用的新版本…';
    case 'available': return '点击“立即更新”后将在后台下载和校验，随后自动更新并重启。';
    case 'up-to-date': return '你正在使用最新版本。';
    case 'downloading': return '正在后台下载更新，校验完成后会自动安装并重启；现在仍可取消。';
    case 'downloaded': return '更新文件已校验，点击“安装并重启”即可完成更新。';
    case 'installing': return '正在安装更新，完成后应用会自动重启，请稍候…';
    case 'cancelled': return '更新已取消，可以重新点击“立即更新”。';
    case 'unsupported': return '开发模式和免安装版请从发布页手动更新；安装版支持在线下载和安装。';
    case 'error':
      switch (state.errorCode) {
        case 'network': return '网络连接失败，请稍后重新检查。';
        case 'manifest-missing': return '暂未提供在线更新文件，请前往发布页手动下载。';
        case 'verification': return '更新文件校验失败，请重新下载。';
        case 'download': return '更新下载失败，请检查网络后重试。';
        case 'install': return '无法启动更新，请重试；已经校验的更新文件会保留。';
        case 'prepare': return '当前编辑内容未能保存，更新尚未安装，请稍后重试。';
        default: return '更新操作未完成，请稍后重试。';
      }
  }
}

function updateTitle(state: UpdateState) {
  switch (state.status) {
    case 'checking': return '正在检查更新';
    case 'available': return state.version ? `发现新版本 ${state.version}` : '发现新版本';
    case 'up-to-date': return '已是最新版本';
    case 'downloading': return '正在下载更新';
    case 'downloaded': return '更新已下载';
    case 'installing': return '正在安装更新';
    case 'cancelled': return '已取消下载';
    case 'error': return '更新暂时不可用';
    case 'unsupported': return '请手动更新';
    default: return '在线更新';
  }
}

function formatBytes(bytes: number) {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  return safe >= 1024 * 1024 ? `${(safe / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(safe / 1024)} KB`;
}

export function DesktopUpdateCard({ version, onExternal }: { version: string; onExternal: (url: string) => void }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle', currentVersion: version, installable: false });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<UpdateAction | null>(null);
  const [actionError, setActionError] = useState('');
  const mounted = useRef(true);
  const revision = useRef(0);
  const actionRevision = useRef(0);
  const inFlight = useRef(new Set<UpdateAction>());

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const initialRevision = revision.current;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.seekdesk.onUpdateChange(next => {
        revision.current += 1;
        if (active) { setState(next); setActionError(''); }
      });
      window.seekdesk.getUpdateState().then(next => {
        if (active && revision.current === initialRevision) setState(next);
      }).catch(() => {
        if (active && revision.current === initialRevision) setActionError('暂时无法读取更新状态，请点击检查更新重试。');
      }).finally(() => {
        if (active) setLoading(false);
      });
    } catch {
      setState({ status: 'unsupported', currentVersion: version, installable: false });
      setLoading(false);
    }
    return () => { active = false; mounted.current = false; actionRevision.current += 1; revision.current += 1; unsubscribe?.(); };
  }, [version]);

  async function act(action: UpdateAction) {
    if (inFlight.current.has(action)) return;
    inFlight.current.add(action);
    const request = ++actionRevision.current;
    const initialRevision = revision.current;
    setPending(action);
    setActionError('');
    try {
      const operations = { check: 'checkUpdates', apply: 'applyUpdate', cancel: 'cancelUpdate' } as const;
      const next = await window.seekdesk[operations[action]]();
      if (mounted.current && actionRevision.current === request && revision.current === initialRevision) setState(next);
    } catch {
      if (mounted.current && actionRevision.current === request && revision.current === initialRevision) setActionError(({ check: '检查更新失败，请检查网络后重试。', apply: '更新未能完成，请稍后重试。', cancel: '取消下载失败，请重试。' })[action]);
    } finally {
      inFlight.current.delete(action);
      if (mounted.current && actionRevision.current === request) setPending(null);
    }
  }

  const downloading = state.status === 'downloading';
  const checking = state.status === 'checking';
  const installing = state.status === 'installing';
  const applying = state.applying === true;
  const canDownload = !applying && state.installable && !state.manualOnly && ['available', 'cancelled', 'error'].includes(state.status) && (state.canDownload ?? (['download','verification'].includes(state.errorCode||'download') && Boolean(state.version)));
  const percent = Math.max(0, Math.min(100, Number.isFinite(state.progress?.percent) ? state.progress!.percent : 0));
  const safeReleaseUrl = /^https:\/\/github\.com\/M1nt18\/SeekDesk-Windows\/releases(?:\/|$)/i.test(state.releaseUrl || '') ? state.releaseUrl! : releasesUrl;
  const StatusIcon = state.status === 'error' || state.status === 'unsupported' || state.manualOnly ? AlertCircle : state.status === 'downloaded' || state.status === 'up-to-date' ? CheckCircle2 : RefreshCw;

  return <section className="desktop-update-card" data-testid="desktop-update-card" aria-labelledby="desktop-update-title">
    <div className="desktop-update-heading"><StatusIcon size={19} className={checking || downloading ? 'spin' : ''} aria-hidden="true"/><div><h2 id="desktop-update-title">{updateTitle(state)}</h2><p>当前版本 {state.currentVersion || version}{state.version && state.version !== (state.currentVersion||version) && state.status !== 'up-to-date' ? ` · 发布版本 ${state.version}` : ''}</p></div></div>
    <p className="desktop-update-description" role="status" aria-live="polite">{loading ? '正在读取更新状态…' : updateDescription(state)}</p>
    {downloading && <div className="desktop-update-progress">
      <progress aria-label="更新下载进度" max={100} value={percent}/>
      <div><span>{percent.toFixed(1)}%</span>{state.progress && <span>{formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)} · {formatBytes(state.progress.bytesPerSecond)}/s</span>}</div>
    </div>}
    <div className="desktop-update-actions">
      {state.status === 'downloaded' && state.installable && !state.manualOnly && <button className="primary-button" disabled={Boolean(pending) || applying} onClick={() => void act('apply')}><RotateCw size={16}/>{applying ? '正在准备安装…' : pending === 'apply' ? '正在安装…' : '安装并重启'}</button>}
      {canDownload && <button className="primary-button" disabled={Boolean(pending) || loading} onClick={() => void act('apply')}><Download size={16}/>{pending === 'apply' ? '正在开始更新…' : '立即更新'}</button>}
      {downloading && <button className="secondary-button" disabled={pending === 'cancel'} onClick={() => void act('cancel')}>{pending === 'cancel' ? '正在取消…' : '取消下载'}</button>}
      {!downloading && !installing && state.status !== 'downloaded' && <button className="secondary-button" disabled={loading || Boolean(pending) || checking} onClick={() => void act('check')}><RefreshCw size={16} className={checking ? 'spin' : ''}/>{checking ? '正在检查…' : '检查更新'}</button>}
      {(state.manualOnly || state.status === 'unsupported' || state.errorCode === 'manifest-missing') && <button className="text-button" onClick={() => onExternal(safeReleaseUrl)}>前往发布页<ExternalLink size={15}/></button>}
    </div>
    {actionError && <p className="desktop-settings-error" role="alert">{actionError}</p>}
    {state.installable && !state.manualOnly && <p className="desktop-settings-note desktop-update-consent">后台下载并校验，完成后自动更新和重启，请先保存正在编辑的内容。</p>}
    <p className="desktop-settings-note">过期的更新文件会自动清理。</p>
  </section>;
}
