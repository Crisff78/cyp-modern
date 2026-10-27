// CyP with the keyboard only (cashiers work without a mouse). One set of rules for every window and dialog,
// installed once per app: the same keys do the same thing everywhere. See docs/TECLADO-COMPLETO.md.
//
//  F1 the keys · F2 Nuevo · F3 Buscar · F4 filters · F8 Imprimir · F9 Guardar / Aceptar · F10 menu · Esc close
//  Enter moves to the next field (money is still confirmed with its own button or F9, never with a stray Enter)
//  Lists: ↑ ↓ move the row, Inicio/Fin first and last, AvPág/RePág page, Enter opens it, Space selects it.
//
// The rules live here, on the page, and not in each of the ~100 screens: a window that already handles a key
// (a client list, a combobox) calls preventDefault and this code leaves that key alone.

export type ShortcutAction = "help" | "new" | "search" | "filters" | "print" | "save" | "menu";

/** The keys, in the order the help and the cashiers' sheet show them. */
export const KEYBOARD_SHORTCUTS: readonly { key: string; label: string; action?: ShortcutAction }[] = [
  { key: "F1", label: "Ver estas teclas", action: "help" },
  { key: "F2", label: "Nuevo", action: "new" },
  { key: "F3", label: "Buscar", action: "search" },
  { key: "F4", label: "Mostrar u ocultar los filtros", action: "filters" },
  { key: "F8", label: "Imprimir", action: "print" },
  { key: "F9", label: "Guardar o aceptar", action: "save" },
  { key: "F10", label: "Ir al menú", action: "menu" },
  { key: "Esc", label: "Cerrar o cancelar (avisa si hay cambios sin guardar)" },
];

/** How to move, for the same help. */
export const KEYBOARD_MOVES: readonly { key: string; label: string }[] = [
  { key: "Tab / Mayús+Tab", label: "Siguiente / anterior" },
  { key: "Intro", label: "Siguiente campo; en una lista, abre el registro" },
  { key: "↑ ↓", label: "Moverse en las listas y en el menú" },
  { key: "→ ←", label: "Abrir / cerrar una sección del menú" },
  { key: "Inicio / Fin", label: "Primera / última fila" },
  { key: "AvPág / RePág", label: "Página siguiente / anterior" },
  { key: "Espacio", label: "Seleccionar o marcar" },
  { key: "Ctrl+K", label: "Buscar un cliente o una ruta" },
];

const FUNCTION_KEYS: Record<string, ShortcutAction> = { F1: "help", F2: "new", F3: "search", F4: "filters", F8: "print", F9: "save", F10: "menu" };
export const SHORTCUT_KEY: Record<ShortcutAction, string> = { help: "F1", new: "F2", search: "F3", filters: "F4", print: "F8", save: "F9", menu: "F10" };

const FIELD = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),select,textarea';
// The parts of a window that only move or resize it.
const FRAME = ".mdi-window-titlebar,.legacy-dialog-titlebar,.remittance-receipt-titlebar,.dialog-heading,.remittances-dialog > header";
// A scope: a window of the desktop, a dialog or a receipt. The innermost one around the keyboard.
const SCOPE = '[role="dialog"],dialog,[role="alertdialog"]';
// Fields that only choose what a list shows: changing them is not a change to save.
const FILTER_AREA = '[data-keyboard-filter],[class*="filter"],[class*="toolbar"],[class*="search"]';

export const isShown = (element: Element | null | undefined): element is HTMLElement =>
  element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const isEnabled = (element: Element) => !(element as HTMLButtonElement).disabled && !element.closest("fieldset:disabled") && element.getAttribute("aria-disabled") !== "true";
