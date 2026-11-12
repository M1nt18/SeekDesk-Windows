import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react';
import type { CloseBehavior, UpdateState } from '../../shared/desktop';
import './desktop-settings.css';

const releasesUrl = 'https://github.com/M1nt18/SeekDesk-Windows/releases';

export function DesktopCloseSettings() {
  const [behavior, setBehavior] = useState<CloseBehavior>('ask');
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
      if (mounted.current && preferencesRevision.current === requestRevision) setBehavior(preferences.closeBehavior);
    } catch {
      if (mounted.current && preferencesRevision.current === requestRevision) setError('窗口设置保存失败，请重试。');
    } finally {
      savingPreference.current = false;
      if (mounted.current) setSaving(false);
    }
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
    {saving && <p className="desktop-settings-note" role="status">正在保存…</p>}
    {error && <p className="desktop-settings-error" role="alert">{error}</p>}
  </section>;
}

type UpdateAction = 'check' | 'download' | 'cancel' | 'install';

function updateDescription(state: UpdateState) {
  if(state.status==='downloaded'&&state.errorCode==='install')return '上次未能启动安装程序，可以重试或前往发布页手动安装。';
  if (state.manualOnly && state.status === 'available') return '此版本尚未提供在线更新文件，请前往发布页下载安装。';
  switch (state.status) {
    case 'idle': return '启动时会自动检查更新，下载和安装由你决定。';
    case 'checking': return '正在检查是否有可用的新版本…';
    case 'available': return '新版本已发布，点击下载后开始获取更新。';
    case 'up-to-date': return '你正在使用最新版本。';
    case 'downloading': return '下载期间可以继续使用，也可以随时取消。';
    case 'downloaded': return '更新文件已准备好，重启后开始安装。';
    case 'installing': return '正在准备安装，请完成系统显示的安装步骤。';
    case 'cancelled': return '下载已取消，可以重新下载。';
    case 'unsupported': return '开发模式和免安装版请从发布页手动更新；安装版支持在线下载和安装。';
    case 'error':
      switch (state.errorCode) {
        case 'network': return '网络连接失败，请稍后重新检查。';
        case 'manifest-missing': return '暂未提供在线更新文件，请前往发布页手动下载。';
        case 'verification': return '更新文件校验失败，请重新下载。';
        case 'download': return '更新下载失败，请检查网络后重试。';
        case 'install': return '无法启动安装，请重试或前往发布页手动安装。';
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
    case 'installing': return '正在准备安装';
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
        if (active) setActionError('暂时无法读取更新状态，请点击检查更新重试。');
      }).finally(() => {
        if (active) setLoading(false);
      });
    } catch {
      setState({ status: 'unsupported', currentVersion: version, installable: false });
      setLoading(false);
    }
    return () => { active = false; mounted.current = false; unsubscribe?.(); };
  }, [version]);

  async function act(action: UpdateAction) {
    const initialRevision = revision.current;
    setPending(action);
    setActionError('');
    try {
      const operations = { check: 'checkUpdates', download: 'downloadUpdate', cancel: 'cancelUpdate', install: 'installUpdate' } as const;
      const next = await window.seekdesk[operations[action]]();
      if (mounted.current && revision.current === initialRevision) setState(next);
    } catch {
      if (mounted.current && revision.current === initialRevision) setActionError(({ check: '检查更新失败，请检查网络后重试。', download: '下载未能开始，请稍后重试。', cancel: '取消下载失败，请重试。', install: '无法启动安装，请重试或前往发布页手动安装。' })[action]);
    } finally {
      if (mounted.current) setPending(current => current === action ? null : current);
    }
  }

  const downloading = state.status === 'downloading';
  const checking = state.status === 'checking';
  const installing = state.status === 'installing';
  const canDownload = state.canDownload ?? (state.installable && !state.manualOnly && ['available', 'cancelled', 'error'].includes(state.status) && ['download','verification'].includes(state.errorCode||'download') && Boolean(state.version));
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
      {state.status === 'downloaded' && state.installable && <button className="primary-button" disabled={Boolean(pending)} onClick={() => void act('install')}><RotateCw size={16}/>{pending === 'install' ? '正在准备安装…' : '重启并安装'}</button>}
      {canDownload && <button className="primary-button" disabled={Boolean(pending) || loading} onClick={() => void act('download')}><Download size={16}/>{pending === 'download' ? '正在开始下载…' : '下载更新'}</button>}
      {downloading && <button className="secondary-button" disabled={pending === 'cancel'} onClick={() => void act('cancel')}>{pending === 'cancel' ? '正在取消…' : '取消下载'}</button>}
      {!downloading && !installing && state.status !== 'downloaded' && <button className="secondary-button" disabled={loading || Boolean(pending) || checking} onClick={() => void act('check')}><RefreshCw size={16} className={checking ? 'spin' : ''}/>{checking ? '正在检查…' : '检查更新'}</button>}
      {(state.manualOnly || state.status === 'unsupported' || state.status === 'error') && <button className="text-button" onClick={() => onExternal(safeReleaseUrl)}>前往发布页<ExternalLink size={15}/></button>}
    </div>
    {actionError && <p className="desktop-settings-error" role="alert">{actionError}</p>}
    <p className="desktop-settings-note">下载和安装都需要手动操作。安装确认前请保存正在编辑的内容；过期的更新文件会自动清理。</p>
  </section>;
}
