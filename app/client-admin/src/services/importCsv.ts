// Importacion masiva estilo original (Subir archivo / Importar datos).
// CSV con separador ; o , autodetectado y cabecera opcional.
// Formato cargos: identificacion;servicio;importe;fecha;requerido
// Formato descargos: identificacion;concepto;importe;fecha;cobrador

export function parseImportCsv(
  text: string,
  entity: "charges" | "payouts",
): { filas: Record<string, unknown>[]; lineas: number } {
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { filas: [], lineas: 0 };
  const sep =
    (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const cells = (line: string) =>
    line.split(sep).map((cell) => cell.trim().replace(/^"|"$/g, ""));
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    header.includes("identificacion") || header.includes("identificación");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const filas: Record<string, unknown>[] = [];
  for (const line of dataLines) {
    const c = cells(line);
    if (!c.some((cell) => cell)) continue;
    const pick = (...names: string[]) => {
      if (!hasHeader) return "";
      for (const name of names) {
        const index = header.indexOf(name);
        if (index >= 0) return c[index] ?? "";
      }
      return "";
    };
    const pos = (i: number) => c[i] ?? "";
    const fila: Record<string, unknown> = {
      identificacion: pick("identificacion", "identificación") || pos(0),
      importe: Number(
        (pick("importe") || pos(2)).replace(/[^0-9.,-]/g, "").replace(",", "."),
      ),
    };
    if (entity === "charges") {
      fila.servicio = pick("servicio") || pos(1);
      const fecha = pick("fecha") || pos(3);
      if (fecha) fila.fecha = fecha;
      const requerido = (pick("requerido") || pos(4)).toLowerCase();
      if (requerido)
        fila.requerido = ["si", "sí", "true", "1", "x"].includes(requerido);
    } else {
      fila.concepto = pick("concepto") || pos(1);
      const fecha = pick("fecha") || pos(3);
      if (fecha) fila.fecha = fecha;
      const cobrador = pick("cobrador") || pos(4);
      if (cobrador) fila.cobrador = cobrador;
    }
    filas.push(fila);
  }
  return { filas, lineas: filas.length };
}