const isTextEntry = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"].includes(element.type));
const nameOf = (element: Element) => (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").replace(/\s+/g, " ").trim();

/** The window or dialog the keyboard is working in (the one in front when the focus is on the menu or the page). */
export function activeScope(doc: Document = document): HTMLElement | null {
  const active = doc.activeElement;
  const around = active && active !== doc.body ? active.closest<HTMLElement>(SCOPE) : null;
  if (around && isShown(around)) return around;
  const modals = [...doc.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[role="dialog"][data-state="open"]')].filter(isShown);
  if (modals.length) return modals[modals.length - 1];
  return frontWindow(doc);
}

/** The window of the desktop in front: the focused one, otherwise the one drawn on top. */
export function frontWindow(doc: Document = document): HTMLElement | null {
  const windows = [...doc.querySelectorAll<HTMLElement>(".mdi-window")].filter(isShown);
  return windows.find((item) => item.classList.contains("focused")) ?? windows.sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0))[0] ?? null;
}

/** The elements of a scope that belong to it, not to a dialog opened inside it. */
const own = <T extends Element>(scope: Element, items: Iterable<T>) => [...items].filter((item) => item.closest(SCOPE) === scope || (!item.closest(SCOPE) && scope === document.body));

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────────────────
// A row of a list: focusable itself (the classic listings) or holding the button that opens it (Envíos).
const rowControl = (row: HTMLTableRowElement) => row.hasAttribute("tabindex") ? row : row.querySelector<HTMLElement>("button:not(:disabled),a[href]");
const listRows = (body: HTMLTableSectionElement) => [...body.rows].filter((row) => isShown(row) && rowControl(row));
const chosenRow = (rows: HTMLTableRowElement[]) => rows.find((row) => row.getAttribute("aria-selected") === "true" || row.classList.contains("selected-row")) ?? rows[0];

/** The first list of a scope with rows the keyboard can reach. */
function scopeList(scope: Element) {
  return own(scope, scope.querySelectorAll<HTMLTableSectionElement>("tbody")).find((body) => listRows(body).length > 0) ?? null;
}

/** Puts the keyboard on a row and chooses it, as a click does. */
export function focusRow(row: HTMLTableRowElement, choose = true) {
  const control = rowControl(row);
  if (!control) return;
  if (control === row) {
    // Only this row of the list is a Tab stop: Tab leaves the list instead of walking every row.
    for (const other of row.parentElement?.children ?? []) if (other !== row && other instanceof HTMLElement && other.getAttribute("tabindex") === "0") other.setAttribute("tabindex", "-1");
    row.setAttribute("tabindex", "0");
  }
  control.focus();
  control.scrollIntoView?.({ block: "nearest" });
  if (choose && control === row) row.click();
}

/** Before Tab moves: each list of the scope keeps one Tab stop, its chosen row. */
function keepOneRowStop(scope: Element) {
  for (const body of scope.querySelectorAll<HTMLTableSectionElement>("tbody")) {
    const rows = [...body.rows].filter((row) => row.hasAttribute("tabindex"));
    if (rows.length < 2) continue;
    const current = rows.find((row) => row.contains(document.activeElement)) ?? chosenRow(rows.filter(isShown).length ? rows.filter(isShown) : rows);
    for (const row of rows) row.setAttribute("tabindex", row === current ? "0" : "-1");
  }
}

const PAGE_BUTTONS: Record<"PageDown" | "PageUp", RegExp> = { PageDown: /^(Página siguiente)$/i, PageUp: /^(Página anterior)$/i };

