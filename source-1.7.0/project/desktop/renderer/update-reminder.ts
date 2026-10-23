export type UpdateReminder = { version: string; message: string };
type UpdateBridge = {
  getEmployeeUpdateCapability?: () => Promise<{ supported: boolean; canInstall: boolean; currentVersion: string }>;
  employeeUpdate?: (input: { intent: 'check' }) => Promise<{ ok: boolean; state: { phase: string; currentVersion: string; targetVersion?: string; message?: string } }>;
};

// A reminder only checks metadata. The visible upgrade action owns download,
// signature verification, backup and safe application shutdown.
export function createUpdateReminder({ bridge, onChange }: { bridge?: UpdateBridge; onChange: (value: UpdateReminder | null) => void }) {
  let alive = true, pending = false, announced: string | null = null;
  function newer(target: unknown, current: unknown): target is string {
    const valid = (value: unknown): value is string => typeof value === 'string' && /^1\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);
    if (!valid(target) || !valid(current)) return false;
    const next = target.split('.').map(Number), old = current.split('.').map(Number);
    for (let index = 0; index < next.length; index++) if (next[index] !== old[index]) return next[index] > old[index];
    return false;
  }
  return {
    async check() {
      if (!alive || pending || !bridge?.getEmployeeUpdateCapability || !bridge.employeeUpdate) return;
      pending = true;
      try {
        const capability = await bridge.getEmployeeUpdateCapability();
        if (!alive || !capability.supported || !capability.canInstall) return;
        const result = await bridge.employeeUpdate({ intent: 'check' });
        if (!alive || !result.ok) return;
        const status = result.state;
        if (['available', 'ready'].includes(status.phase) && status.currentVersion === capability.currentVersion && newer(status.targetVersion, capability.currentVersion)) {
          if (announced !== status.targetVersion) {
            announced = status.targetVersion;
            onChange({ version: status.targetVersion, message: status.message || '发现新版本，可在软件内一键升级。' });
          }
        } else if (status.phase === 'latest' && announced !== null) { announced = null; onChange(null); }
      } catch { /* Offline checks never interrupt business forms; the next tick can retry. */ }
      finally { pending = false; }
    },
    dispose() { alive = false; }
  };
}
