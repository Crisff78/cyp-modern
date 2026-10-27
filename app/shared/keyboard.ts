// CyP with the keyboard only, and with simple keys only (Rardiel, 27-10-2026): the arrows, Enter, Tab, Esc and Space,
// so anyone can use it fast without learning anything; nothing extra is drawn on the screen. See docs/TECLADO-COMPLETO.md.
//
//  Arrows   move: in the menu, in a list, between the buttons of a bar or a dialog, between the fields of a form.
//  Enter    goes to the next field; on a row it does what the double click does; on a button it presses it.
//  Tab      next (Shift+Tab, previous).
//  Esc      closes the dialog or the window in front (asking first if something typed would be lost), back to the menu.
//  Space    selects the row or ticks the box.
//
// The moving is done by Tabster (Microsoft, MIT, the keyboard of Fluent UI), created once per app in installKeyboard:
//  - Mover: the arrows, Inicio/Fin and AvPág/RePág in the menu, the lists, the bars of buttons and the tiles. The menu
//    and each list are one Tab stop that remembers where the keyboard was.
//  - Modalizer: Tab does not leave an open dialog.
// Tabster reads its marks (data-tabster) from the shared components (the menu, the dialogs, the launchers); the lists
// and the bars of buttons, that each screen draws itself, are marked here by their shape (markAreas).
//
// What is left in this file is CyP's own: Enter goes field by field and never confirms money (Dionel,
// DIONEL-REMESAS-PERMISOS.md point 6: the button of money is reached with Tab and pressed with Enter); a row reached with
// the keys is chosen; the search and its list are joined by ↓ and ↑; AvPág and RePág turn the page of the server; → and ←
// open and close the sections of the menu; Esc asks before losing what was typed; where the keyboard starts in a window
// and where it goes when what had it disappears. That last one is not Tabster's Deloser on purpose: it does not know
// which window is in front, and taking the keyboard to another window brings that window over the one in front.
import { createTabster, getModalizer, getMover, getTabsterAttribute, MoverDirections, TABSTER_ATTRIBUTE_NAME } from "tabster";

/** The keys, as Soporte Técnico shows them. */
export const KEYBOARD_MOVES: readonly { key: string; label: string }[] = [
  { key: "Flechas", label: "Moverse: en el menú, en las listas, entre botones y entre campos" },
  { key: "Intro", label: "Siguiente campo; en una lista, abrir el registro; en un botón, pulsarlo" },
  { key: "Tab", label: "Ir al siguiente (con Mayús, al anterior)" },
  { key: "Esc", label: "Cerrar y volver (pregunta si hay algo escrito sin guardar)" },
  { key: "Espacio", label: "Seleccionar o marcar" },
];

// ── The marks Tabster reads ──────────────────────────────────────────────────────────────────────────────────
/** The menu: ↑ ↓ from option to option (round), one Tab stop that remembers the option. */
export const MENU_KEYS = getTabsterAttribute({ mover: { direction: MoverDirections.Vertical, cyclic: true, memorizeCurrent: true } });
/** A menu in a row (the bottom bar of the collector): ← →. */
export const BAR_MENU_KEYS = getTabsterAttribute({ mover: { direction: MoverDirections.Horizontal, cyclic: true, memorizeCurrent: true } });
/** Tiles (Configuración, Reportes): the four arrows, as they are drawn; each tile is still a Tab stop. */
export const TILE_KEYS = getTabsterAttribute({ mover: { direction: MoverDirections.GridLinear, cyclic: true, tabbable: true } });
/** A dialog: Tab does not leave it. `id`: one per dialog. */
export const dialogKeys = (id: string) => getTabsterAttribute({ modalizer: { id, isTrapped: true, isOthersAccessible: true } });

