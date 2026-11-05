export const paymentMethods = ["cash", "card", "transfer", "deposit"];
export const paymentMethodLabels = {
    cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", deposit: "Depósito",
};
export const cardTypes = ["credit", "debit"];
export const cardTypeLabels = { credit: "Crédito", debit: "Débito" };
export const isCardLast4Draft = (value) => typeof value === "string" && /^[0-9]{0,4}$/.test(value);
export const isCardholderNameDraft = (value) => isPaymentTextDraft(value) && value.length <= 120 && /^[\p{L}\p{M} '\u2019.-]*$/u.test(value);
export const paymentLabel = (payment) => payment.method === "card" && cardTypes.includes(payment.cardType)
    ? `Tarjeta de ${cardTypeLabels[payment.cardType].toLocaleLowerCase("es")}` : paymentMethodLabels[payment.method];
export class PaymentValidationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const invalid = (message) => { throw new PaymentValidationError("INVALID_PAYMENT", message); };
// References and bank names are text, not numbers; keep their punctuation and leading zeroes.
export const isPaymentTextDraft = (value) => typeof value === "string" && value.length <= 160 && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value);
const text = (value, label) => {
    if (value === undefined)
        return "";
    if (!isPaymentTextDraft(value))
        return invalid(`${label} admite hasta 160 caracteres en una sola línea.`);
    return value.trim();
};
/** Exact cents; the server supplies the authoritative total again when saving. */
export function cardPaymentCharge(total, cardType, creditCardCommissionBps = 0) {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(creditCardCommissionBps) || creditCardCommissionBps < 0 || creditCardCommissionBps > 10000)
        return invalid("No se pudo comprobar el recargo de tarjeta. Vuelve a cotizar.");
    const rate = cardType === "credit" ? creditCardCommissionBps : 0;
    const surchargeAmount = (BigInt(total) * BigInt(rate) + 5000n) / 10000n;
    const charged = BigInt(total) + surchargeAmount;
    if (charged > BigInt(Number.MAX_SAFE_INTEGER)) return invalid("El total con recargo excede el importe permitido.");
    return { cardSurchargeBps: rate, cardSurchargeAmount: Number(surchargeAmount), totalAmount: Number(charged) };
}
/** The transfer subtotal stays intact; a frozen credit-card surcharge belongs to the recorded payment. */
export const totalPaidForTransfer = (transfer) => {
    const total = BigInt(transfer.totalAmount) + BigInt(transfer.payment?.cardSurchargeAmount ?? 0);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return invalid("El total pagado excede el importe permitido.");
    return Number(total);
};
export function paymentAmounts(total, input, creditCardCommissionBps = 0) {
    if (!Number.isSafeInteger(total) || total <= 0)
        return invalid("El total del envío no es válido.");
    if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["method", "tenderedAmount", "reference", "bank", "verified", "cardType", "cardholderName", "last4"].includes(key))))
        return invalid("Revisa los datos de la forma de pago.");
    const method = input === undefined ? "cash" : input.method;
    if (!paymentMethods.includes(method))
        return invalid("Selecciona una forma de pago válida.");
    const reference = text(input?.reference, "La referencia del pago"), bank = text(input?.bank, "El banco o proveedor");
    if (method !== "card" && [input?.cardType, input?.cardholderName, input?.last4].some((value) => value !== undefined))
        return invalid("Los datos de tarjeta solo corresponden al pago con tarjeta.");
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
    if (method === "card") {
        if (input.cardType !== undefined && !cardTypes.includes(input.cardType)) return invalid("Selecciona crédito o débito.");
        if (input.cardType === undefined && (creditCardCommissionBps > 0 || input.cardholderName !== undefined || input.last4 !== undefined))
            return invalid("Selecciona crédito o débito para comprobar el recargo.");
        if (input.cardType === "debit" && (input.cardholderName !== undefined || input.last4 !== undefined))
            return invalid("El débito solo requiere el comprobante de pago.");
        if (input.cardType === "credit" && (!isCardholderNameDraft(input.cardholderName) || !/\p{L}/u.test(input.cardholderName) || (typeof input.last4 !== "string" || !/^[0-9]{4}$/.test(input.last4))))
            return invalid("Escribe el titular y solo los últimos 4 dígitos de la tarjeta.");
        if (input.cardType !== undefined) {
            const charge = cardPaymentCharge(total, input.cardType, creditCardCommissionBps);
            return { method, tenderedAmount: charge.totalAmount, changeAmount: 0, reference, ...(bank ? { bank } : {}),
                cardType: input.cardType, cardSurchargeBps: charge.cardSurchargeBps, cardSurchargeAmount: charge.cardSurchargeAmount,
                ...(input.cardType === "credit" ? { cardholderName: input.cardholderName.trim(), last4: input.last4 } : {}) };
        }
    }
    return { method, tenderedAmount: total, changeAmount: 0, reference, ...(bank ? { bank } : {}) };
}
/** Card/bank receipts do not add physical bills to the remittance cash box. */
export const cashReceivedForTransfer = (total, payment) => !payment || payment.method === "cash" ? total : 0;
