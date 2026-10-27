// CyP with the keyboard only, and with simple keys only (Rardiel, 27-10-2026): the arrows, Enter, Tab, Esc and Space,
// so anyone can use it fast without learning anything; nothing extra is drawn on the screen. One set of rules for every
// window and dialog, installed once per app. See docs/TECLADO-COMPLETO.md.
//
//  Arrows   move: in the menu, in a list, between the buttons of a bar or a dialog, between the fields of a form.
//  Enter    goes to the next field; on a row it does what the double click does; on a button it presses it.
//  Tab      next (Shift+Tab, previous).
//  Esc      closes the dialog or the window in front (asking first if something typed would be lost), back to the menu.
//  Space    selects the row or ticks the box.
//
// Money is never confirmed by going through fields (Dionel, DIONEL-REMESAS-PERMISOS.md point 6): in a form with money,
// Enter stops at its last field; its button is reached with Tab (or →) and pressed with Enter.
//
// The rules live here, on the page, and not in each of the ~100 screens: a window that already handles a key
// (a client list, a combobox) calls preventDefault and this code leaves that key alone.

/** The keys, as Soporte Técnico shows them. */
export const KEYBOARD_MOVES: readonly { key: string; label: string }[] = [
  { key: "Flechas", label: "Moverse: en el menú, en las listas, entre botones y entre campos" },
  { key: "Intro", label: "Siguiente campo; en una lista, abrir el registro; en un botón, pulsarlo" },
  { key: "Tab", label: "Ir al siguiente (con Mayús, al anterior)" },
  { key: "Esc", label: "Cerrar y volver (pregunta si hay algo escrito sin guardar)" },
  { key: "Espacio", label: "Seleccionar o marcar" },
];

const FIELD = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),select,textarea';
// The parts of a window that only move or resize it.
const FRAME = ".mdi-window-titlebar,.legacy-dialog-titlebar,.remittance-receipt-titlebar,.dialog-heading,.remittances-dialog > header";
// A scope: a window of the desktop, a dialog or a receipt. The innermost one around the keyboard.
const SCOPE = '[role="dialog"],dialog,[role="alertdialog"]';
// Fields that only choose what a list shows: changing them is not a change to save.
const FILTER_AREA = '[data-keyboard-filter],[class*="filter"],[class*="toolbar"],[class*="search"]';
// The main button of a form or a dialog, by its name (the same names as always).
const MAIN_BUTTON = /^(Aceptar|Guardar|Confirmar|Sí|Usar estos datos|Registrar|Consultar|Filtrar|Calcular|Revisar)\b/i;

export const isShown = (element: Element | null | undefined): element is HTMLElement =>
  element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const isEnabled = (element: Element) => !(element as HTMLButtonElement).disabled && !element.closest("fieldset:disabled") && element.getAttribute("aria-disabled") !== "true";
const isTextEntry = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"].includes(element.type));
// A one-line text field, where ↑ and ↓ do nothing of their own (not a list of choices, a number, a date or a note).
const isLineField = (element: Element): element is HTMLInputElement =>
  element instanceof HTMLInputElement && ["text", "search", "tel", "email", "password", "url"].includes(element.type) && !element.getAttribute("role") && !element.getAttribute("list");
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