function moveInList(event: KeyboardEvent, target: HTMLElement) {
  const row = target.closest("tr");
  const body = row?.parentElement;
  if (!row || !(body instanceof HTMLTableSectionElement) || body.tagName !== "TBODY") return false;
  // Inside a row only its own controls move it: a field of the row keeps its arrows.
  if (target !== row && (isTextEntry(target) || target instanceof HTMLSelectElement)) return false;
  const rows = listRows(body);
  const index = rows.indexOf(row as HTMLTableRowElement);
  if (index < 0) return false;
  const scope = row.closest<HTMLElement>(SCOPE);
  if ((event.key === "PageDown" || event.key === "PageUp") && scope) {
    // A list that comes in pages from the server (Clientes): the keys turn its page.
    const pager = own(scope, scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => PAGE_BUTTONS[event.key as "PageDown" | "PageUp"].test(nameOf(button)));
    if (pager) {
      if (!pager.disabled) {
        // The page comes from the server: the keyboard goes to its first row once it has arrived (up to 5 s).
        const before = rows[0], started = performance.now();
        pager.click();
        const arrived = () => {
          const next = scopeList(scope), first = next ? listRows(next)[0] : undefined;
          if (first && first !== before && first.isConnected) { focusRow(first); return; }
          if (performance.now() - started < 5000) window.setTimeout(arrived, 100);
        };
        window.setTimeout(arrived, 100);
      }
      return true;
    }
  }
  const visible = Math.max(1, Math.floor((body.closest<HTMLElement>("[class*=wrap],[class*=scroll]")?.clientHeight ?? 300) / Math.max(row.getBoundingClientRect().height, 18)) - 1);
  const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
    : event.key === "PageDown" ? Math.min(rows.length - 1, index + visible) : Math.max(0, index - visible);
  const destination = rows[Math.max(0, Math.min(rows.length - 1, next))];
  if (destination && destination !== row) {
    const column = target === row ? -1 : [...row.cells].findIndex((cell) => cell.contains(target));
    if (rowControl(destination) === destination) focusRow(destination);
    else (destination.cells[column]?.querySelector<HTMLElement>("button:not(:disabled),a[href]") ?? rowControl(destination))?.focus();
  }
  return true;
}

// ── Fields ───────────────────────────────────────────────────────────────────────────────────────────────────
const fieldsOf = (container: Element, current: Element) => own(container.closest(SCOPE) ?? document.body, container.querySelectorAll<HTMLElement>(FIELD))
  .filter((field) => field === current || (isShown(field) && isEnabled(field) && !(field instanceof HTMLInputElement && field.readOnly) && field.tabIndex >= 0 && !field.closest('[aria-hidden="true"]')));
// A money field (MoneyInput) makes its form a form of money: it is saved with its button or F9, never with Enter.
const holdsMoney = (form: Element) => Boolean(form.querySelector("[data-money-input]")) || form.matches('[data-keyboard-enter="advance-only"]');

