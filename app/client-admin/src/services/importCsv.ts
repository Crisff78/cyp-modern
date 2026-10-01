// CSV con separador ; o , autodetectado y cabecera opcional.
// Cargos: identificacion;servicio;importe;fecha;requerido
// Descargos: identificacion;concepto;importe;fecha;cobrador
// filas[].importe devuelve CENTAVOS enteros exactos, sin multiplicar ni redondear.
type Cell = { value: string; line: number; column: number };
type CsvRecord = { cells: Cell[]; line: number };

function invalid(line: number, column: number, message: string): never {
  throw new Error("CSV inválido. Línea " + line + ", columna " + column + ": " + message);
}
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function detectSeparator(text: string): ";" | "," {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === ";" || char === ",")) return char;
  }
  return ";";
}
function readRecords(text: string, separator: ";" | ","): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: Cell[] = [], buffer = "", mode: "plain" | "quoted" | "closed" = "plain";
  let line = 1, column = 1, recordLine = 1, cellLine = 1, cellColumn = 1, touched = false;
  const finishCell = () => {
    cells.push({ value: buffer.trim(), line: cellLine, column: cellColumn });
    buffer = ""; mode = "plain";
  };
  const finishRecord = () => {
    finishCell();
    if (touched) records.push({ cells, line: recordLine });
    cells = []; touched = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], newline = char === "\r" || char === "\n";
    if (mode === "quoted") {
      if (char === '"') {
        if (text[index + 1] === '"') { buffer += '"'; index += 1; column += 1; }
        else mode = "closed";
      } else if (newline) {
        buffer += "\n";
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        line += 1; column = 0;
      } else buffer += char;
    } else if (newline) {
      finishRecord();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      line += 1; column = 0; recordLine = line; cellLine = line; cellColumn = 1;
    } else if (char === separator) {
      touched = true; finishCell(); cellLine = line; cellColumn = column + 1;
    } else if (mode === "closed") {
      if (char !== " " && char !== "\t")
        invalid(line, column, "Después de cerrar las comillas se esperaba un separador o un salto de línea.");
    } else if (char === '"') {
      if (buffer.trim()) invalid(line, column, "Las comillas deben encerrar el campo completo.");
      buffer = ""; mode = "quoted"; touched = true;
    } else {
      buffer += char; if (char.trim()) touched = true;
    }
    column += 1;
  }
  if (mode === "quoted") invalid(cellLine, cellColumn, "El campo tiene comillas sin cerrar.");
  finishRecord();
  return records;
}
function exactCents(cell: Cell): number {
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(cell.value);
  if (!match)
    invalid(cell.line, cell.column, "El importe debe ser un decimal sin símbolos ni letras y con un máximo de dos decimales.");
  let cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  if (match[1] === "-") cents = -cents;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (cents > maximum || cents < -maximum)
    invalid(cell.line, cell.column, "El importe en centavos está fuera del rango de enteros seguros.");
  // Cero, negativos y límites de negocio se reportan por fila en el dominio.
  return Number(cents);
}
function requiredText(cell: Cell, name: string, maximum: number): string {
  if (!cell.value) invalid(cell.line, cell.column, "Falta el valor obligatorio «" + name + "».");
  if (cell.value.length > maximum)
    invalid(cell.line, cell.column, "«" + name + "» admite un máximo de " + maximum + " caracteres.");
  return cell.value;
}
function validDate(cell: Cell): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.value);
  if (!match) invalid(cell.line, cell.column, "La fecha debe tener el formato AAAA-MM-DD.");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1])
    invalid(cell.line, cell.column, "La fecha no es un día válido del calendario.");
  return cell.value;
}
function requiredFlag(cell: Cell): boolean {
  const value = normalize(cell.value);
  if (["si", "true", "1", "x"].includes(value)) return true;
  if (["no", "false", "0"].includes(value)) return false;
  invalid(cell.line, cell.column, "«requerido» debe ser sí/no, true/false, 1/0 o x.");
}
export function parseImportCsv(
  text: string,
  entity: "charges" | "payouts",
): { filas: Record<string, unknown>[]; lineas: number } {
  const input = text.replace(/^\uFEFF/, "");
  const records = readRecords(input, detectSeparator(input));
  if (!records.length) return { filas: [], lineas: 0 };
  const description = entity === "charges" ? "servicio" : "concepto";
  const allowed = ["identificacion", description, "importe", "fecha", entity === "charges" ? "requerido" : "cobrador"];
  const first = records[0], names = first.cells.map(cell => normalize(cell.value));
  const hasHeader = names.includes("identificacion") || names.filter(name => allowed.includes(name)).length >= 2;
  let indexes: Map<string, number> | undefined;
  if (hasHeader) {
    const columns = new Map<string, number>();
    first.cells.forEach((cell, index) => {
      const name = names[index];
      if (!allowed.includes(name))
        invalid(cell.line, cell.column, "Columna de cabecera desconocida: «" + cell.value + "».");
      if (columns.has(name))
        invalid(cell.line, cell.column, "La columna «" + cell.value + "» está repetida.");
      columns.set(name, index);
    });
    for (const name of ["identificacion", description, "importe"]) {
      if (!columns.has(name))
        invalid(first.line, 1, "Falta la columna obligatoria «" + name + "» en la cabecera.");
    }
    indexes = columns;
  }
  const filas: Record<string, unknown>[] = [];
  for (const record of hasHeader ? records.slice(1) : records) {
    if (indexes && record.cells.length !== first.cells.length)
      invalid(record.line, 1, "Se esperaban " + first.cells.length + " columnas según la cabecera; se encontraron " + record.cells.length + ".");
    if (!indexes && (record.cells.length < 3 || record.cells.length > 5))
      invalid(record.line, 1, "Una fila sin cabecera debe tener entre 3 y 5 columnas; se encontraron " + record.cells.length + ".");
    const cell = (name: string, position: number): Cell | undefined => {
      const index = indexes ? indexes.get(name) : position;
      return index === undefined ? undefined : record.cells[index];
    };
    const fila: Record<string, unknown> = {
      identificacion: requiredText(cell("identificacion", 0)!, "identificacion", 80),
      [description]: requiredText(cell(description, 1)!, description, 160),
      importe: exactCents(cell("importe", 2)!),
    };
    const date = cell("fecha", 3);
    if (date?.value) fila.fecha = validDate(date);
    const extra = cell(entity === "charges" ? "requerido" : "cobrador", 4);
    if (extra?.value) {
      if (entity === "charges") fila.requerido = requiredFlag(extra);
      else fila.cobrador = requiredText(extra, "cobrador", 80);
    }
    filas.push(fila);
  }
  return { filas, lineas: filas.length };
}