/** The search of a window: the field that finds what its list shows. */
function searchField(scope: Element): HTMLInputElement | null {
  const usable = (input: HTMLInputElement) => isShown(input) && isEnabled(input) && !input.readOnly && input.getAttribute("role") !== "combobox";
  const marked = own(scope, scope.querySelectorAll<HTMLInputElement>("input[data-keyboard-search]")).find(usable);
  if (marked) return marked;
  const inputs = own(scope, scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[type="text"],input:not([type])')).filter(usable);
  const labelled = (input: HTMLInputElement) => /buscar|digite|búsqueda/i.test(`${input.closest("label")?.textContent ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.placeholder}`);
  return inputs.find((input) => input.type === "search") ?? inputs.find(labelled) ?? null;
}

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
  // ↑ on the first row goes back up to the search of the window.
  if (event.key === "ArrowUp" && index === 0 && scope) {
    const search = searchField(scope);
    if (search) { search.focus(); search.select?.(); }
    return true;
  }
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
// A money field (MoneyInput) makes its form a form of money: going through its fields never presses its button.
const holdsMoney = (form: Element) => Boolean(form.querySelector("[data-money-input]")) || form.matches('[data-keyboard-enter="advance-only"]');

/** The main button of a form (its own submit) or of a dialog (Aceptar, Guardar, Sí…). */
function mainButton(container: Element): HTMLElement | null {
  const buttons = own(container.closest(SCOPE) ?? document.body, container.querySelectorAll<HTMLElement>("button")).filter((button) => isShown(button) && isEnabled(button) && !button.closest(FRAME));
  return buttons.find((button) => button instanceof HTMLButtonElement && button.type === "submit") ?? buttons.find((button) => MAIN_BUTTON.test(nameOf(button))) ?? null;
}

/** Goes to the field before or after; at the end of a form without money, to its main button (it does not press it). */
function stepField(target: HTMLElement, backwards: boolean, fromEnter: boolean) {
  const form = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement ? target.form : null;
  const container = form ?? target.closest<HTMLElement>(SCOPE);
  if (!container) return false;
  // A field outside any form (a filter, a search) goes through the other fields outside forms only.
  const fields = fieldsOf(container, target).filter((field) => form || field === target || !(field as HTMLInputElement).form);
  const next = fields[fields.indexOf(target) + (backwards ? -1 : 1)];
  if (next) {
    next.focus();
    if (isTextEntry(next) && !(next instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week", "number", "email"].includes(next.type))) next.select?.();
    return true;
  }
  if (backwards) return true;
  // After the last field. Money stays there: its button is reached with Tab (Dionel).
  if (form ? holdsMoney(form) : container.matches('[data-keyboard-enter="advance-only"]') || fields.some((field) => field.matches("[data-money-input]"))) return true;
  // A form: Enter sends it, as the browser always did.
  const choice = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"));
  if (form && fromEnter && !choice) return false;
  // A window with a list goes down to it (after its search and filters); otherwise to the main button, without pressing it.
  const scope = target.closest<HTMLElement>(SCOPE);
  const list = scope && (!form || !fromEnter) ? scopeList(scope) : null;
  if (list && !list.contains(target)) { focusRow(chosenRow(listRows(list)), false); return true; }
  const button = mainButton(form ?? container);
  if (button) button.focus();
  return true;
}

/** ↓ from the search of a window goes straight down to its list. */
function searchToList(target: HTMLElement) {
  const scope = target.closest<HTMLElement>(SCOPE);
  if (!scope || !(target instanceof HTMLInputElement) || (target.type !== "search" && searchField(scope) !== target)) return false;
  const list = scopeList(scope);
  if (!list || list.contains(target)) return false;
  focusRow(chosenRow(listRows(list)), false);
  return true;
}

function advanceField(event: KeyboardEvent, target: HTMLElement) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || (target instanceof HTMLInputElement && ["button", "submit", "reset", "image", "file"].includes(target.type))) return;
  if (target.closest('[data-keyboard-enter="native"]')) return;
  if (stepField(target, event.shiftKey, true)) event.preventDefault();
}

// ── Buttons ──────────────────────────────────────────────────────────────────────────────────────────────────
// The buttons that go together (a bar of a window, the answers of a dialog, the tiles of a launcher): ← and → go to the
// one beside; in a grid of tiles, ↑ and ↓ too.
const BUTTON_GROUP = '[role="toolbar"],[role="group"],.legacy-mdi-toolbar,[class*="actions"],[class*="toolbar"],.remittance-tabs,.remittance-window-controls,.control-panel-grid,.reports-launcher-grid,.cyp-keyboard-confirm-actions';
const TILE_GRID = ".control-panel-grid,.reports-launcher-grid";
function moveInButtons(event: KeyboardEvent, target: HTMLElement) {
  if (!target.matches("button,a[href],[role=button]:not(tr)") || target.closest("[data-keyboard-menu],tbody,[role=listbox]")) return false;
  const scope = target.closest(SCOPE);
  const usable = (group: Element) => [...group.querySelectorAll<HTMLElement>("button,a[href]")]
    .filter((button) => isShown(button) && isEnabled(button) && button.tabIndex >= 0 && button.closest(SCOPE) === scope && !button.closest("tbody,[data-keyboard-menu],[role=listbox]"));
  // The group of the button: the nearest one with another button (a lone button in its own corner of a bar belongs to the bar).
  let group = target.closest<HTMLElement>(BUTTON_GROUP), buttons: HTMLElement[] = [];
  while (group && (buttons = usable(group)).length < 2) group = group.parentElement?.closest<HTMLElement>(BUTTON_GROUP) ?? null;
  if (!group) return false;
  const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (vertical && !group.matches(TILE_GRID)) return false;
  const index = buttons.indexOf(target);
  if (index < 0) return false;
  if (vertical) {
    // ↓ ↑ in a grid of tiles: the tile of the row below or above, the nearest to the same column.
    const here = target.getBoundingClientRect(), down = event.key === "ArrowDown";
    const middle = (rect: DOMRect) => rect.left + rect.width / 2;
    // Every grid of the window counts: below the last row of a section come the tiles of the next one.
    const tiles = [...(scope ?? document).querySelectorAll<HTMLElement>(TILE_GRID)].flatMap((grid) => usable(grid));
    const rows = tiles.map((button) => ({ button, rect: button.getBoundingClientRect() })).filter(({ rect }) => down ? rect.top >= here.bottom - 2 : rect.bottom <= here.top + 2);
    const row = rows.length ? (down ? Math.min(...rows.map(({ rect }) => rect.top)) : Math.max(...rows.map(({ rect }) => rect.top))) : null;
    const candidates = rows.filter(({ rect }) => Math.abs(rect.top - (row ?? 0)) < 4);
    candidates.sort((a, b) => Math.abs(middle(a.rect) - middle(here)) - Math.abs(middle(b.rect) - middle(here)))[0]?.button.focus();
    return true;
  }
  const step = event.key === "ArrowRight" ? 1 : -1;
  buttons[(index + step + buttons.length) % buttons.length]?.focus();
  return true;
}

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The option of the menu that is open, otherwise its first one (after signing in, after closing the last window). */
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
  const search = searchField(scope);
  const fields = own(scope, scope.querySelectorAll<HTMLElement>(FIELD)).filter((field) => usable(field) && !(field instanceof HTMLInputElement && field.readOnly));
  const editing = fields.find((field) => !field.closest(FILTER_AREA));
  const buttons = own(scope, scope.querySelectorAll<HTMLElement>("button")).filter(usable);
  const target = pick("[data-autofocus],[autofocus]")
    // A form to fill (a dialog of data, Envíos): its first field. A listing: its search, else its list.
    ?? (editing && !list ? editing : undefined)
    ?? search
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
export function rescueFocus(doc: Document = document, waited = 0) {
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  const modal = [...doc.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[role="dialog"][data-state="open"]')].filter(isShown).pop();
  if (modal) { focusFirstUseful(modal); return; }
  const front = frontWindow(doc);
  // What had the keyboard is only disabled for a moment (a button while its request runs): it gets it back when it can.
  const last = front ? lastFocusOf.get(front) : undefined;
  if (front && last?.isConnected && front.contains(last) && isShown(last) && !isEnabled(last) && waited < 5000) { window.setTimeout(() => rescueFocus(doc, waited + 100), 100); return; }
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
  });
  // Working with the keyboard, it is never left nowhere (a closed dialog, a field disabled while saving).
  let lastInput: "keyboard" | "pointer" = "keyboard";
  document.addEventListener("keydown", () => { lastInput = "keyboard"; }, true);
  document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
  document.addEventListener("focusout", () => { if (lastInput === "keyboard") window.setTimeout(() => { if (lastInput === "keyboard") rescueFocus(); }, 150); });
  document.addEventListener("input", (event) => typedIn.add(event.target as Element), true);
  // A money field writes its own digits (no input event): a key typed in a field counts as typing in it.
  document.addEventListener("keydown", (event) => {
    const target = event.target as Element;
    if (target.matches?.(FIELD) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) typedIn.add(target);
  }, true);
  document.addEventListener("paste", (event) => typedIn.add(event.target as Element), true);
  document.addEventListener("change", (event) => typedIn.add(event.target as Element), true);
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
    if (!target || event.ctrlKey || event.metaKey || event.altKey) return;
    const arrow = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key);
    if ((arrow || ["Home", "End", "PageDown", "PageUp"].includes(event.key)) && !event.shiftKey) {
      if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key) && moveInList(event, target)) { event.preventDefault(); return; }
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && moveInMenu(event, target)) { event.preventDefault(); return; }
      if (arrow && moveInButtons(event, target)) { event.preventDefault(); return; }
      // ↓ from a search goes down to the list; ↓ and ↑ in a one-line field go to the next and previous field.
      if (event.key === "ArrowDown" && searchToList(target)) { event.preventDefault(); return; }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && isLineField(target) && stepField(target, event.key === "ArrowUp", false)) { event.preventDefault(); return; }
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
}