function advanceField(event: KeyboardEvent, target: HTMLElement) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || (target instanceof HTMLInputElement && ["button", "submit", "reset", "image", "file"].includes(target.type))) return;
  if (target.closest('[data-keyboard-enter="native"]')) return;
  const form = target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.form : null;
  const container = form ?? target.closest<HTMLElement>(SCOPE);
  if (!container) return;
  const fields = fieldsOf(container, target);
  const next = fields[fields.indexOf(target) + (event.shiftKey ? -1 : 1)];
  if (next) {
    event.preventDefault();
    next.focus();
    if (isTextEntry(next) && !(next instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week", "number", "email"].includes(next.type))) next.select?.();
    return;
  }
  if (event.shiftKey) { event.preventDefault(); return; }
  // The last field. A form that is not of money is sent as the browser always did (Iniciar sesión, a client);
  // a form of money waits for its button (or F9). A window without a form goes on to its list.
  if (form) { if (holdsMoney(form) || target instanceof HTMLSelectElement || target.type === "checkbox" || target.type === "radio") event.preventDefault(); return; }
  event.preventDefault();
  const scope = target.closest<HTMLElement>(SCOPE);
  const list = scope ? scopeList(scope) : null;
  if (list) focusRow(chosenRow(listRows(list)), false);
}

// ── Keys that act on the window or dialog in front ───────────────────────────────────────────────────────────
const NAME_RULES: Partial<Record<ShortcutAction, RegExp>> = {
  new: /^(Nuevo|Nueva|Agregar)\b/i,
  save: /^(Guardar|Aceptar|Confirmar|Sí, guardar|Usar estos datos|Registrar entrega|Registrar)\b/i,
  print: /^Imprimir\b/i,
  filters: /^Mostrar\/Ocultar filtros$/i,
  search: /^Buscar\b/i,
};

/** What F2, F3, F4, F8 and F9 act on inside a scope; the same rule puts its key on the button. */
export function shortcutTarget(scope: Element, action: ShortcutAction): HTMLElement | null {
  const usable = (element: HTMLElement) => isShown(element) && isEnabled(element) && !element.closest(FRAME);
  const marked = own(scope, scope.querySelectorAll<HTMLElement>("[data-shortcut]")).filter((element) => element.dataset.shortcut!.split(/\s+/).includes(action) && usable(element));
  if (marked.length) return marked[0];
  if (action === "search") {
    const inputs = own(scope, scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[type="text"],input:not([type])')).filter((input) => usable(input) && input.getAttribute("role") !== "combobox" && !input.readOnly);
    const labelled = (input: HTMLInputElement) => /buscar|digite|búsqueda/i.test(`${input.closest("label")?.textContent ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.placeholder}`);
    const search = inputs.find((input) => input.type === "search") ?? inputs.find(labelled);
    if (search) return search;
  }
  const rule = NAME_RULES[action];
  if (!rule) return null;
  const buttons = own(scope, scope.querySelectorAll<HTMLElement>('button,[role="button"]:not(tr)')).filter(usable);
  if (action === "save") {
    // The form the keyboard is in sends with its own button.
    const form = document.activeElement instanceof HTMLElement ? document.activeElement.closest("form") : null;
    const submit = form && scope.contains(form) ? buttons.find((button) => button instanceof HTMLButtonElement && button.type === "submit" && button.form === form) : undefined;
    if (submit) return submit;
  }
  return buttons.find((button) => rule.test(nameOf(button))) ?? null;
}

function runShortcut(action: ShortcutAction) {
  if (action === "help" || action === "menu") {
    const handled = !document.dispatchEvent(new CustomEvent(`cyp-keyboard-${action}`, { cancelable: true }));
    if (!handled && action === "menu") focusMenu();
    return;
  }
  const scope = activeScope();
  const target = scope ? shortcutTarget(scope, action) : null;
  if (!target) { announce(`${SHORTCUT_KEY[action]}: no hay ${KEYBOARD_SHORTCUTS.find((item) => item.action === action)?.label.toLocaleLowerCase("es-DO")} en esta ventana.`); return; }
  if (target.matches(FIELD)) { target.focus(); if (isTextEntry(target)) target.select?.(); return; }
  target.click();
  if (action === "filters") window.setTimeout(() => {
    // The panel just shown takes the keyboard; a hidden panel leaves it on the list.
    const panel = scope && own(scope, scope.querySelectorAll<HTMLElement>('[class*="filter"]')).find((item) => isShown(item) && item.querySelector(FIELD));
    const field = panel?.querySelector<HTMLElement>(FIELD);
    if (field && isShown(field)) field.focus();
    else if (scope && !scope.contains(document.activeElement)) { const list = scopeList(scope); if (list) focusRow(chosenRow(listRows(list)), false); }
  }, 60);
}

/** F10: the option of the menu that is open, otherwise its first one. */
export function focusMenu(doc: Document = document) {
  const menu = doc.querySelector<HTMLElement>("[data-keyboard-menu]");
  if (!menu) return false;
  const items = menuItems(menu);
  (items.find((item) => item.getAttribute("aria-current") === "page") ?? items[0])?.focus();
  return true;
}
const menuItems = (menu: Element) => [...menu.querySelectorAll<HTMLElement>("button,a[href]")].filter((item) => isShown(item) && isEnabled(item) && !item.closest("[hidden]"));

function moveInMenu(event: KeyboardEvent, target: HTMLElement) {
  const menu = target.closest<HTMLElement>("[data-keyboard-menu]");
  if (!menu) return false;
  const items = menuItems(menu);
  const index = items.indexOf(target);
  if (index < 0) return false;
  if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !target.hasAttribute("aria-expanded") && !target.closest(".nav-group")) {
    // A menu in a row (the bottom bar of the collector): ← and → go to the option beside.
    items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]?.focus();
    return true;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    // → opens a section, ← closes it (or goes back to the section of the option).
    const expanded = target.getAttribute("aria-expanded");
    if (event.key === "ArrowRight" && expanded === "false") target.click();
    else if (event.key === "ArrowLeft" && expanded === "true") target.click();
    else if (event.key === "ArrowLeft") target.closest(".nav-group")?.querySelector<HTMLElement>(".nav-group-trigger")?.focus();
    return true;
  }
  const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : items.length - 1;
  items[(next + items.length) % items.length]?.focus();
  return true;
}

