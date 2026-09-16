# CyP web design system

Two specialized Spanish-language web experiences share one API: a desktop/tablet administration dashboard and a mobile-first collector PWA. The visual direction is a calm operational workspace with slate surfaces, emerald cash-status accents, Inter typography and clear numeric hierarchy. Financial values use the `es-DO` locale and RD$ formatting; calculations remain integer centavos.

This document specifies the target behavior and distinguishes platform limits. It does not inherit the legacy Ext JS/XP UI. Implementation lives in the two frontend workspaces; inspect their CSS for exact current token values as the scaffold evolves.

## Foundations

| Token                | Specification                                                                | Use                                             |
| -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Background           | Slate 50 `#f8fafc`                                                           | App canvas                                      |
| Surface              | White `#ffffff`                                                              | Cards, tables, drawers                          |
| Strong text          | Slate 950 `#020617` / 900 `#0f172a`                                          | Titles and primary content                      |
| Muted text           | Slate 500 `#64748b` / 600 `#475569`                                          | Supporting labels, timestamps                   |
| Borders              | Slate 200 `#e2e8f0`, with subtle alpha on decorative dividers                | Inputs, cards and table separators              |
| Primary              | Emerald 600 `#059669`, darkened to 700 `#047857` as needed for text contrast | Main actions and confirmed balance              |
| Success              | Emerald 50/700                                                               | Confirmed collection and balanced status        |
| Warning              | Amber 50/700                                                                 | Priority or approaching limit                   |
| Danger               | Rose 50/700 or red 600                                                       | Discrepancy, rejected operation, exceeded limit |
| Information          | Blue 50/700                                                                  | Neutral operational context                     |
| Focus                | Visible 2–3 px primary/blue ring with offset                                 | Keyboard focus on every action                  |
| Card radius          | 12–16 px                                                                     | Primary containers                              |
| Small control radius | 8–12 px                                                                      | Buttons, inputs, filters                        |
| Sheet radius         | 24 px top corners                                                            | Collector action sheet                          |
| Shadow               | Low-opacity, short neutral shadow                                            | Raised cards; stronger only for overlays        |

Use color with text and icons; a red number alone is not a sufficient discrepancy explanation. Verify actual foreground/background combinations for readable contrast. Preserve browser zoom and support text expansion without truncating money values.

Inter is self-hosted through font packages where used, with system sans-serif fallbacks. Body text is 14–16 px, metadata 12–13 px, section headings 18–24 px, page headings 28–36 px, and key cash amounts 30–44 px. Use tabular numerals for money, aligned decimals in tables, 500/600 weight for labels, and 700 for selected totals. Do not use all-bold tables.

Spacing follows a 4 px base: 4, 8, 12, 16, 20, 24, 32 and 48 px. Prefer 20–24 px card padding on desktop and 16–20 px on mobile. Keep primary touch actions at least 44 × 44 px; the collection keypad should be larger. One primary action per local task region makes the next step clear.

## Responsive structure

| Width        | Admin                                                                                | Collector                                                                                |
| ------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 320–639 px   | Compact header, drawer/collapsed navigation, stacked cards, intentional table scroll | Primary design target; full-width route cards, fixed safe-area bottom nav, bottom sheets |
| 640–1023 px  | Compact sidebar, two-column summaries, responsive detail drawer                      | Comfortable centered route view; preserved thumb actions                                 |
| 1024–1279 px | Expanded sidebar and desktop table/dashboard                                         | Mobile-width operational column within neutral canvas                                    |
| ≥1280 px     | Full analytics grid and map/details side by side                                     | Centered experience without stretched keypad/buttons                                     |

Sticky headers should not obscure focused inputs or anchor targets. Reserve bottom content padding for collector navigation and device safe areas. Sheets must remain usable with the soft keyboard open; long sheet content scrolls while the action remains reachable. Test horizontal overflow at 320 px and zoomed text.

## Shared component primitives

React + TypeScript, Tailwind foundations, Lucide icons, Radix dialog/sheet focus behavior, and Sonner toast feedback provide the shared component approach. Use CSS transitions or a motion library where beneficial; a particular animation package is not required for every interaction. Honor `prefers-reduced-motion`; never animate cash values in ways that obscure the final amount.

| Component      | Required behavior                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Button         | Primary/secondary/ghost/danger variants; text labels; disabled and pending state; prevent accidental double submission |
| Input          | Persistent label, correct input mode, help/error text association; preserve values after validation failure            |
| Money input    | Clear currency context, integer-centavo conversion, no floating-point computation; reject invalid/negative entries     |
| Badge          | Icon or text plus semantic color; explicit “Obligado a cobrar” priority copy                                           |
| Card           | Title, optional subtitle/action, orderly value hierarchy; avoid making unrelated whole surfaces clickable              |
| Sheet/dialog   | Named title, focus trap, Escape/close affordance, focus restoration; preserve pending operation state                  |
| Toast          | Short confirmation or failure; financial errors also remain inline until resolved                                      |
| Skeleton       | Stable layout footprint; distinguish initial load from background refresh                                              |
| Empty state    | Relevant icon, concrete explanation and a useful next action when available                                            |
| Error boundary | Friendly fallback, retry/reload action, technical detail kept out of the normal workflow                               |

