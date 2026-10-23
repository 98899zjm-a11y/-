import { useLayoutEffect, useRef, type RefObject } from "react";

type ModalKind = "dialog" | "drawer";
type ModalEntry = {
  root: HTMLElement;
  surface: HTMLElement;
  scope: HTMLElement | null;
  trigger: HTMLElement | null;
  close: RefObject<() => void>;
  ordinary: boolean;
  originalZ: string;
  originalZPriority: string;
  writtenZ: string | null;
  lastFocus: HTMLElement | null;
  removed: boolean;
};
type ModalManager = {
  document: Document;
  entries: Set<ModalEntry>;
  revision: number;
  lastOwner: HTMLElement | null;
  overflow: { value: string; priority: string } | null;
  observer: MutationObserver | null;
  keydown: (event: KeyboardEvent) => void;
  focusin: (event: FocusEvent) => void;
};

const managers = new WeakMap<Document, ModalManager>();
const tabbableSelector = "button,input,select,textarea,a[href],summary,[tabindex],[contenteditable='true']";

function htmlElement(value: Element | EventTarget | null): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}

function visible(node: HTMLElement): boolean {
  if (!node.isConnected || !node.getClientRects().length) return false;
  if (node.matches("input[type='hidden']")) return false;
  for (let at: HTMLElement | null = node; at; at = at.parentElement) {
    if (at.hidden || at.inert || at.getAttribute("aria-hidden") === "true") return false;
    const style = at.ownerDocument.defaultView?.getComputedStyle(at);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
  }
  return true;
}

function available(node: HTMLElement | null): node is HTMLElement {
  return !!node && visible(node) && !node.matches(":disabled");
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(tabbableSelector)]
    .filter(node => available(node) && node.tabIndex >= 0)
    .map((node, order) => ({ node, order }))
    .sort((a, b) => {
      const first = a.node.tabIndex > 0, second = b.node.tabIndex > 0;
      return first !== second ? first ? -1 : 1 : first && a.node.tabIndex !== b.node.tabIndex ? a.node.tabIndex - b.node.tabIndex : a.order - b.order;
    })
    .map(item => item.node);
}

// Known dialogs may be body Portals or descendants of their fixed backdrop.
// Compare explicit ancestor stacking levels before document paint order.
function layerPath(root: HTMLElement): number[] {
  const result: number[] = [];
  for (let at: HTMLElement | null = root; at; at = at.parentElement) {
    const style = at.ownerDocument.defaultView?.getComputedStyle(at);
    if (!style || style.zIndex === "auto") continue;
    const value = Number(style.zIndex);
    if (Number.isFinite(value)) result.unshift(value);
  }
  return result;
}

function topModal(document: Document): HTMLElement | null {
  const roots = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(visible);
  roots.sort((a, b) => {
    const first = layerPath(a), second = layerPath(b);
    for (let index = 0; index < Math.max(first.length, second.length); index++) {
      const difference = (first[index] || 0) - (second[index] || 0);
      if (difference) return difference;
    }
    // DOCUMENT_POSITION_FOLLOWING (4): later sibling paints above at equal z.
    return a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1;
  });
  return roots.at(-1) || null;
}

function ignoredKey(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229;
}

/** Guard for existing external modal listeners; their own callbacks stay intact. */
export function canHandleModalKey(event: KeyboardEvent, root: HTMLElement | null): boolean {
  return !!root && !ignoredKey(event) && topModal(root.ownerDocument) === root;
}

function focus(node: HTMLElement | null): boolean {
  if (!available(node)) return false;
  try { node.focus({ preventScroll: true }); }
  catch { try { node.focus(); } catch { return false; } }
  return node.ownerDocument.activeElement === node;
}

function safeTarget(entry: ModalEntry): HTMLElement {
  const close = entry.root.querySelector<HTMLElement>("[data-modal-close]");
  return available(close) ? close : entry.root;
}