// ── Unsaved changes ──────────────────────────────────────────────────────────────────────────────────────────
// What each field had when the person first came to it; a field typed in since then is a change to save.
const firstValue = new WeakMap<Element, string>();
const typedIn = new WeakSet<Element>();
const valueOf = (field: Element) => field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") ? String(field.checked)
  : field instanceof HTMLSelectElement && field.multiple ? [...field.selectedOptions].map((option) => option.value).join("\n") : (field as HTMLInputElement).value ?? "";

/** Whether the person changed something in this window or dialog that would be lost by closing it. */
export function hasUnsavedChanges(scope: Element) {
  return own(scope, scope.querySelectorAll(FIELD)).some((field) => typedIn.has(field) && !field.closest(FILTER_AREA) && isShown(field) && !(field as HTMLInputElement).readOnly && firstValue.get(field) !== valueOf(field));
}

/** Esc and Cerrar ask first when something typed would be lost: Enter = Sí, Esc = No. */
export async function closeAfterAsking(scope: Element | null, close: () => void) {
  if (!scope || !hasUnsavedChanges(scope) || await askDiscard()) close();
}

let asking: Promise<boolean> | null = null;
/** «¿Cerrar sin guardar?» A native modal dialog: the keyboard is trapped in it and Esc means No. */
export function askDiscard(message = "Hay cambios sin guardar. ¿Cerrar sin guardarlos?"): Promise<boolean> {
  if (asking) return asking;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.className = "cyp-keyboard-confirm";
  dialog.setAttribute("aria-label", "Cambios sin guardar");
  dialog.innerHTML = `<p></p><div class="cyp-keyboard-confirm-actions"><button type="button" value="yes">Sí, cerrar</button><button type="button" value="no">No</button></div>`;
  dialog.querySelector("p")!.textContent = message;
  document.body.appendChild(dialog);
  asking = new Promise<boolean>((resolve) => {
    const finish = (answer: boolean) => {
      dialog.close(); dialog.remove(); asking = null;
      if (!answer && opener?.isConnected) opener.focus();
      resolve(answer);
    };
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    for (const button of dialog.querySelectorAll("button")) button.addEventListener("click", () => finish(button.value === "yes"));
  });
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('button[value="yes"]')!.focus();
  return asking;
}

// ── Opening and closing windows ──────────────────────────────────────────────────────────────────────────────
/**
 * The first useful place of a window or dialog: what it asks to be focused, its search, its list, its first field,
 * the «Sí» of a question, or its first button. Returns whether something took the keyboard.
 */
export function focusFirstUseful(scope: HTMLElement) {
  const usable = (element: HTMLElement) => isShown(element) && isEnabled(element) && !element.closest(FRAME);
  const pick = (selector: string) => own(scope, scope.querySelectorAll<HTMLElement>(selector)).find(usable);
  const list = scopeList(scope);
  const search = shortcutTarget(scope, "search");
  const fields = own(scope, scope.querySelectorAll<HTMLElement>(FIELD)).filter((field) => usable(field) && !(field instanceof HTMLInputElement && field.readOnly));
  const editing = fields.find((field) => !field.closest(FILTER_AREA));
  const buttons = own(scope, scope.querySelectorAll<HTMLElement>("button")).filter(usable);
  const target = pick("[data-autofocus],[autofocus]")
    // A form to fill (a dialog of data, Envíos): its first field. A listing: its search, else its list.
    ?? (editing && !list ? editing : undefined)
    ?? (search && search.matches(FIELD) ? search : undefined)
    ?? (list ? rowControl(chosenRow(listRows(list))) ?? undefined : undefined)
    ?? fields[0]
    ?? buttons.find((button) => /^Sí\b/.test(nameOf(button)))
    ?? buttons.find((button) => button.classList.contains("remittance-primary"))
    ?? buttons[0];
  if (!target) return false;
  // As little scrolling as possible: what the window or dialog says above its first field stays in sight.
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  if (target.tagName === "TR") keepOneRowStop(scope);
  return scope.contains(document.activeElement);
}

