import { useState, type FormEvent } from "react";
import { INPUT_LIMITS, isPhoneDraft, isRemittanceDocumentDraft, isTextDraft, PHONE_INPUT_MESSAGE, REMITTANCE_DOCUMENT_MESSAGE, validatePhone, validateRemittanceClientName, validateRemittanceDocument, validateText } from "../inputRules";
import { RemittanceDialog } from "./RemittanceDialog";
import type { Currency, NewRemittanceClient } from "./types";
import { advanceCaptureField } from "./formKeyboard";
import { restrictPaste } from "./fieldInput";

export function QuickClientDialog({ side, currency, routes, initial, onClose, onUse }: {
  side: "sender" | "recipient"; currency: Currency; routes: readonly { id: string; name: string }[];
  initial?: NewRemittanceClient;
  onClose: () => void; onUse: (client: NewRemittanceClient) => void;
}) {
  const [draft, setDraft] = useState<NewRemittanceClient>(initial ?? { name: "", identification: "", phone: "", address: "", routeId: routes.length === 1 ? routes[0].id : "", preferredCurrency: currency });
  const [error, setError] = useState("");
  const fields = {
    name: { accepts: (value: string) => isTextDraft(value, INPUT_LIMITS.name), message: "El nombre admite hasta 160 caracteres, sin saltos de línea ni caracteres de control." },
    identification: { accepts: isRemittanceDocumentDraft, message: REMITTANCE_DOCUMENT_MESSAGE },
    phone: { accepts: isPhoneDraft, message: PHONE_INPUT_MESSAGE },
    address: { accepts: (value: string) => isTextDraft(value, INPUT_LIMITS.address), message: "La dirección admite hasta 240 caracteres, sin saltos de línea ni caracteres de control." },
  };
  const update = (field: keyof NewRemittanceClient, value: string) => {
    const rule = fields[field as keyof typeof fields];
    if (rule && !rule.accepts(value)) { setError(rule.message); return; }
    setDraft((current) => ({ ...current, [field]: value })); setError("");
  };
  const use = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!draft.name.trim() || !draft.identification.trim()) throw new Error("Completa el nombre y la cédula o el pasaporte del cliente.");
      if (!routes.some(({ id }) => id === draft.routeId)) throw new Error("Selecciona una ruta autorizada para el cliente.");
      validateRemittanceClientName(draft.name); validateRemittanceDocument(draft.identification);
      validatePhone(draft.phone, "Teléfono"); validateText(draft.address, "Dirección", 240);
      onUse({ ...draft, name: draft.name.trim(), identification: draft.identification.trim(), phone: draft.phone.trim(), address: draft.address.trim() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa los datos del cliente."); }
  };
  return <RemittanceDialog title={side === "sender" ? "Nuevo remitente" : "Nuevo destinatario"} onClose={onClose}>
    <form onSubmit={use} onKeyDown={advanceCaptureField} className="remittance-panel">
      <p className="remittance-help">La ficha se guardará al confirmar el envío. Cancelar esta captura no registra ningún cliente.</p>
      <div className="remittance-form-grid">
        <label>Cliente:<input autoFocus required maxLength={INPUT_LIMITS.name} value={draft.name} onPaste={(event) => restrictPaste(event, fields.name.accepts, () => setError(fields.name.message))} onChange={(event) => update("name", event.target.value)} /></label>
        <label>Cédula o pasaporte:<input required inputMode="text" spellCheck={false} maxLength={INPUT_LIMITS.id} value={draft.identification} title={REMITTANCE_DOCUMENT_MESSAGE} onPaste={(event) => restrictPaste(event, fields.identification.accepts, () => setError(fields.identification.message))} onChange={(event) => update("identification", event.target.value)} /></label>
        <label>Teléfono:<input type="tel" inputMode="tel" maxLength={INPUT_LIMITS.phone} value={draft.phone} title={PHONE_INPUT_MESSAGE} onPaste={(event) => restrictPaste(event, fields.phone.accepts, () => setError(fields.phone.message))} onChange={(event) => update("phone", event.target.value)} /></label>
        <label>Dirección:<input maxLength={INPUT_LIMITS.address} value={draft.address} onPaste={(event) => restrictPaste(event, fields.address.accepts, () => setError(fields.address.message))} onChange={(event) => update("address", event.target.value)} /></label>
        <label>Ruta:<select aria-label="Ruta:" required value={draft.routeId} onChange={(event) => update("routeId", event.target.value)}><option value="">Seleccione…</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <label>Moneda habitual:<select aria-label="Moneda habitual:" value={draft.preferredCurrency} onChange={(event) => update("preferredCurrency", event.target.value)}>{["DOP", "USD", "EUR"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {error && <p className="remittance-error" role="alert">{error}</p>}
      <div className="remittance-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="remittance-primary">Usar estos datos</button></div>
    </form>
  </RemittanceDialog>;
}