function focusEntry(entry: ModalEntry, preferred: HTMLElement | null = null): void {
  if (preferred && entry.root.contains(preferred) && focus(preferred)) return;
  const active = htmlElement(entry.root.ownerDocument.activeElement);
  if (available(active) && entry.root.contains(active)) return;
  if (entry.lastFocus && entry.root.contains(entry.lastFocus) && focus(entry.lastFocus)) return;
  focus(safeTarget(entry));
}

function setInlineZ(entry: ModalEntry, value: string): void {
  if (entry.surface.style.getPropertyValue("z-index") === value && entry.surface.style.getPropertyPriority("z-index") === entry.originalZPriority) return;
  if (value) entry.surface.style.setProperty("z-index", value, entry.originalZPriority);
  else entry.surface.style.removeProperty("z-index");
}

function updateLayers(manager: ModalManager): void {
  const ordinary = [...manager.entries].filter(entry => entry.ordinary && visible(entry.root));
  const front = ordinary.at(-1);
  for (const entry of manager.entries) {
    if (!entry.ordinary) continue;
    const value = entry === front ? "110" : entry.originalZ;
    setInlineZ(entry, value);
    entry.writtenZ = value;
  }
}

function restoreLayer(entry: ModalEntry): void {
  if (!entry.ordinary || entry.writtenZ === null) return;
  if (entry.surface.style.getPropertyValue("z-index") === entry.writtenZ
      && entry.surface.style.getPropertyPriority("z-index") === entry.originalZPriority) setInlineZ(entry, entry.originalZ);
}

function entryFor(manager: ModalManager, root: HTMLElement | null): ModalEntry | undefined {
  return [...manager.entries].find(entry => entry.root === root);
}

function refresh(manager: ModalManager, enter: boolean): void {
  if (!manager.entries.size) { manager.lastOwner = null; return; }
  updateLayers(manager);
  const owner = topModal(manager.document), changed = manager.lastOwner !== owner;
  manager.lastOwner = owner;
  const entry = entryFor(manager, owner);
  if (enter && changed && entry) focusEntry(entry);
}

function createManager(document: Document): ModalManager {
  const manager: ModalManager = {
    document, entries: new Set(), revision: 0, lastOwner: null, overflow: null, observer: null,
    keydown(event) {
      if (ignoredKey(event)) return;
      refresh(manager, false);
      const owner = topModal(document), entry = entryFor(manager, owner);
      if (!entry) return;
      if (event.key === "Escape") {
        // Mark consumed before a synchronous close can unmount/reveal another layer.
        event.preventDefault();
        entry.close.current();
      } else if (event.key === "Tab") {
        const controls = tabbables(entry.root), active = htmlElement(document.activeElement);
        const at = active ? controls.indexOf(active) : -1;
        if (!controls.length) { event.preventDefault(); focus(entry.root); }
        else if (at < 0 || event.shiftKey && at === 0 || !event.shiftKey && at === controls.length - 1) {
          event.preventDefault(); focus(event.shiftKey ? controls[controls.length - 1] : controls[0]);
        }
      }
    },
    focusin(event) {
      const target = htmlElement(event.target);
      // React commits a child's autoFocus before its parent's layout effect.
      // A newly committed managed root must be allowed to register first.
      const incoming = target?.closest<HTMLElement>("[data-xjy-modal]") || null;
      if (incoming && !entryFor(manager, incoming)) return;
      const owner = topModal(document), entry = entryFor(manager, owner);
      if (!entry || !target) return;
      if (entry.root.contains(target)) entry.lastFocus = target;
      else focusEntry(entry);
    },
  };
  return manager;
}

function acquire(manager: ModalManager): void {
  const body = manager.document.body;
  manager.overflow = { value: body.style.getPropertyValue("overflow"), priority: body.style.getPropertyPriority("overflow") };
  body.style.setProperty("overflow", "hidden", manager.overflow.priority);
  manager.document.addEventListener("keydown", manager.keydown);
  manager.document.addEventListener("focusin", manager.focusin);
  manager.observer = new MutationObserver(() => refresh(manager, true));
  manager.observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden", "aria-modal"] });
}