// Where the keyboard was in each window of the desktop, to come back to it.
const lastFocusOf = new WeakMap<Element, HTMLElement>();

/** A window brought to the front gives the keyboard back to where it was, or to its first useful place. */
export function restoreWindowFocus(scope: HTMLElement) {
  const last = lastFocusOf.get(scope);
  if (last && last.isConnected && scope.contains(last) && isShown(last) && isEnabled(last)) { last.focus(); return true; }
  return focusFirstUseful(scope);
}

/** A window closed: the keyboard goes to the window now in front, or to the menu when none is left. */
export function focusAfterClosing(doc: Document = document) {
  const active = doc.activeElement;
  if (active && active !== doc.body && active.isConnected && !active.matches("#main-content")) return;
  const next = frontWindow(doc);
  if (!next || !restoreWindowFocus(next)) focusMenu(doc);
}

/**
 * The keyboard is nowhere (what had it was closed, or disabled while saving): it goes to the dialog open, otherwise
 * to the window in front, otherwise to the menu.
 */
export function rescueFocus(doc: Document = document) {
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  const modal = [...doc.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[role="dialog"][data-state="open"]')].filter(isShown).pop();
  if (modal) { focusFirstUseful(modal); return; }
  const front = frontWindow(doc);
  if (front && restoreWindowFocus(front)) return;
  focusMenu(doc);
}

/** A dialog closed gives the keyboard back to what opened it, as soon as it can take it again (a form saving keeps
 *  its fields disabled for a moment); otherwise it is rescued. Nothing is done when the keyboard is already somewhere. */
export function giveFocusBack(element: Element | null) {
  const started = performance.now();
  const attempt = () => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (element instanceof HTMLElement && element.isConnected && isShown(element) && isEnabled(element)) {
      // A client search (combobox) takes the keyboard back without unfolding its list over the form (its quiet focus).
      if (element.getAttribute("role") === "combobox") element.dataset.quietFocus = "1";
      element.focus();
      if (document.activeElement === element) return;
      delete element.dataset.quietFocus;
    }
    if (performance.now() - started > 1500) { rescueFocus(); return; }
    window.requestAnimationFrame(attempt);
  };
  attempt();
}

/** Call before a request that saves; call what it returns when it was saved: what was typed there is no longer a change. */
export function beginSave(): () => void {
  if (typeof document === "undefined") return () => {};
  const areas = new Set<Element>();
  const scope = activeScope();
  for (const area of [scope, scope?.closest(".mdi-window"), frontWindow()]) if (area) areas.add(area);
  return () => {
    for (const area of areas) for (const field of area.querySelectorAll(FIELD)) { typedIn.delete(field); firstValue.set(field, valueOf(field)); }
  };
}

/** Whether the keyboard is still where it was before a window opened (the menu, the page): it may be moved. */
export const keyboardIsFree = (scope: Element, opener: Element | null) => {
  const active = document.activeElement;
  return !active || active === document.body || active === opener || Boolean(active.closest("[data-keyboard-menu]")) || Boolean(active.closest(FRAME) && scope.contains(active)) || active.closest("#main-content") === active;
};

// The browser's own modal dialogs (remesas, «¿Cerrar sin guardar?») are drawn above every element of the page: the
// keys, the help of icons and the short messages go above them too, as manual popovers shown after them.
function lift(element: HTMLElement) {
  if (typeof element.showPopover !== "function") return;
  if (!element.hasAttribute("popover")) element.setAttribute("popover", "manual");
  const open = element.matches(":popover-open");
  if (open && !document.querySelector("dialog[open]")) return;
  if (open) element.hidePopover();
  element.showPopover();
}