// A list of rows: ↑ ↓, Inicio/Fin, AvPág/RePág; one Tab stop, its row. A list of buttons in rows (Envíos): the arrows
// as they are drawn, the column kept; with fields in it, Tab goes through them as always.
const LIST = getTabsterAttribute({ mover: { direction: MoverDirections.Vertical, memorizeCurrent: true } }, true);
const BUTTON_LIST = getTabsterAttribute({ mover: { direction: MoverDirections.Grid, memorizeCurrent: true } }, true);
const FIELD_LIST = getTabsterAttribute({ mover: { direction: MoverDirections.Grid, memorizeCurrent: true, tabbable: true } }, true);
// The buttons that go together (the bar of a window, the answers of a dialog, the buttons of a receipt): ← →, round.
const BAR = getTabsterAttribute({ mover: { direction: MoverDirections.Horizontal, cyclic: true, tabbable: true } }, true);
// A field, or a box inside a row, keeps its own arrows.
const OWN_ARROWS = getTabsterAttribute({ focusable: { excludeFromMover: true } }, true);

const FIELD = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),select,textarea';
const BUTTON_GROUP = '[role="toolbar"],[role="group"],.legacy-mdi-toolbar,[class*="actions"],[class*="toolbar"],.remittance-tabs,.remittance-window-controls';
// The parts of a window that only move or resize it.
const FRAME = ".mdi-window-titlebar,.legacy-dialog-titlebar,.remittance-receipt-titlebar,.dialog-heading,.remittances-dialog > header";
// A scope: a window of the desktop, a dialog or a receipt. The innermost one around the keyboard.
const SCOPE = '[role="dialog"],dialog,[role="alertdialog"]';
const MODAL = 'dialog[open],[role="dialog"][aria-modal="true"],[role="dialog"][data-state="open"]';
// Fields that only choose what a list shows: changing them is not a change to save.
const FILTER_AREA = '[data-keyboard-filter],[class*="filter"],[class*="toolbar"],[class*="search"]';
// The main button of a form or a dialog, by its name (the same names as always).
const MAIN_BUTTON = /^(Aceptar|Guardar|Confirmar|Sí|Usar estos datos|Registrar|Consultar|Filtrar|Calcular|Revisar)\b/i;
const PAGE_BUTTONS: Record<"PageDown" | "PageUp", RegExp> = { PageDown: /^(Página siguiente)$/i, PageUp: /^(Página anterior)$/i };

const marked = new WeakSet<Element>();
function setMark(element: Element, value: string) {
  if (element.getAttribute(TABSTER_ATTRIBUTE_NAME) !== value) element.setAttribute(TABSTER_ATTRIBUTE_NAME, value);
  marked.add(element);
}
// A mark of a shared component is never replaced.
const markedElsewhere = (element: Element) => element.hasAttribute(TABSTER_ATTRIBUTE_NAME) && !marked.has(element);

