import { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { EmployeeUpdateCapability, EmployeeUpdatePhase, EmployeeUpdateState } from './bridge';
import './employee-update.css';

type UpdateBridge = Pick<Window['jewelryDesktop'], 'getEmployeeUpdateCapability'|'getEmployeeUpdateState'|'employeeUpdate'>;
type PanelState = { loading: boolean; busy: boolean; capability: EmployeeUpdateCapability|null; status: EmployeeUpdateState; error: string; mobile: boolean };
const busyPhases: EmployeeUpdatePhase[] = ['checking', 'downloading', 'verifying', 'installing', 'handoff'];
const initialState = (mobile: boolean): PanelState => ({ loading: true, busy: false, capability: null, status: { phase: 'idle', currentVersion: '', message: '正在读取本机升级状态…' }, error: '', mobile });

// The same model drives the view and tests. It sends no path, role, key or URL.
export function createEmployeeUpdatePanelController({ bridge, onChange, mobileSurface = false, refreshPage }: { bridge: UpdateBridge|undefined; onChange: (state: PanelState) => void; mobileSurface?: boolean; refreshPage: () => void }) {
  let alive = true, state = initialState(mobileSurface), pending = false, revision = 0;
  const change = (next: Partial<PanelState>) => { if (alive) { state = { ...state, ...next }; onChange({ ...state, status: { ...state.status } }); } };
  async function execute(intent: 'check'|'download'|'install', recheckLatest = false) {
    if (!alive || pending || state.busy || !state.capability?.canInstall || mobileSurface || !bridge?.employeeUpdate) return;
    pending = true; revision++; change({ busy: true, error: '' });
    try {
      // The native install intent already performs its own signature check,
      // download and verification. Recheck only a previously cached latest result.
      let result = await bridge.employeeUpdate({ intent: recheckLatest ? 'check' : intent });
      if (!alive) return;
      if (recheckLatest && result.ok && ['available','ready'].includes(result.state.phase)) {
        change({ status: result.state, busy: true, error: '' });
        result = await bridge.employeeUpdate({ intent: 'install' });
        if (!alive) return;
      }
      change({ status: result.state, busy: result.ok && busyPhases.includes(result.state.phase), error: result.ok ? '' : result.error || '升级未完成，请稍后重试。' });
    } catch { change({ busy: false, error: '升级请求未完成，请检查主机连接后重试。原程序保持不变。' }); }
    finally { pending = false; revision++; }
  }
  return {
    async load() {
      if (!alive || pending) return;
      if (mobileSurface) {
        change({ loading: false, capability: { supported: false, canInstall: false, currentVersion: '', message: '手机使用网页版本，刷新页面即可读取主机的最新页面。' }, status: { phase: 'idle', currentVersion: '', message: '手机无需安装 Windows 程序。' } }); return;
      }
      if (!bridge?.getEmployeeUpdateCapability || !bridge.getEmployeeUpdateState || !bridge.employeeUpdate) {
        change({ loading: false, capability: { supported: false, canInstall: false, currentVersion: '', message: '本机版本尚未提供自动升级入口，请联系管理员。' }, status: { phase: 'idle', currentVersion: '', message: '本机版本尚未提供自动升级入口，请联系管理员。' } }); return;
      }
      try {
        const capability = await bridge.getEmployeeUpdateCapability();
        if (!alive) return;
        if (!capability.supported || !capability.canInstall) { change({ loading: false, capability, error: '', status: { phase: 'idle', currentVersion: capability.currentVersion || '', message: capability.message } }); return; }
        const status = await bridge.getEmployeeUpdateState();
        change({ loading: false, capability, status, busy: busyPhases.includes(status.phase), error: '' });
      } catch { change({ loading: false, error: '暂时无法读取升级状态，请稍后重试。' }); }
    },
    async poll() {
      if (!alive || mobileSurface || !bridge?.getEmployeeUpdateState || !state.capability?.canInstall) return;
      const turn = revision;
      try { const status = await bridge.getEmployeeUpdateState(); if (alive && turn === revision) change({ status, busy: pending || busyPhases.includes(status.phase) }); } catch { /* A pending native operation still owns its actual result. */ }
    },
    run: execute,
    async upgrade() { if (!alive) return; if (mobileSurface) { refreshPage(); return; } return execute('install', state.status.phase === 'latest'); },
    refresh() { if (alive && mobileSurface) refreshPage(); },
    dispose() { alive = false; }
  };
}

type EmployeeUpdatePresentation = {
  kind: 'determinate'|'indeterminate'|'none'; percent: number|null; label: string;
  stage: EmployeeUpdatePhase|'reading'; complete: boolean;
};

export function getEmployeeUpdatePresentation(status: EmployeeUpdateState, loading = false): EmployeeUpdatePresentation {
  if (loading) return { kind: 'indeterminate', percent: null, label: '正在读取本机升级状态…', stage: 'reading', complete: false };
  const stage = status.phase;
  if (stage === 'downloading') {
    const { received, total } = status;
    if (typeof received === 'number' && Number.isFinite(received) && typeof total === 'number' && Number.isFinite(total) && total > 0 && received >= 0 && received <= total) {
      return { kind: 'determinate', percent: Math.floor((received / total) * 100), label: '更新包下载中', stage, complete: false };
    }
    return { kind: 'indeterminate', percent: null, label: '正在下载更新包，等待可用进度', stage, complete: false };
  }
  const labels: Record<EmployeeUpdatePhase, string> = {
    idle: '等待开始升级', checking: '正在检查可用更新', available: '发现可升级的新版本',
    latest: '已是当前最新版本', downloading: '更新包下载中', verifying: '正在校验更新包签名和文件',
    ready: '更新包已校验，可交给更新助手', installing: '正在交给更新助手',
    handoff: '更新助手已接收，请等待正常重启', error: '升级未完成，请查看提示后重试',
    unavailable: '当前尚未提供可用更新',
  };
  return { kind: ['checking', 'verifying', 'installing', 'handoff'].includes(stage) ? 'indeterminate' : 'none',
    percent: null, label: labels[stage] || '暂时无法读取升级状态', stage, complete: stage === 'latest' };
}

const updateSteps = ['检查发布', '下载更新包', '校验文件', '交给助手'];
const updateStepIndex: Partial<Record<EmployeeUpdatePresentation['stage'], number>> = {
  checking: 0, downloading: 1, verifying: 2, ready: 3, installing: 3, handoff: 4,
};

function byteLabel(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export default function EmployeeUpdate({ onClose, mobileSurface = false }: { onClose: () => void; mobileSurface?: boolean }) {
  const [state, setState] = useState<PanelState>(() => initialState(mobileSurface));
  const controller = useMemo(() => createEmployeeUpdatePanelController({ bridge: window.jewelryDesktop, onChange: setState, mobileSurface, refreshPage: () => window.location.reload() }), [mobileSurface]);
  useEffect(() => { void controller.load(); return () => controller.dispose(); }, [controller]);
  useEffect(() => {
    if (!state.busy) return;
    const timer = window.setInterval(() => { void controller.poll(); }, 1000);
    return () => window.clearInterval(timer);
  }, [state.busy, controller]);
  const { status, capability } = state;
  const presentation = getEmployeeUpdatePresentation(status, state.loading);
  const stepIndex = updateStepIndex[presentation.stage];
  const currentVersion = status.currentVersion || capability?.currentVersion;
  const blockedMessage = status.code === 'ACCOUNT_CHANGED' ? '请重新进入员工账号后升级。' : status.code === 'CANCEL_FAILED' ? '请保持程序打开并联系管理员。' : '';
  const errorMessage = blockedMessage || state.error || (status.phase === 'error' ? status.message : '');
  const actionLabel = blockedMessage ? '暂不可重试' : errorMessage ? '重试升级' : presentation.complete ? '检查更新' : '开始升级';
  const stageMessage = mobileSurface ? status.message : !state.loading && capability && !capability.canInstall ? capability.message || status.message || presentation.label : presentation.label;
  const showDetail = !state.loading && capability?.canInstall && status.phase !== 'downloading' && !errorMessage && status.message && status.message !== presentation.label;
  return <div className="employee-update-overlay" role="presentation">
    <section className="employee-update-panel" role="dialog" aria-modal="true" aria-labelledby="employee-update-title" data-stage={presentation.stage}>
      <header><div><span className="employee-update-eyebrow">XIN JIN YUAN · WORKSPACE</span><h2 id="employee-update-title">{mobileSurface ? '更新页面' : '员工一键升级'}</h2></div><button type="button" className="employee-update-close" aria-label={state.busy ? '收起升级窗口' : '关闭升级窗口'} onClick={onClose}><X size={19}/></button></header>
      <div className="employee-update-body">
        <div className={`employee-update-symbol${presentation.complete ? ' complete' : ''}${presentation.stage === 'ready' ? ' verified' : ''}`} aria-hidden="true">{state.loading || state.busy ? <Loader2 className="employee-update-spinner" size={28}/> : presentation.complete ? <CheckCircle2 size={28}/> : presentation.stage === 'ready' ? <ShieldCheck size={28}/> : <ArrowUpCircle size={28}/>}</div>
        <p className="employee-update-message" role="status" aria-live="polite" aria-atomic="true">{stageMessage}</p>
        {showDetail && <p className="employee-update-detail">{status.message}</p>}
        {currentVersion && <div className="employee-update-versions"><span>当前版本 <strong>{currentVersion}</strong></span>{status.targetVersion && status.targetVersion !== currentVersion && <span>目标版本 <strong>{status.targetVersion}</strong></span>}</div>}
        {!mobileSurface && stepIndex !== undefined && <ol className="employee-update-steps" aria-label="升级阶段">
          {updateSteps.map((label, index) => {
            const done = index < stepIndex, current = index === stepIndex && presentation.stage !== 'ready';
            return <li key={label} className={done ? 'done' : current ? 'current' : ''} aria-current={current ? 'step' : undefined}><span className="employee-update-step-dot" aria-hidden="true">{done ? <CheckCircle2 size={14}/> : index + 1}</span><span><span className="employee-update-sr-only">{done ? '已到达：' : current ? '当前阶段：' : '等待：'}</span>{label}</span></li>;
          })}
        </ol>}
        {!mobileSurface && presentation.kind !== 'none' && <div className={`employee-update-progress ${presentation.kind}`}>
          <div className="employee-update-progress-heading"><span>{presentation.stage === 'downloading' ? '更新包下载' : '当前阶段'}</span><strong aria-hidden="true">{presentation.percent === null ? '处理中' : `${presentation.percent}%`}</strong></div>
          <progress className="employee-update-sr-only" aria-label={presentation.stage === 'downloading' ? '更新包下载进度' : '升级当前阶段进度'} aria-valuetext={presentation.percent === null ? presentation.label : `更新包已下载 ${presentation.percent}%`} max={100} value={presentation.percent ?? undefined}/>
          <div className="employee-update-progress-track" aria-hidden="true"><span className="employee-update-progress-indicator" style={presentation.kind === 'determinate' ? { transform: `scaleX(${presentation.percent! / 100})` } : undefined}/></div>
          <div className="employee-update-progress-meta">{presentation.kind === 'determinate' ? <span>已下载 {byteLabel(status.received!)} / 总计 {byteLabel(status.total!)}</span> : <span>请按提示等待，这一阶段不显示百分比。</span>}</div>
        </div>}
        {!mobileSurface && <p className="employee-update-safety"><ShieldCheck size={17}/><span>请先保存正在编辑的内容。更新包校验后交给助手，按原流程备份并更新；请按提示等待程序正常重启。</span></p>}
        {errorMessage && <p className="employee-update-error" role="alert">{errorMessage}</p>}
        {!state.loading && !capability?.canInstall && !mobileSurface && <p className="employee-update-muted">{capability?.message}</p>}
      </div>
      <footer>
        <button type="button" className="employee-update-secondary" onClick={onClose}>{state.busy ? '收起窗口' : '关闭'}</button>
        {mobileSurface ? <button type="button" className="employee-update-primary" onClick={() => controller.refresh()}><RefreshCw size={17}/>刷新页面</button> : capability?.canInstall && <button type="button" className="employee-update-primary" disabled={state.loading || state.busy || Boolean(blockedMessage)} onClick={() => { void controller.upgrade(); }}>{state.busy ? <Loader2 className="employee-update-spinner" size={17}/> : <ArrowUpCircle size={17}/>} {state.busy ? '正在处理' : actionLabel}</button>}
      </footer>
    </section>
  </div>;
}
