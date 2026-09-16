import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  LoaderCircle,
  MessageCircle,
  Printer,
  ReceiptText,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { api, dateLabel, money } from "./api";
import type { Receipt } from "./types";

export function ReceiptView({
  token,
  onBack,
}: {
  token: string;
  onBack?: () => void;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [width, setWidth] = useState<"58" | "80">("80");
  const [downloading, setDownloading] = useState(false);
  const url = `${window.location.origin}/?receipt=${encodeURIComponent(token)}`;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReceipt(await api<Receipt>(`/recibos/${encodeURIComponent(token)}`));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se puede abrir este recibo.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado");
    } catch {
      toast.error(
        "No se pudo copiar. Puedes seleccionar el enlace que aparece debajo.",
      );
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Recibo CyP",
          text: "Tu comprobante de cobros y pagos",
          url,
        });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          toast.error("No se pudo compartir el recibo.");
      }
    } else await copyLink();
  }
  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(
        `/api/recibos/${encodeURIComponent(token)}/escpos?width=${width}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("No se pudo preparar el archivo de impresión.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `CyP-recibo-${receipt?.id ?? "comprobante"}-${width}mm.bin`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      toast.success("Archivo ESC/POS descargado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de descarga.");
    } finally {
      setDownloading(false);
    }
  }
  return (
    <main className="receipt-page">
      <div className="receipt-toolbar no-print">
        <button
          className="text-button"
          onClick={
            onBack ??
            (() => {
              window.location.href = "/";
            })
          }
        >
          <ArrowLeft size={19} />
          {onBack ? "Volver a mi ruta" : "Ir al portal"}
        </button>
        <span className="brand-word">
          cyp<span>.</span>
        </span>
      </div>
      {loading ? (
        <div
          className="receipt-paper skeleton"
          style={{ height: 470 }}
          aria-label="Cargando recibo"
        />
      ) : error ? (
        <div className="empty-state">
          <ReceiptText />
          <h1>Recibo no disponible</h1>
          <p>{error}</p>
          <button className="primary" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      ) : (
        receipt && (
          <>
            <div className="receipt-success no-print">
              <span>
                <Check size={28} />
              </span>
              <h1>Todo listo.</h1>
              <p>
                {receipt.type === "payout"
                  ? "El pago quedó registrado."
                  : "El cobro quedó registrado."}
              </p>
            </div>
            <article
              className={`receipt-paper thermal-${width}`}
              aria-label="Comprobante de operación"
            >
              <header>
                <span className="brand-word">
                  cyp<span>.</span>
                </span>
                <p>COBROS Y PAGOS</p>
              </header>
              <span className="receipt-status">
                <Check size={13} /> Operación registrada
              </span>
              <p className="receipt-amount-label">
                {receipt.type === "payout"
                  ? "Importe pagado"
                  : "Importe recibido"}
              </p>
              <strong className="receipt-amount">
                {money(receipt.amount)}
              </strong>
              <dl>
                <div>
                  <dt>Cliente</dt>
                  <dd>{receipt.clientName}</dd>
                </div>
                <div>
                  <dt>Concepto</dt>
                  <dd>{receipt.concept}</dd>
                </div>
                <div>
                  <dt>Cobrador</dt>
                  <dd>{receipt.collectorName}</dd>
                </div>
                <div>
                  <dt>Fecha</dt>
                  <dd>{dateLabel(receipt.createdAt)}</dd>
                </div>
                <div>
                  <dt>Referencia</dt>
                  <dd className="receipt-id">{receipt.id}</dd>
                </div>
              </dl>
              <footer>
                <span className="receipt-dots" aria-hidden="true" />
                <p>Gracias por tu confianza.</p>
                <small>Comprobante operativo · No fiscal</small>
              </footer>
            </article>
            <section
              className="receipt-actions no-print"
              aria-label="Compartir e imprimir"
            >
              <button className="primary" onClick={() => void share()}>
                <Share2 size={20} />
                Compartir recibo
              </button>
              <div className="two-buttons">
                <button className="secondary" onClick={() => void copyLink()}>
                  <Copy size={18} />
                  Copiar enlace
                </button>
                <a
                  className="secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(`Tu recibo de CyP: ${url}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={18} />
                  WhatsApp
                </a>
              </div>
              <label className="print-selector">
                Ancho de papel
                <select
                  value={width}
                  onChange={(event) =>
                    setWidth(event.target.value as "58" | "80")
                  }
                >
                  <option value="58">58 mm</option>
                  <option value="80">80 mm</option>
                </select>
              </label>
              <div className="two-buttons">
                <button className="secondary" onClick={() => window.print()}>
                  <Printer size={18} />
                  Imprimir
                </button>
                <button
                  className="secondary"
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  {downloading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Download size={18} />
                  )}
                  ESC/POS
                </button>
              </div>
              <p className="receipt-help">
                Imprimir abre el diálogo del navegador. El archivo ESC/POS
                requiere una impresora compatible y un puente de impresión
                instalado; el navegador no envía comandos directamente.
              </p>
              <label className="receipt-link">
                Enlace privado del comprobante
                <input
                  readOnly
                  value={url}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            </section>
          </>
        )
      )}
    </main>
  );
}
