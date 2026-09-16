import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Filter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { dateLabel, money, statusLabel } from "./api";
import { Avatar, Badge, Empty } from "./components";
import { exportCsv } from "./Dashboard";
import type { Snapshot } from "./types";

export default function Directory({
  snapshot,
  kind,
  onCreate,
  onBatch,
  initialSearch = "",
}: {
  snapshot: Snapshot;
  kind: "clients" | "charges" | "payouts";
  onCreate: () => void;
  onBatch: (ids: string[]) => void;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch),
    [status, setStatus] = useState("all"),
    [route, setRoute] = useState("all"),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({
      key: "name",
      asc: true,
    }),
    [columns, setColumns] = useState({ route: true, service: true, due: true });
  const rows = useMemo(
    () =>
      kind === "clients"
        ? snapshot.clients.map((c) => ({
            id: c.id,
            clientId: c.id,
            name: c.name,
            code: c.code,
            phone: c.phone,
            routeId: c.routeId,
            service: c.address,
            amount: snapshot.charges
              .filter((ch) => ch.clientId === c.id && ch.status !== "cancelled")
              .reduce((sum, ch) => sum + ch.amount - ch.collected, 0),
            due: "",
            status: snapshot.charges.some(
              (ch) =>
                ch.clientId === c.id &&
                ["pending", "partial"].includes(ch.status),
            )
              ? "pending"
              : "paid",
            required: false,
          }))
        : kind === "charges"
          ? snapshot.charges.map((c) => {
              const client = snapshot.clients.find(
                (cl) => cl.id === c.clientId,
              )!;
              return {
                id: c.id,
                clientId: c.clientId,
                name: client?.name ?? "Cliente",
                code: client?.code ?? "",
                phone: client?.phone ?? "",
                routeId: client?.routeId ?? "",
                service: c.service,
                amount: c.amount - c.collected,
                due: c.dueDate,
                status: c.status,
                required: c.required,
              };
            })
          : snapshot.payouts.map((p) => {
              const client = snapshot.clients.find(
                (cl) => cl.id === p.clientId,
              )!;
              return {
                id: p.id,
                clientId: p.clientId,
                name: client?.name ?? "Cliente",
                code: client?.code ?? "",
                phone: client?.phone ?? "",
                routeId: client?.routeId ?? "",
                service: p.concept,
                amount: p.amount - p.paid,
                due: "",
                status: p.status,
                required: false,
              };
            }),
    [kind, snapshot],
  );
  const filtered = rows
    .filter(
      (r) =>
        `${r.name} ${r.code} ${r.service}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()) &&
        (status === "all" || r.status === status) &&
        (route === "all" || r.routeId === route),
    )
    .sort((a, b) => {
      const aValue = sort.key === "amount" ? a.amount : a.name,
        bValue = sort.key === "amount" ? b.amount : b.name;
      return (
        (typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue))) * (sort.asc ? 1 : -1)
      );
    });
  const pages = Math.max(1, Math.ceil(filtered.length / 6)),
    currentPage = Math.min(page, pages),
    visible = filtered.slice((currentPage - 1) * 6, currentPage * 6);
  const allSelected =
    visible.length > 0 && visible.every((row) => selected.includes(row.id));
  const sortBy = (key: string) =>
    setSort((current) => ({
      key,
      asc: current.key === key ? !current.asc : true,
    }));
  const sortIcon = (key: string) =>
    sort.key === key ? (
      sort.asc ? (
        <ArrowUp size={13} />
      ) : (
        <ArrowDown size={13} />
      )
    ) : (
      <ArrowUpDown size={13} />
    );
  const title = {
    clients: "Clientes",
    charges: "Cargos pendientes por ruta",
    payouts: "Descargos (Pagos / Remesas)",
  }[kind];
  const subtitle = {
    clients: "Mantenimiento de clientes, rutas asignadas y datos de contacto.",
    charges:
      "Cargos simples, recurrentes y servicios obligados a cobrar por ruta.",
    payouts: "Tickets u órdenes de pago al beneficiario para remesas.",
  }[kind];
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">GESTIÓN OPERATIVA</div>
          <h1>
            {title}
            <span className="title-dot">.</span>
          </h1>
          <p>{subtitle}</p>
        </div>
        <button
          className="btn primary"
          onClick={
            kind === "clients"
              ? () => onBatch(snapshot.clients.map((c) => c.id))
              : onCreate
          }
        >
          <Plus size={17} />
          {kind === "clients"
            ? "Cargo recurrente"
            : kind === "charges"
              ? "Nuevo cargo"
              : "Nuevo descargo"}
        </button>
      </div>
      <div className="directory-stats">
        <div>
          <span>
            {kind === "clients"
              ? "Total de clientes"
              : kind === "charges"
                ? "Cargos registrados"
                : "Descargos registrados"}
          </span>
          <strong>{rows.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Pendientes</span>
          <strong>
            {rows
              .filter((r) => ["pending", "partial"].includes(r.status))
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>Saldo pendiente</span>
          <strong>
            {money(
              rows
                .filter((r) => r.status !== "cancelled")
                .reduce((sum, r) => sum + r.amount, 0),
            )}
          </strong>
        </div>
      </div>
      <section className="panel directory-panel">
        <div className="directory-tabs">
          {[
            { id: "all", label: "Todos" },
            { id: "pending", label: "Pendientes" },
            { id: "partial", label: "Parciales" },
            { id: "paid", label: "Completados" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={status === tab.id ? "active" : ""}
              onClick={() => {
                setStatus(tab.id);
                setPage(1);
              }}
            >
              {tab.label}
              <span>
                {
                  rows.filter((r) => tab.id === "all" || r.status === tab.id)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input
              aria-label="Buscar clientes o conceptos"
              placeholder={
                kind === "payouts"
                  ? "Buscar cliente, beneficiario o remesa…"
                  : "Buscar cliente, código o concepto…"
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="icon-button small"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <label className="route-filter">
            <Filter size={15} />
            <select
              aria-label="Filtrar por ruta"
              value={route}
              onChange={(event) => {
                setRoute(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas las rutas</option>
              {snapshot.routes.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <details className="column-menu">
            <summary className="btn">
              <Columns3 size={16} />
              Ver columnas
            </summary>
            <div className="column-options">
              {Object.entries({
                route: "Ruta",
                service: kind === "clients" ? "Dirección" : "Concepto",
                due: "Vencimiento",
              })
                .filter(([key]) => key !== "due" || kind === "charges")
                .map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={columns[key as keyof typeof columns]}
                      onChange={() =>
                        setColumns((old) => ({
                          ...old,
                          [key]: !old[key as keyof typeof old],
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
            </div>
          </details>
          <button
            className="icon-button bordered"
            aria-label="Exportar tabla CSV"
            onClick={() =>
              exportCsv(`cyp-${kind}.csv`, [
                ["Cliente", "Código", "Concepto", "Saldo pendiente", "Estado"],
                ...filtered.map((r) => [
                  r.name,
                  r.code,
                  r.service,
                  r.amount / 100,
                  statusLabel(r.status),
                ]),
              ])
            }
          >
            <Download size={16} />
          </button>
        </div>
        {selected.length > 0 && (
          <div className="batch-bar">
            <span>
              <strong>{selected.length}</strong> seleccionados
            </span>
            <button
              className="text-button"
              onClick={() =>
                onBatch([
                  ...new Set(
                    rows
                      .filter((r) => selected.includes(r.id))
                      .map((r) => r.clientId),
                  ),
                ])
              }
            >
              <Plus size={15} />
              Generar cargo recurrente
            </button>
            <button
              className="icon-button small"
              aria-label="Quitar selección"
              onClick={() => setSelected([])}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {filtered.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar página"
                      checked={allSelected}
                      onChange={() =>
                        setSelected((old) =>
                          allSelected
                            ? old.filter(
                                (id) => !visible.some((r) => r.id === id),
                              )
                            : [
                                ...new Set([
                                  ...old,
                                  ...visible.map((r) => r.id),
                                ]),
                              ],
                        )
                      }
                    />
                  </th>
                  <th>
                    <button onClick={() => sortBy("name")}>
                      Cliente{sortIcon("name")}
                    </button>
                  </th>
                  {columns.route && <th>Ruta</th>}
                  {columns.service && (
                    <th>{kind === "clients" ? "Dirección" : "Concepto"}</th>
                  )}
                  {columns.due && kind === "charges" && <th>Vencimiento</th>}
                  <th>Estado</th>
                  <th className="align-right">
                    <button onClick={() => sortBy("amount")}>
                      Saldo pendiente{sortIcon("amount")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr
                    key={row.id}
                    className={selected.includes(row.id) ? "selected-row" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${row.name}`}
                        checked={selected.includes(row.id)}
                        onChange={() =>
                          setSelected((old) =>
                            old.includes(row.id)
                              ? old.filter((id) => id !== row.id)
                              : [...old, row.id],
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="person-link">
                        <Avatar name={row.name} index={index} />
                        <span>
                          <strong>{row.name}</strong>
                          <small>
                            {row.code}
                            {kind === "clients" ? ` · ${row.phone}` : ""}
                          </small>
                        </span>
                      </div>
                    </td>
                    {columns.route && (
                      <td>
                        {
                          snapshot.routes.find((r) => r.id === row.routeId)
                            ?.name
                        }
                      </td>
                    )}
                    {columns.service && (
                      <td className="concept-cell">
                        <span>{row.service}</span>
                        {row.required && (
                          <small className="required-label">
                            Obligado a cobrar
                          </small>
                        )}
                      </td>
                    )}
                    {columns.due && kind === "charges" && (
                      <td
                        className={
                          row.due < snapshot.businessDate && row.amount > 0
                            ? "overdue-text"
                            : ""
                        }
                      >
                        {dateLabel(row.due)}
                        {row.due < snapshot.businessDate && row.amount > 0 && (
                          <small className="cell-subtitle">Vencido</small>
                        )}
                      </td>
                    )}
                    <td>
                      <Badge status={row.status} />
                    </td>
                    <td className="align-right amount-cell">
                      {money(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            action={
              <button
                className="btn"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setRoute("all");
                }}
              >
                Limpiar filtros
              </button>
            }
          />
        )}
        <div className="table-pagination">
          <span>
            Mostrando {filtered.length ? (currentPage - 1) * 6 + 1 : 0}–
            {Math.min(currentPage * 6, filtered.length)} de {filtered.length}{" "}
            registros
          </span>
          <div>
            <button
              className="icon-button bordered small"
              aria-label="Página anterior"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Página {currentPage} de {pages}
            </span>
            <button
              className="icon-button bordered small"
              aria-label="Página siguiente"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