// ── Help for icon buttons ────────────────────────────────────────────────────────────────────────────────────
// A button reached with the keyboard says what it does (a mouse sees its title); with its key when it has one.
let hint: HTMLElement | null = null;
function showHint(target: HTMLElement) {
  hideHint();
  const text = target.getAttribute("title") || target.getAttribute("aria-label") || "";
  const visibleText = (target.innerText || "").replace(/\s+/g, " ").trim();
  const key = target.getAttribute("aria-keyshortcuts");
  if (!text || (visibleText.length > 3 && !key && visibleText === text)) return;
  hint = document.createElement("div");
  hint.className = "cyp-key-hint"; hint.setAttribute("role", "tooltip");
  hint.textContent = key ? `${text} · ${key}` : text;
  document.body.appendChild(hint);
  lift(hint);
  const box = target.getBoundingClientRect(), size = hint.getBoundingClientRect();
  hint.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - size.width - 4))}px`;
  hint.style.top = `${box.bottom + 4 + size.height > window.innerHeight ? box.top - size.height - 4 : box.bottom + 4}px`;
}
function hideHint() { hint?.remove(); hint = null; }

// ── Keys on the buttons ──────────────────────────────────────────────────────────────────────────────────────
// The buttons that F2, F3, F4, F8 and F9 press in the window in front show their key: the same rule that presses
// them chooses them. The key is drawn on a layer of its own (aria-hidden), so it never changes the name of a button
// that a screen reader says; the button itself carries aria-keyshortcuts.
let markedScope: Element | null = null;
const marks = new Map<HTMLElement, string>();
let layer: HTMLElement | null = null;
function markKeys() {
  const scope = activeScope();
  const next = new Map<HTMLElement, string>();
  if (scope) for (const action of ["new", "search", "filters", "print", "save"] as const) {
    const target = shortcutTarget(scope, action);
    if (target && !next.has(target)) next.set(target, SHORTCUT_KEY[action]);
  }
  for (const element of marks.keys()) if (!next.has(element)) { element.removeAttribute("aria-keyshortcuts"); marks.delete(element); }
  for (const [element, key] of next) { if (element.getAttribute("aria-keyshortcuts") !== key) element.setAttribute("aria-keyshortcuts", key); marks.set(element, key); }
  markedScope = scope;
  drawKeys();
}
function drawKeys() {
  if (!layer) { layer = document.createElement("div"); layer.className = "cyp-key-layer"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer); }
  const badges: HTMLElement[] = [];
  for (const [element, key] of marks) {
    // A field shows its key on its label; anything covered or scrolled out of sight shows none.
    const host = element.matches(FIELD) ? element.closest("label") ?? element : element;
    const box = host.getBoundingClientRect();
    if (!box.width || box.bottom < 0 || box.top > window.innerHeight) continue;
    const seen = document.elementFromPoint(Math.min(window.innerWidth - 1, box.left + box.width / 2), Math.min(window.innerHeight - 1, box.top + Math.min(box.height / 2, 8)));
    if (!seen || !(host.contains(seen) || seen.contains(host))) continue;
    const badge = document.createElement("span");
    badge.className = "cyp-key-badge"; badge.textContent = key; badge.dataset.key = key;
    badge.style.left = `${Math.min(window.innerWidth - 22, box.right - 12)}px`; badge.style.top = `${Math.max(0, box.top - 7)}px`;
    badges.push(badge);
  }
  layer.replaceChildren(...badges);
  if (badges.length) lift(layer);
}
let markFrame = 0;
const scheduleMarks = () => { if (!markFrame) markFrame = window.requestAnimationFrame(() => { markFrame = 0; markKeys(); }); };

// ── A short spoken and visible message ───────────────────────────────────────────────────────────────────────
let live: HTMLElement | null = null, liveTimer = 0;
export function announce(message: string) {
  if (!live) { live = document.createElement("div"); live.className = "cyp-keyboard-status"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); document.body.appendChild(live); }
  live.textContent = message; live.classList.add("shown");
  lift(live);
  window.clearTimeout(liveTimer); liveTimer = window.setTimeout(() => live?.classList.remove("shown"), 2600);
}

// ── Installing ───────────────────────────────────────────────────────────────────────────────────────────────
let installed = false;
/** Installs the keyboard rules once for the page. `windows`: the desktop closes its window in front with Esc. */
export function installKeyboard({ windows = true }: { windows?: boolean } = {}) {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("focusin", (event) => {
    const target = event.target as Element;
    if (target.matches?.(FIELD) && !firstValue.has(target)) firstValue.set(target, valueOf(target));
    const window_ = target.closest?.(".mdi-window");
    if (window_ && target instanceof HTMLElement && !target.closest(FRAME)) lastFocusOf.set(window_, target);
    if (target instanceof HTMLElement && target.matches(":focus-visible") && target.matches("button,[role=button]:not(tr),a[href]")) showHint(target); else hideHint();
    scheduleMarks();
  });
  document.addEventListener("focusout", hideHint);
  // Working with the keyboard, it is never left nowhere (a closed dialog, a field disabled while saving).
  let lastInput: "keyboard" | "pointer" = "keyboard";
  document.addEventListener("keydown", () => { lastInput = "keyboard"; }, true);
  document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
  document.addEventListener("focusout", () => { if (lastInput === "keyboard") window.setTimeout(() => { if (lastInput === "keyboard") rescueFocus(); }, 150); });
  document.addEventListener("scroll", () => { hideHint(); scheduleMarks(); }, true);
  window.addEventListener("resize", scheduleMarks);
  document.addEventListener("input", (event) => typedIn.add(event.target as Element), true);
  // A money field writes its own digits (no input event): a key typed in a field counts as typing in it.
  document.addEventListener("keydown", (event) => {
    const target = event.target as Element;
    if (target.matches?.(FIELD) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) typedIn.add(target);
  }, true);
  document.addEventListener("paste", (event) => typedIn.add(event.target as Element), true);
  document.addEventListener("change", (event) => typedIn.add(event.target as Element), true);
  document.addEventListener("click", scheduleMarks, true);
  document.addEventListener("keyup", scheduleMarks, true);
  // Before Tab moves: one Tab stop per list.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { const scope = activeScope(); if (scope) keepOneRowStop(scope); }
    // A held Enter repeats: it must not press, one after another, the button that a dialog just put under it.
    if (event.key === "Enter" && event.repeat && (event.target as Element).matches?.("button,[role=button]")) event.preventDefault();
  }, true);
  // After the screen: only what it left alone.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const action = FUNCTION_KEYS[event.key];
    if (action && plain && !event.shiftKey) { event.preventDefault(); hideHint(); runShortcut(action); return; }
    if (!target || !plain) return;
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
      if (moveInList(event, target)) { event.preventDefault(); return; }
    }
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && moveInMenu(event, target)) { event.preventDefault(); return; }
    // ↓ from the search of a listing goes down to its list.
    if (event.key === "ArrowDown" && !event.shiftKey && target instanceof HTMLInputElement && ["text", "search"].includes(target.type) && !target.getAttribute("role") && !target.getAttribute("list") && !target.matches("[data-money-input]")) {
      const scope = target.closest<HTMLElement>(SCOPE), list = scope ? scopeList(scope) : null;
      if (list && !list.contains(target)) { event.preventDefault(); focusRow(chosenRow(listRows(list))); return; }
    }
    if (event.key === "Enter") { advanceField(event, target); return; }
    if (event.key === "Escape" && windows) {
      // The window in front closes; a dialog closes itself (and asks the same question).
      const scope = activeScope();
      if (!scope?.classList.contains("mdi-window")) return;
      const close = scope.querySelector<HTMLButtonElement>('.mdi-window-titlebar button[aria-label^="Cerrar"]');
      if (!close) return;
      event.preventDefault();
      void closeAfterAsking(scope, () => close.click());
    }
  });
  // The screens change (a dialog opens, a list arrives): the keys follow. Changes of this module's own layers do not count.
  const ownLayer = (node: Node) => node === layer || node === hint || node === live || Boolean(layer?.contains(node));
  new MutationObserver((records) => {
    if (records.every((record) => ownLayer(record.target) || [...record.addedNodes, ...record.removedNodes].every(ownLayer))) return;
    if (markedScope && !markedScope.isConnected) markedScope = null;
    scheduleMarks();
  }).observe(document.body, { childList: true, subtree: true });
}