/** Marks, by their shape, the lists and the bars of buttons that each screen draws itself. */
function markAreas(doc: Document) {
  for (const table of doc.querySelectorAll("table")) {
    if (markedElsewhere(table)) continue;
    const rows = [...table.tBodies].flatMap((body) => [...body.rows]);
    const rowStops = rows.some((row) => row.hasAttribute("tabindex"));
    if (!rowStops && !rows.some((row) => row.querySelector("button,a[href]"))) continue;
    const fields = !rowStops && rows.some((row) => row.querySelector(FIELD));
    setMark(table, rowStops ? LIST : fields ? FIELD_LIST : BUTTON_LIST);
    // In a list of rows only the rows move; a field keeps its arrows.
    for (const inner of table.querySelectorAll(rowStops ? "tbody tr[tabindex] :is(button,a[href],input,select,textarea,[tabindex])" : `tbody :is(${FIELD})`)) setMark(inner, OWN_ARROWS);
  }
  for (const group of doc.querySelectorAll(BUTTON_GROUP)) {
    if (markedElsewhere(group) || group.closest("table,[data-keyboard-menu]")) continue;
    // One bar per window or dialog: the outermost one (a lone button in its own corner belongs to the bar).
    const outer = group.parentElement?.closest(BUTTON_GROUP);
    if (outer && outer.closest(SCOPE) === group.closest(SCOPE) && !outer.closest("table,[data-keyboard-menu]")) continue;
    setMark(group, BAR);
    for (const field of group.querySelectorAll(FIELD)) if (!field.closest("table")) setMark(field, OWN_ARROWS);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
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
  const modals = [...doc.querySelectorAll<HTMLElement>(MODAL)].filter(isShown);
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
  const flagged = own(scope, scope.querySelectorAll<HTMLInputElement>("input[data-keyboard-search]")).find(usable);
  if (flagged) return flagged;
  const inputs = own(scope, scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[type="text"],input:not([type])')).filter(usable);
  const labelled = (input: HTMLInputElement) => /buscar|digite|búsqueda/i.test(`${input.closest("label")?.textContent ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.placeholder}`);
  return inputs.find((input) => input.type === "search") ?? inputs.find(labelled) ?? null;
}

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────────────────
// A row of a list: focusable itself (the classic listings) or holding the button that opens it (Envíos).
const rowControl = (row: HTMLTableRowElement) => row.hasAttribute("tabindex") ? row : row.querySelector<HTMLElement>("button:not(:disabled),a[href]");
const listRows = (body: HTMLTableSectionElement) => [...body.rows].filter((row) => isShown(row) && rowControl(row));
const isChosen = (row: Element) => row.getAttribute("aria-selected") === "true" || row.classList.contains("selected-row") || row.classList.contains("is-selected");
const chosenRow = (rows: HTMLTableRowElement[]) => rows.find(isChosen) ?? rows[0];

/** The first list of a scope with rows the keyboard can reach. */
function scopeList(scope: Element) {
  return own(scope, scope.querySelectorAll<HTMLTableSectionElement>("tbody")).find((body) => listRows(body).length > 0) ?? null;
}

/** Puts the keyboard on the chosen row of a list (Tabster remembers it as the Tab stop of the list). */
function focusRow(row: HTMLTableRowElement | undefined) {
  const control = row && rowControl(row);
  control?.focus();
  control?.scrollIntoView?.({ block: "nearest" });
}

/** AvPág and RePág in a list that comes in pages from the server (Clientes): they turn its page. */
function turnPage(event: KeyboardEvent, target: HTMLElement) {
  const body = target.closest("tbody");
  const scope = body?.closest<HTMLElement>(SCOPE);
  if (!body || !scope) return false;
  const pager = own(scope, scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => PAGE_BUTTONS[event.key as "PageDown" | "PageUp"].test(nameOf(button)));
  if (!pager) return false;
  if (!pager.disabled) {
    // The page comes from the server: the keyboard goes to its first row once it has arrived (up to 5 s).
    const before = listRows(body)[0], started = performance.now();
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

/** ↑ on the first row of a list goes back up to the search of its window. */
function upToSearch(target: HTMLElement) {
  const row = target.closest("tr"), body = row?.parentElement;
  if (!row || !(body instanceof HTMLTableSectionElement) || body.tagName !== "TBODY" || listRows(body)[0] !== row) return false;
  if (target !== row && (isTextEntry(target) || target instanceof HTMLSelectElement)) return false;
  const scope = row.closest<HTMLElement>(SCOPE);
  const search = scope ? searchField(scope) : null;
  if (!search) return false;
  search.focus();
  search.select?.();
  return true;
}

/** ↓ from the search of a window goes straight down to its list. */
function searchToList(target: HTMLElement) {
  const scope = target.closest<HTMLElement>(SCOPE);
  if (!scope || !(target instanceof HTMLInputElement) || (target.type !== "search" && searchField(scope) !== target)) return false;
  const list = scopeList(scope);
  if (!list || list.contains(target)) return false;
  focusRow(chosenRow(listRows(list)));
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
  if (list && !list.contains(target)) { focusRow(chosenRow(listRows(list))); return true; }
  mainButton(form ?? container)?.focus();
  return true;
}

function advanceField(event: KeyboardEvent, target: HTMLElement) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || (target instanceof HTMLInputElement && ["button", "submit", "reset", "image", "file"].includes(target.type))) return;
  if (target.closest('[data-keyboard-enter="native"]')) return;
  if (stepField(target, event.shiftKey, true)) event.preventDefault();
}

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The option of the menu that is open, otherwise its first one (after signing in, after closing the last window). */
export function focusMenu(doc: Document = document) {
  const menu = doc.querySelector<HTMLElement>("[data-keyboard-menu]");
  if (!menu) return false;
  const items = [...menu.querySelectorAll<HTMLElement>("button,a[href]")].filter((item) => isShown(item) && isEnabled(item));
  (items.find((item) => item.getAttribute("aria-current") === "page") ?? items[0])?.focus();
  return true;
}

/** → opens a section of the menu and ← closes it (or goes back to the section of its option). ↑ ↓ are Tabster's. */
function openOrCloseSection(event: KeyboardEvent, target: HTMLElement) {
  if (!target.closest("[data-keyboard-menu]") || !(target.hasAttribute("aria-expanded") || target.closest(".nav-group"))) return false;
  const expanded = target.getAttribute("aria-expanded");
  if (event.key === "ArrowRight" && expanded === "false") target.click();
  else if (event.key === "ArrowLeft" && expanded === "true") target.click();
  else if (event.key === "ArrowLeft") target.closest(".nav-group")?.querySelector<HTMLElement>(".nav-group-trigger")?.focus();
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
/** «¿Cerrar sin guardar?» A native modal dialog: the keyboard stays in it, ← → go between Sí and No, Esc means No. */
export function askDiscard(message = "Hay cambios sin guardar. ¿Cerrar sin guardarlos?"): Promise<boolean> {
  if (asking) return asking;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.className = "cyp-keyboard-confirm";
  dialog.setAttribute("aria-label", "Cambios sin guardar");
  dialog.setAttribute(TABSTER_ATTRIBUTE_NAME, dialogKeys("cyp-keyboard-confirm")[TABSTER_ATTRIBUTE_NAME]!);
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

// ── Where the keyboard starts and comes back ─────────────────────────────────────────────────────────────────
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

/** The keyboard is nowhere (what had it disappeared): the dialog open, otherwise the window in front, otherwise the menu. */
function rescueFocus(doc: Document = document) {
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  const modal = [...doc.querySelectorAll<HTMLElement>(MODAL)].filter(isShown).pop();
  if (modal) { if (!modal.contains(doc.activeElement)) focusFirstUseful(modal); return; }
  focusAfterClosing(doc);
}

let waitingFor: HTMLElement | null = null;
/**
 * The keyboard goes back to this element as soon as it can take it again (a button disabled while its request runs, a
 * field saving), unless it was taken elsewhere meanwhile. A client search (combobox) takes it back without unfolding its
 * list over the form (its quiet focus). After `limit` ms without it, the keyboard is rescued.
 */
function comeBackTo(element: HTMLElement, limit: number) {
  waitingFor = element;
  const started = performance.now();
  const attempt = () => {
    if (waitingFor !== element) return;
    const active = document.activeElement;
    if (active && active !== document.body) { waitingFor = null; return; }
    if (element.isConnected && isShown(element) && isEnabled(element)) {
      if (element.getAttribute("role") === "combobox") element.dataset.quietFocus = "1";
      element.focus();
      if (document.activeElement === element) { waitingFor = null; return; }
      delete element.dataset.quietFocus;
    }
    // Gone (the button that opened a dialog, replaced when it closed): the screen may place the keyboard meanwhile.
    if (performance.now() - started > limit) { waitingFor = null; rescueFocus(); return; }
    window.setTimeout(attempt, 50);
  };
  attempt();
}

/** A dialog closed gives the keyboard back to what opened it. Nothing is done when the keyboard is already somewhere. */
export function giveFocusBack(element: Element | null) {
  if (element instanceof HTMLElement) comeBackTo(element, 1500);
  else window.setTimeout(rescueFocus, 200);
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
/** Installs Tabster and the keyboard rules of CyP once for the page. `windows`: the desktop closes its window in front with Esc. */
export function installKeyboard({ windows = true }: { windows?: boolean } = {}) {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Before Tabster sees the key: AvPág and RePág in a list that comes in pages from the server turn its page.
  window.addEventListener("keydown", (event) => {
    if ((event.key !== "PageDown" && event.key !== "PageUp") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !(event.target instanceof HTMLElement)) return;
    if (turnPage(event, event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  // Tabster moves Tab itself, so it adds nothing inside the bars and lists of the screens.
  const tabster = createTabster(window, { autoRoot: {}, controlTab: true });
  getMover(tabster);
  // The dialogs already say they are modal (aria-modal, showModal, Radix): Tabster keeps Tab in them and hides nothing.
  getModalizer(tabster, undefined, () => true);
  markAreas(document);
  new MutationObserver((records) => { if (records.some((record) => record.addedNodes.length)) markAreas(document); })
    .observe(document.body, { childList: true, subtree: true });

  let lastInput: "keyboard" | "pointer" = "keyboard";
  document.addEventListener("keydown", () => { lastInput = "keyboard"; }, true);
  document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
  document.addEventListener("focusin", (event) => {
    const target = event.target as Element;
    if (target.matches?.(FIELD) && !firstValue.has(target)) firstValue.set(target, valueOf(target));
    const window_ = target.closest?.(".mdi-window");
    if (window_ && target instanceof HTMLElement && !target.closest(FRAME)) lastFocusOf.set(window_, target);
    if (lastInput !== "keyboard" || !(target instanceof HTMLTableRowElement) || !target.hasAttribute("tabindex")) return;
    const table = target.closest("table");
    if (table?.getAttribute(TABSTER_ATTRIBUTE_NAME) !== LIST || !(target.parentElement instanceof HTMLTableSectionElement)) return;
    // Coming into a list, the keyboard goes to its chosen row; a row reached with the keys is chosen, as a click chooses it.
    const chosen = listRows(target.parentElement).find(isChosen);
    if (chosen && chosen !== target && !(event.relatedTarget instanceof Node && table.contains(event.relatedTarget))) { focusRow(chosen); return; }
    if (!isChosen(target)) target.click();
  });
  // Working with the keyboard, it is never left nowhere. What had it was disabled while its request runs: it waits for
  // it. Otherwise, if the screen does not place it in a moment, it is rescued.
  document.addEventListener("focusout", (event) => {
    const left = event.target;
    if (lastInput !== "keyboard" || event.relatedTarget || !(left instanceof HTMLElement)) return;
    if (left.isConnected && isShown(left) && !isEnabled(left)) { comeBackTo(left, 5000); return; }
    window.setTimeout(() => { if (lastInput === "keyboard" && !waitingFor) rescueFocus(); }, 200);
  });
  document.addEventListener("input", (event) => typedIn.add(event.target as Element), true);
  // A money field writes its own digits (no input event): a key typed in a field counts as typing in it.
  document.addEventListener("keydown", (event) => {
    const target = event.target as Element;
    if (target.matches?.(FIELD) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) typedIn.add(target);
    // A held Enter repeats: it must not press, one after another, the button that a dialog just put under it.
    if (event.key === "Enter" && event.repeat && target.matches?.("button,[role=button]")) event.preventDefault();
  }, true);
  document.addEventListener("paste", (event) => typedIn.add(event.target as Element), true);
  document.addEventListener("change", (event) => typedIn.add(event.target as Element), true);
  // After Tabster and the screen: only what they left alone.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!event.shiftKey) {
      if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && openOrCloseSection(event, target)) { event.preventDefault(); return; }
      if (event.key === "ArrowUp" && upToSearch(target)) { event.preventDefault(); return; }
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
