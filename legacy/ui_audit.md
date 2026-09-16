# Legacy web audit — Cobros y Pagos

Audit date: **2026-09-16**, capture started **14:58 UTC / 10:58 America/Santo_Domingo**.

Target: [live demo](http://gdemos.ddns.net/cypdemo/). Initial scope: read-only, unauthenticated public HTTP surface. Twelve GET requests returned HTTP 200: the landing page, its declared application target, and ten linked same-origin JavaScript/CSS resources. A subsequent, explicitly authorized browser check tried two example credentials (details below). No financial records were created or changed.

**Result: the public audit is complete; the authenticated sitemap, business forms, and permission hierarchy are blocked by missing working demo credentials.** The application presents Usuario, Clave, and Estación. The two authorized example logins were rejected. This document does not claim to have inspected authenticated screens.

### Authorized browser follow-up

On the same audit date, the user expressly authorized a bounded check using `admin/admin`, `admin/123456`, or `1/1`. The browser displayed the ordinary login UI with no lockout warning. At the default station `ADM001`, `admin/admin` and `1/1` each returned **“Error iniciando sesión de usuario … Usuario no encontrado.”** The alternative admin password was not tried because the server had already reported that the admin username was absent. Exactly two login submissions were made; no station enumeration, broader guessing, password reset, or access-control bypass was attempted. The tab was closed after dismissing the error. This browser follow-up is separate from the GET-only reproducible collector.

## Evidence and reproducibility

Run from the repository root with Python 3.10 or newer:

```powershell
python .\legacy\web\audit_public.py
```

The standard-library-only collector follows the landing page's declared meta refresh and fetches linked same-origin JS/CSS. It refuses automatic HTTP redirects and never submits a form, constructs event requests, enumerates guessed URLs, or fetches external script providers. It saves:

- [Request manifest](web/audit-manifest.json): capture time, observed status, original response byte hashes, content types, version evidence, and selected headers.
- [Landing HTML](web/landing.redacted.html): the public entry document.
- [Login HTML](web/login.redacted.html): generated public Ext component definitions and their handlers.
- [Audit script](web/audit_public.py): reproducible collection procedure.

The anonymous session identifier and embedded public Google Maps API key are redacted before persistence. Hashes in the manifest refer to original response bytes, so the redacted HTML will intentionally have different hashes. JavaScript libraries were inspected for version markers; their complete third-party source is not vendored. Application session IDs and generated object IDs can change between runs.

The web research tool rejected opening the demo URL; ordinary HTTP GET requests on this machine succeeded. Stack interpretation was cross-checked against the official [uniGUI deployment documentation](https://www.unigui.com/doc/online_help/deployment_options.htm) and [Sencha Ext JS 3.4.0 documentation](https://docs.sencha.com/extjs/3.4.0/).

## Evidence labels

- **Observed:** present in the captured response/source or a successful requested resource. Source inspection is not proof that a hidden UI element is reachable.
- **Inferred:** an interpretation supported by observations and, where relevant, vendor documentation.
- **Required target:** a new application requirement from the mission; not a finding about the legacy implementation.
- **Blocked / unknown:** requires an authenticated session, database inspection, or server configuration access.

## Observed public sitemap and endpoint inventory

```text
/cypdemo/                                      [observed, HTTP 200]
  └─ meta refresh after 1 second
     /cypdemo/cyp10_front.dll?CID=cypdemo        [observed, HTTP 200]
       ├─ MainForm shell                       [observed in generated source]
       ├─ StandardLoginWithStationForm         [observed in generated source]
       ├─ /cypdemo/cyp10_front.dll/HandleEvent  [referenced; not invoked]
       └─ /cypdemo/cyp10_front.dll/ext-3.4.0/
          ├─ resources/css/uni-ext.css          [observed, HTTP 200]
          ├─ resources/css/ext-all.css          [observed, HTTP 200]
          ├─ resources/css/xtheme-xp.css        [observed, HTTP 200]
          ├─ adapter/ext/ext-base.js            [observed, HTTP 200]
          ├─ ext-all.js                        [observed, HTTP 200]
          ├─ ext-sync-1.4.1-min.js              [observed, HTTP 200]
          ├─ ext-unigui-1.4.1-min.js            [observed, HTTP 200]
          ├─ examples/ux/ux-all.js              [observed, HTTP 200]
          ├─ examples/ux/css/ux-all.css         [observed, HTTP 200]
          └─ src/locale/ext-lang-es.js          [observed, HTTP 200]
```

Other references in source, **not requested**:

| Reference | Source evidence | Limits |
| --- | --- | --- |
| `imgs/cobrosypagos.png`, `imgs/banner.png` | Two `Ext.BoxComponent` image URLs | Image content and post-login placement unverified |
| `.../resources/images/default/s.gif` | Ext blank image URL | Runtime support asset |
| `.../cache/cyp10_front/__….png` | Login logo source | Generated cache asset, not an application page |
| `.../cache/cyp10_front/<session>/favicon.ico` | Shortcut icon link | Session segment redacted in saved source |
| `http://maps.googleapis.com/maps/api/js?sensor=false` | Script tag | External provider not fetched |
| Same Maps URL plus `key=…` | Second script tag | Public client key redacted; key restrictions unknown |

The `MainForm` source defines a hidden toolbar (`pnlMain`, `hidden:true`) containing `Usuario`, `Rol`, `Versión`, and server time labels. It also defines labels/handlers for showing the menu, notifications, technical-support invoices, payments to technical support, “qué hay de nuevo,” and pending authorizations. These are **source-visible candidates**, not verified navigable modules. In particular, the technical-support payment label is not evidence of the requested customer payout workflow.

All observed runtime event handler URLs converge on `HandleEvent`; the source supplies event/object parameters such as `Ajax`, `IsEvent`, `Obj`, `Evt`, and field values. This is a generated server-driven UI transport, not an observed business REST API. No separate Cargos, Cobros, Descargos, Pagos, Cuadres, or Tracking HTTP resource URLs were exposed in the public source.

## Login field audit

| Visible label / action | Source component | Observed properties | Validation not established |
| --- | --- | --- | --- |
| Usuario | `edtUsuario` / `Ext.form.TextField` | 95 × 22 px; keyboard event handlers; no prefilled username | Allowed characters, length, required rule, case handling |
| Clave | `edtClave` / `Ext.form.TextField` | `inputType:"password"`; 95 × 22 px; keyboard event handlers | Password rules, lockout, rate limits, MFA, credential storage |
| Estación | `lcbxEstacion` / `Ext.form.ComboBox` | Non-editable local selector; default `ADM001` | Relationship to account, route, office, and authorization |
| Ok | `btnOk` / `Ext.Button` | 75 × 25 px; event handler; login loading mask message; two example users rejected with “Usuario no encontrado” | Successful authentication behavior and remaining error cases |
| Cancelar | `btnCancel` / `Ext.Button` | 75 × 25 px; event handler | Cancellation behavior, because not invoked |

Observed station values, in source order: `ADM000`, `ADM001`, `ECP001`, `ECP002`, `ECP003`, `ECP005`, `ECP004`, `ECP015`, `ECP000`. These are selectable station codes, **not confirmed roles or permissions**. The meaning of ADM/ECP is unverified.

The login window title is “Inicio de Sesión…”, with modal behavior, an absolute layout, fixed 322 × 166 px size, no close button, and resizing disabled. The source does not emit a conventional HTML `<form action=…>`; Ext components and event callbacks implement the interface.

## Permission hierarchy

| Layer | Evidence | Conclusion |
| --- | --- | --- |
| Anonymous | Landing page and login source accessible by GET | Public login surface exists |
| Station selection | Nine station codes before login | A station context participates in login; enforcement unknown |
| Authenticated identity | Hidden `lblUsuario` and `lblRol` labels | The shell anticipates user and role values; actual role names unknown |
| Module permissions | Authenticated menu inaccessible | No role-to-module or role-to-operation grants can be claimed |
| Record and route ownership | No authenticated data accessible | Collector scoping, office scoping, and authorization checks unverified |
| Approval permissions | Hidden `lblAutrhorizationsPending` name | Approval UI may exist; workflow and permissions unverified |

The mission's administration and collector personas are **required target personas**. They must not be described as a reverse-engineered legacy permission hierarchy. The replacement must enforce permissions in its single API, irrespective of frontend navigation visibility.

## Requested business form audit and migration capture checklist

None of the four requested business forms occurs in the unauthenticated response. The table below records the blocker and the minimum follow-up evidence to collect. Proposed fields come from the modernization requirements and domain needs; they are not discovered legacy column names.

| Form | Legacy observation | Required follow-up evidence | Required target / proposed field set |
| --- | --- | --- | --- |
| Cargos | **Blocked:** no authenticated screen or field definitions | Labels, field types, mandatory flags, defaults, service/client lookup rules, recurrence, partial balance, reversal behavior, “Obligado a cobrar” meaning | Client, service, amount, due date, recurrence if applicable, required-collection flag, notes, status; no fiscal tax or loan amortization |
| Descargos | **Blocked:** no authenticated screen or field definitions | Determine whether the legacy term means a payable order, debt adjustment, write-off, or another operation; approval, cash effect, links to Pagos | Target mission treats the operation within cash-out management; client, amount, reason/reference, status, payment linkage; preserve explicit distinction between obligation and physical cash movement |
| Cuadre | **Blocked:** no authenticated screen or field definitions | Collector/date scope, cash sources, counted vs expected amounts, deposit/office-delivery evidence, closure lock/reopen permissions, historic formula | Cobrado, Depositado, EntregadoPorOficina, PagadoAClientes, computed Diferencia; strict zero closure; `LimiteCobro` and `LimitePago` |
| Desglose de billetes | **Blocked:** denomination list, quantity controls, and required/optional behavior unknown | Exact supported denominations, quantity vs amount entry, sums, allowed tender, scope of saved breakdown, print display | Optional toggle by default; denomination, quantity, line amount, total; validate total equals entered cash when breakdown is supplied |

Required target balance equation, supplied by the mission:

```text
Diferencia = (Cobrado - Depositado)
           + (EntregadoPorOficina - PagadoAClientes)
```

No claim is made that the legacy server uses this equation or enforces zero closure; this is a mandatory replacement rule to test independently. Cargos/Descargos should not directly change physical cash merely by creating an obligation. Confirm the legacy meanings before any data migration maps those terms to the target model.

## Technology diagnosis

| Finding | Confidence and evidence |
| --- | --- |
| Microsoft IIS 8.5 response signature | **Observed:** all captured responses identify `Microsoft-IIS/8.5`. Header is a server claim, not a verified OS/package inventory. |
| Ext JS 3.4.0 | **Observed:** explicit resource path and library version markers in fetched resources. The XP theme carries a separate older 3.0.0 marker; that does not change the main library evidence. |
| uniGUI client bridge | **Observed:** `ext-unigui-1.4.1-min.js`, `ext-sync-1.4.1-min.js`, `UNI_GUI_SESSION_ID`, generated Ext forms, and DLL event transport. The bridge filename is not proof of the exact installed uniGUI server version. |
| Delphi/uniGUI ISAPI module hosted by IIS | **Strong inference:** the DLL endpoint and uniGUI bridge match the vendor's IIS ISAPI deployment pattern. Vendor docs state this deployment emits a DLL and uses IIS as its HTTP server. Exact compiler version and module binary are inaccessible. |
| Classic ASP or ASP.NET WebForms | **Not established:** no `.asp`/`.aspx` navigation, `__VIEWSTATE`, or `__EVENTVALIDATION` appears in captured source. Windows-like appearance alone does not identify ASP technology. |
| Standalone Windows service | **Not established:** the public evidence favors an IIS DLL endpoint. Process list, app pool mode, identity, bitness, recycling configuration, and any upstream proxy require server access. |
| Server-driven, stateful UI | **Observed/inferred:** generated object IDs and `HandleEvent` callbacks are observed; broader uniGUI server session architecture is documented by the vendor. |
| SQL Server backing this particular endpoint | **Unknown from web:** cannot prove database connection, schema, or backend queries using the public login source. Inspect backup separately. |

Vendor references: [deployment modes](https://www.unigui.com/doc/online_help/deployment_options.htm), [IIS 7 and later setup](https://www.unigui.com/doc/online_help/iis_7_0.htm), [ISAPI considerations](https://unigui.com/doc/online_help/isapi-module-related.htm), and [Ext JS API](https://docs.sencha.com/extjs/3.4.0/). These establish framework behavior, not this server's private configuration.

## Observed technical and interaction debt

1. **Transport and session defaults:** the audited login is delivered over HTTP. Its anonymous `Set-Cookie` includes `Path=/` and lacks `Secure`, `HttpOnly`, and `SameSite` attributes in the captured response. No authentication submission succeeded. HTTPS availability and post-login cookie policy were not tested. The replacement should use HTTPS and protected server-managed sessions.
2. **Generated executable responses:** the public `AjaxSuccess` handler evaluates `response.responseText`; extensive inline script builds the interface. Replace this coupling with typed JSON API responses and declarative web components. The audit did not test for script injection.
3. **Desktop geometry:** absolute layouts, 11 px Tahoma text, 75 × 25 px buttons, and a fixed login window are observed in source. Replace them with responsive layouts, accessible typography, keyboard navigation, and adequately sized touch controls.
4. **Zoom disabled:** the viewport declaration contains `maximum-scale=1.0` and `user-scalable=0`. Preserve user zoom in both modern portals.
5. **Legacy dependency surface:** Ext resources advertise 2011 last-modified dates and the bridge files 2012 dates. These are resource metadata, not proof of application release date or known vulnerabilities. Dependency modernization is necessary without copying the legacy libraries.
6. **Duplicate external Maps includes:** source references the Maps loader twice over HTTP, once with a key. Restrictions, billing, and actual map use are unknown. The replacement's chosen map implementation should have one intentional provider integration and documented attribution.
7. **State coupling:** page object IDs, event transport, and periodic timer callbacks make UI flows difficult to treat as stable integration contracts. The new API must expose explicit resource operations and audit events.
8. **Public infrastructure disclosure:** station choices and a hidden Windows-style version label are included before authentication. Review which deployment details should appear in the replacement's public login.

Missing CSP, HSTS, frame, nosniff, and referrer headers are recorded for these HTTP responses. Their absence is an observation, not an exploit demonstration or a complete security assessment. No financial data or access-control bypass was tested; credential checks were restricted to the two user-authorized examples above.

## Remaining evidence needed to finish Phase 2

An authorized demo account for each relevant role and station is required. Use a read-only role or isolated demo dataset to capture:

1. Every actual menu item, child form, report, and navigation destination per role.
2. Cargos, Descargos, Cuadre, and bill/coin breakdown forms, including defaults, error messages, required flags, and keyboard/touch behavior.
3. Whether record ownership is constrained by collector, station, office, date, or route.
4. Read-only details of receipts, charge recurrence, “Obligado a cobrar,” balances, limits, and closure history.
5. The meaning and lifecycle of reversals, adjustments, authorization requests, and closed-day corrections.

Record any behavioral test that requires creating or changing a transaction separately from this read-only audit. Until authenticated evidence is available, the modern scaffold follows the mission's requirements and explicitly documented design decisions rather than fabricated legacy behavior.
