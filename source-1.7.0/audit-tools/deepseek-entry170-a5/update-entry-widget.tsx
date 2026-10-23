import { createRoot, type Root } from 'react-dom/client';
import EmployeeUpdate from './employee-update';

const HOST_ID = 'xjy-update-entry-host';
const PANEL_ID = 'xjy-update-entry-panel';
const FALLBACK = '本机版本尚未提供自动升级入口，请联系管理员。';

let panelRoot: Root | null = null;
function desktop(): any { return (window as any).jewelryDesktop; }
function isBrowserSurface(): boolean { return desktop()?.surface === 'browser'; }
function bridgeReady(b: any): boolean {
  return !!b && typeof b.getEmployeeUpdateCapability === 'function'
    && typeof b.getEmployeeUpdateState === 'function' && typeof b.employeeUpdate === 'function';
}
function closePanel(): void {
  if (panelRoot) { const r = panelRoot; panelRoot = null; r.unmount(); }
  const slot = document.getElementById(PANEL_ID);
  if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
}
function plainNotice(text: string): void {
  const old = document.getElementById(PANEL_ID + '-notice');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  const n = document.createElement('div');
  n.id = PANEL_ID + '-notice';
  n.setAttribute('role', 'status');
  n.textContent = text;
  n.style.cssText = 'position:fixed;right:18px;bottom:62px;z-index:2147483000;max-width:300px;padding:8px 12px;background:#fff;border:1px solid #e4dac9;border-radius:8px;font:13px/1.6 "Microsoft YaHei",sans-serif;color:#5c574f;';
  document.body.appendChild(n);
  window.setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 5000);
}
function existingOverlay(): HTMLElement | null {
  const node = document.querySelector('.employee-update-overlay');
  return node instanceof HTMLElement ? node : null;
}
function focusExisting(overlay: HTMLElement): void {
  const dialog = overlay.querySelector('section[role="dialog"]');
  const target = (dialog instanceof HTMLElement ? dialog : overlay);
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch { /* 焦点失败不影响已有面板 */ }
  try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { }
}
function openPanel(): void {
  const existing = existingOverlay();
  if (existing) { focusExisting(existing); return; }
  if (panelRoot || document.getElementById(PANEL_ID)) return;
  if (!bridgeReady(desktop())) { plainNotice(FALLBACK); return; }
  const slot = document.createElement('div');
  slot.id = PANEL_ID;
  document.body.appendChild(slot);
  panelRoot = createRoot(slot);
  panelRoot.render(<EmployeeUpdate onClose={closePanel} mobileSurface={false} />);
}
function avoidOverlap(host: HTMLElement): void {
  try {
    const rect = host.getBoundingClientRect();
    const nodes = document.querySelectorAll('.auth-footer, [class*="version"], footer');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as HTMLElement;
      if (el === host) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top) { host.style.bottom = '76px'; return; }
    }
  } catch { /* 布局探测失败不影响功能 */ }
}
export function mountUpdateEntry(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return;
  if (isBrowserSurface()) return;
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-xjy-update-entry', 'v1');
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '一键升级';
  button.setAttribute('data-testid', 'login-update-entry');
  button.setAttribute('aria-label', '一键升级');
  button.style.cssText = 'font:13px/1.6 "Microsoft YaHei",sans-serif;padding:6px 14px;border:1px solid #ad8550;border-radius:14px;background:#fff;color:#7a4f24;cursor:pointer;';
  button.addEventListener('click', openPanel);
  host.appendChild(button);
  document.body.appendChild(host);
  avoidOverlap(host);
  (window as any).__xjyUpdateEntry = { mounted: true, mount: mountUpdateEntry, dispose: () => { closePanel(); const el = document.getElementById(HOST_ID); if (el && el.parentNode) el.parentNode.removeChild(el); } };
}
mountUpdateEntry();