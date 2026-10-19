import { useState, type FormEvent } from "react";
import { INPUT_LIMITS, validatePhone, validateText } from "../inputRules";
import { RemittanceDialog } from "./RemittanceDialog";
import type { Currency, NewRemittanceClient } from "./types";
import { advanceCaptureField } from "./formKeyboard";

export function QuickClientDialog({ side, currency, routes, initial, onClose, onUse }: {
  side: "sender" | "recipient"; currency: Currency; routes: readonly { id: string; name: string }[];
  initial?: NewRemittanceClient;
  onClose: () => void; onUse: (client: NewRemittanceClient) => void;
}) {
  const [draft, setDraft] = useState<NewRemittanceClient>(initial ?? { name: "", identification: "", phone: "", address: "", routeId: routes.length === 1 ? routes[0].id : "", preferredCurrency: currency });
  const [error, setError] = useState("");
  const update = (field: keyof NewRemittanceClient, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const use = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!draft.name.trim() || !draft.identification.trim()) throw new Error("Completa el nombre y la cédula o el pasaporte del cliente.");
      if (!routes.some(({ id }) => id === draft.routeId)) throw new Error("Selecciona una ruta autorizada para el cliente.");
      validateText(draft.name, "Nombre", INPUT_LIMITS.name); validateText(draft.identification, "Identificación", 80);
      validatePhone(draft.phone, "Teléfono"); validateText(draft.address, "Dirección", 240);
      onUse({ ...draft, name: draft.name.trim(), identification: draft.identification.trim(), phone: draft.phone.trim(), address: draft.address.trim() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa los datos del cliente."); }
  };
  return <RemittanceDialog title={side === "sender" ? "Nuevo remitente" : "Nuevo destinatario"} onClose={onClose}>
    <form onSubmit={use} onKeyDown={advanceCaptureField} className="remittance-panel">
      <p className="remittance-help">La ficha se guardará al confirmar el envío. Cancelar esta captura no registra ningún cliente.</p>
      <div className="remittance-form-grid">
        <label>Cliente:<input data-autofocus required maxLength={INPUT_LIMITS.name} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label>Cédula o pasaporte:<input required maxLength={80} value={draft.identification} onChange={(event) => update("identification", event.target.value)} /></label>
        <label>Teléfono:<input type="tel" inputMode="tel" maxLength={INPUT_LIMITS.phone} value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label>
        <label>Dirección:<input maxLength={240} value={draft.address} onChange={(event) => update("address", event.target.value)} /></label>
        <label>Ruta:<select aria-label="Ruta:" required value={draft.routeId} onChange={(event) => update("routeId", event.target.value)}><option value="">Seleccione…</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <label>Moneda habitual:<select aria-label="Moneda habitual:" value={draft.preferredCurrency} onChange={(event) => update("preferredCurrency", event.target.value)}>{["DOP", "USD", "EUR"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {error && <p className="remittance-error" role="alert">{error}</p>}
      <div className="remittance-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="remittance-primary">Usar estos datos</button></div>
    </form>
  </RemittanceDialog>;
}