function release(manager: ModalManager): void {
  manager.document.removeEventListener("keydown", manager.keydown);
  manager.document.removeEventListener("focusin", manager.focusin);
  manager.observer?.disconnect(); manager.observer = null;
  manager.lastOwner = null;
  const body = manager.document.body, previous = manager.overflow;
  // Do not overwrite a different lock/style subsequently written by another owner.
  if (previous && body.style.getPropertyValue("overflow") === "hidden" && body.style.getPropertyPriority("overflow") === previous.priority) {
    if (previous.value) body.style.setProperty("overflow", previous.value, previous.priority);
    else body.style.removeProperty("overflow");
  }
  manager.overflow = null;
}

function restoreFocus(manager: ModalManager, entry: ModalEntry, wasOwner: boolean, revision: number): void {
  if (manager.revision !== revision || !wasOwner) return;
  const owner = topModal(manager.document), parent = entryFor(manager, owner);
  if (owner) {
    if (parent) focusEntry(parent, entry.trigger);
    return;
  }
  const active = htmlElement(manager.document.activeElement);
  // A route/login transition that already chose a live focus target owns it.
  if (active && active !== manager.document.body && active !== manager.document.documentElement && active.isConnected && !entry.root.contains(active)) return;
  if (!entry.scope || !visible(entry.scope)) return;
  if (entry.trigger && entry.scope.contains(entry.trigger) && focus(entry.trigger)) return;
  const fallback = entry.scope.querySelector<HTMLElement>(".sidebar a.active, .page-header button, .page-header a");
  if (focus(fallback)) return;
  const oldTabIndex = entry.scope.getAttribute("tabindex");
  entry.scope.tabIndex = -1;
  focus(entry.scope);
  if (oldTabIndex === null) entry.scope.removeAttribute("tabindex");
  else entry.scope.setAttribute("tabindex", oldTabIndex);
}

function register(root: HTMLElement, surface: HTMLElement, trigger: HTMLElement | null, close: RefObject<() => void>, kind: ModalKind): () => void {
  const document = root.ownerDocument;
  let manager = managers.get(document);
  if (!manager) { manager = createManager(document); managers.set(document, manager); }
  const baseZ = document.defaultView?.getComputedStyle(surface).zIndex;
  const entry: ModalEntry = {
    root, surface, trigger, close, scope: root.closest<HTMLElement>(".workspace"), lastFocus: null, removed: false,
    ordinary: kind === "dialog" && baseZ === "100" && !surface.classList.contains("record-confirm-backdrop"),
    originalZ: surface.style.getPropertyValue("z-index"), originalZPriority: surface.style.getPropertyPriority("z-index"), writtenZ: null,
  };
  if (!manager.entries.size) acquire(manager);
  manager.entries.add(entry); manager.revision++;
  refresh(manager, true);
  // Existing legitimate autoFocus is kept by focusEntry; disabled controls fall back.
  if (topModal(document) === root) focusEntry(entry);
  return () => {
    if (entry.removed) return;
    entry.removed = true;
    const wasOwner = topModal(document) === root;
    manager.entries.delete(entry); manager.revision++;
    restoreLayer(entry); refresh(manager, false);
    if (!manager.entries.size) release(manager);
    const revision = manager.revision;
    queueMicrotask(() => restoreFocus(manager, entry, wasOwner, revision));
  };
}

/** Only the pre-commit trigger read happens during render; all mutations wait for commit. */
export function useModalFocus(
  active: boolean,
  root: RefObject<HTMLElement | null>,
  surface: RefObject<HTMLElement | null>,
  onClose: () => void,
  kind: ModalKind,
): void {
  const close = useRef(onClose);
  const opening = useRef<{ active: boolean; trigger: HTMLElement | null }>({ active: false, trigger: null });
  const trigger = active && !opening.current.active
    ? typeof document === "undefined" ? null : htmlElement(document.activeElement)
    : opening.current.trigger;
  useLayoutEffect(() => {
    close.current = onClose;
    opening.current = { active, trigger };
  });
  useLayoutEffect(() => {
    if (!active || !root.current || !surface.current) return;
    return register(root.current, surface.current, trigger, close, kind);
  }, [active, root, surface, kind]);
}
