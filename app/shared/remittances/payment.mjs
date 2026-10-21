export const paymentMethods = ["cash", "card", "transfer", "deposit"];
export const paymentMethodLabels = {
    cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", deposit: "Depósito",
};
export class PaymentValidationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const invalid = (message) => { throw new PaymentValidationError("INVALID_PAYMENT", message); };
const text = (value, label) => {
    if (value === undefined)
        return "";
    if (typeof value !== "string" || value.length > 160 || /[\p{Cc}\p{Cf}]/u.test(value))
        return invalid(`${label} admite hasta 160 caracteres en una sola línea.`);
    return value.trim();
};
/** Exact cents; the server supplies the authoritative total again when saving. */
export function paymentAmounts(total, input) {
    if (!Number.isSafeInteger(total) || total <= 0)
        return invalid("El total del envío no es válido.");
    if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["method", "tenderedAmount", "reference", "bank", "verified"].includes(key))))
        return invalid("Revisa los datos de la forma de pago.");
    const method = input === undefined ? "cash" : input.method;
    if (!paymentMethods.includes(method))
        return invalid("Selecciona una forma de pago válida.");
    const reference = text(input?.reference, "La referencia del pago"), bank = text(input?.bank, "El banco o proveedor");
    if (method === "cash") {
        if (reference || bank || input?.verified !== undefined)
            return invalid("El efectivo solo requiere el dinero recibido.");
        const tenderedAmount = input?.tenderedAmount ?? total;
        if (!Number.isSafeInteger(tenderedAmount) || tenderedAmount < 0)
            return invalid("El dinero recibido debe ser un importe válido en centavos.");
        if (tenderedAmount < total)
            throw new PaymentValidationError("INSUFFICIENT_TENDERED", "El dinero recibido no cubre el total a pagar.");
        return { method, tenderedAmount, changeAmount: Number(BigInt(tenderedAmount) - BigInt(total)) };
    }
    if (input?.tenderedAmount !== undefined)
        return invalid("Los pagos por banco o tarjeta no generan cambio en efectivo.");
    if (!reference)
        return invalid("Escribe la referencia del comprobante de pago.");
    if (input?.verified !== true)
        throw new PaymentValidationError("PAYMENT_NOT_VERIFIED", "Confirma que comprobaste el pago antes de registrar el envío.");
    return { method, tenderedAmount: total, changeAmount: 0, reference, ...(bank ? { bank } : {}) };
}
/** Card/bank receipts do not add physical bills to the remittance cash box. */
export const cashReceivedForTransfer = (total, payment) => !payment || payment.method === "cash" ? total : 0;