All icon-only controls need accessible names. Status changes use a polite announcement; blocking validation links focus to the relevant input. Tabs, menus, sortable headers and dialogs remain keyboard accessible.

## Administration portal

The sidebar groups Resumen, Cargos/Cobros, Descargos/Pagos, Cobradores/Rutas, Clientes and Cuadre. Use a sticky header with the current business date, environment indicator, Cmd/Ctrl+K client/route search and a notification drawer. The command palette filters permitted records and supports keyboard selection.

Summary KPI cards display Total recaudado hoy, Total pagos/remesas, Cobradores en ruta and Desbalance detectado. Compact sparklines supply context without implying unprovided historic precision. Clearly label synthetic seed data as “Entorno de demostración.” Current totals must come from the API, including after mutations.

Tables provide text filtering, status chips, sortable fields, column visibility, pagination and selected-row actions. Selection counts remain visible. Batch generation presents amount/service/date/required flags before submission and retains a stable idempotency key for an operation retry. Distinguish “no records” from “no results with these filters.”

The Leaflet collector map uses custom status pins, explicit active/offline/limit labels, location timestamps, provider attribution and a detail drawer with cash/limits/route. A list view carries equivalent information when tiles fail or a map is inaccessible. A stored coordinate is not proof that a collector is currently online. Production status must derive from observed tracking timestamps and a documented stale threshold.

The Cuadre workspace presents four signed components and a large final difference:

```text
Cobrado − Depositado + Entregado por oficina − Pagado a clientes
```

Use emerald with “Cuadrado” for exact zero and danger color with a plain-language discrepancy for nonzero. The close action stays unavailable until the server preview is zero. The API independently recomputes and validates totals; a visual zero never authorizes a client-only closure. Expose understandable error text if another operation changes the balance before submission.

## Collector portal

A sticky pocket pill shows RD$ in hand and its limit context. The separate collection/office-advance limits must be explainable; do not silently merge them into one risk rule. Bottom navigation keeps Ruta, Actividad/Recibos and Bolsillo/Cuadre reachable. Geolocation is an intentional action requiring browser permission; failure must leave collection available where business rules permit.

Route cards prioritize client name, address/route context, due amount and primary “Cobrar” action. Offer Todos, Pendientes, Cobrados and Con atraso filters. Highlight required services with the exact badge **“Obligado a cobrar”**; it is an operational priority, not an automatic charge or an authorization bypass.

Collection opens a bottom sheet with a large amount display, numeric keypad and one clear confirm action. Optional bill/coin breakdown is collapsed by default and must not block ordinary collection. When enabled, show denomination, quantity, subtotal and summed total, rejecting a mismatch with entered cash. A pending request disables the primary action and preserves its idempotency key for a network retry. Display success only after authoritative API acceptance.

The digital receipt uses a compact, legible hierarchy: transaction type, amount, client, collector, timestamp and reference. Copy link and WhatsApp share use the explicitly invoked action; never send a message automatically. The server's public receipt exposes only the minimum receipt fields, excluding phone/address. Revocation stops share access without reversing the movement.

Provide separate browser print and ESC/POS 58/80 mm output controls. ESC/POS bytes can be downloaded and sent through a compatible OS/printer bridge. A normal web page cannot silently address arbitrary thermal printers; UI copy must explain that bridge requirement when relevant.

## Loading, failures and offline behavior

| Situation                     | Presentation and action                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Initial load                  | Screen-shaped skeleton and accessible loading status                                                 |
| Background refresh            | Keep last successful data visible with pending/stale indication                                      |
| Empty route/list              | Friendly contextual message, active filter indication and clear-reset action                         |
| Form validation               | Specific inline error; preserve input and focus relevant field                                       |
| Limit or closed-day rejection | Explain the actual business reason; do not automatically change amount or date                       |
| Network failure               | Retry affordance with stable operation key; no false receipt/success                                 |
| Expired identity              | Return to sign-in while avoiding secret-bearing URL parameters                                       |
| Offline PWA                   | Cached static shell and explicit offline status; do not claim an unconfirmed cash movement was saved |

The service worker caches static application assets only. Financial API responses, credentials and receipt secrets must not be placed in a broad offline cache. Offline transaction queuing and conflict resolution are outside the initial scaffold unless separately implemented and tested.

## Review checklist

Verify both roles at desktop and phone widths, keyboard access, reduced motion, long client names, large monetary values, zero and nonzero settlement states, pending/double-tap behavior, denied geolocation, unavailable map tiles, empty/filtered data, API errors and offline reload. Use actual rendered app evidence for completion claims; this specification alone is not proof of implemented behavior.
