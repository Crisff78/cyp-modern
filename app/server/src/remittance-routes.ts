import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertAdmin, DomainError, type State, type User } from "./domain.js";
import type { Store } from "./store.js";
import { remittanceClientContact, searchRemittanceClients } from "./remittance-client-search.js";
import {
  canSeeOutgoing, canSeeReceipt, cancelRemittance, closeRemittanceCash, createRemittance,
  currencies, openRemittanceCash, payRemittance, quoteRemittance, remittanceReports,
  remittanceSnapshot, setDailyRate, transferView,
} from "./remittances.js";
import { boundedId, freeText, singleLine } from "./input-validation.js";

type Mutate = <T, P = Record<string, string>>(
  path: string, summary: string, schema: z.ZodType<T>,
  fn: (state: State, user: User, body: T, params: P) => unknown,
) => void;
type Describe = (method: string, path: string, summary: string, schema?: z.ZodType, isPublic?: boolean) => void;
const id = boundedId;
const currency = z.enum(currencies);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bps = z.number().int().min(0).max(10000);
const quoteFields = {
  sourceCurrency: currency, destinationCurrency: currency,
  amount: amount.positive(), commissionBps: bps,
};
export function registerRemittanceRoutes(
  app: FastifyInstance, store: Store, user: (req: FastifyRequest) => User,
  mutate: Mutate, describe: Describe, systemOperators: User[],
) {
  const get = (path: string, summary: string, handler: (req: FastifyRequest) => unknown) => {
    app.get(path, handler); describe("get", path, summary);
  };
  get("/api/envios/snapshot", "Estado de envíos, tasas y cajas por moneda", async (req) =>
    remittanceSnapshot(await store.read(), user(req), systemOperators));
  get("/api/envios/clientes/buscar", "Buscar clientes de remesas por código, nombre o teléfono sin devolver notas", async (req) => {
    const input = z.object({ query: singleLine(160, 1), side: z.enum(["sender", "recipient"]), senderId: id.optional() }).strict().parse(req.query);
    return searchRemittanceClients(await store.read(), user(req), input.query, input.side, input.senderId);
  });
  get("/api/envios/clientes/:id/contacto", "Consultar el contacto del cliente seleccionado para una remesa", async (req) => {
    const params = z.object({ id }).strict().parse(req.params);
    const input = z.object({ side: z.enum(["sender", "recipient"]), senderId: id.optional() }).strict().parse(req.query);
    return remittanceClientContact(await store.read(), user(req), params.id, input.side, input.senderId);
  });
  for (const [path, filter] of [["/api/envios", canSeeOutgoing], ["/api/envios/recibos", canSeeReceipt]] as const)
    get(path, "Consultar envíos o recibos autorizados", async (req) => {
      const state = await store.read(), actor = user(req);
      return state.remittances.transfers.filter((t) => filter(state, actor, t)).map((t) => transferView(state, actor, t));
    });
  get("/api/envios/cotizacion", "Cotizar envío con la tasa del día", async (req) => {
    const input = z.object({ ...quoteFields,
      amount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      commissionBps: z.coerce.number().int().min(0).max(10000),
    }).strict().parse(req.query);
    return quoteRemittance(await store.read(), input);
  });
  mutate("/api/envios/tasas", "Registrar tasa diaria DOP por unidad", z.object({
    currency, rate: z.string().max(19), date: z.iso.date(),
  }).strict(), (state, actor, input) => setDailyRate(state, actor, input));
  mutate("/api/envios", "Registrar envío y recibir principal más comisión", z.object({
    ...quoteFields, senderClientId: id, recipientClientId: id, sendingUserId: id.optional(),
    quote: z.object({ date: z.iso.date(), sourceRate: z.string().max(19), destinationRate: z.string().max(19),
      quotedAt: z.iso.datetime().optional(), sourceRateChangeId: id.optional(), destinationRateChangeId: id.optional(),
      sourceRateChangedAt: z.iso.datetime().optional(), destinationRateChangedAt: z.iso.datetime().optional(),
    }).strict(),
    managerCommission: z.object({
      managerName: singleLine(160, 1)
        .refine((value) => value.length <= 160, "El nombre del gestor excede 160 caracteres."),
      amount, currency,
    }).strict().optional(),
    note: freeText(2000).default(""),
  }).strict(), (state, actor, input) => createRemittance(state, actor, input, systemOperators));
  mutate("/api/envios/:id/pagar", "Pagar recibo completo", z.object({}).strict(),
    (state, actor, _input, params) => payRemittance(state, actor, params.id));
  mutate("/api/envios/:id/cancelar", "Cancelar envío pendiente y devolver principal más comisión",
    z.object({ reason: freeText(500, 1) }).strict(),
    (state, actor, input, params) => cancelRemittance(state, actor, params.id, input.reason));
  mutate("/api/envios/cajas/abrir", "Abrir caja de envíos por operador y moneda", z.object({
    operatorId: id, currency, openingAmount: amount,
  }).strict(), (state, actor, input) => openRemittanceCash(state, actor, input, systemOperators));
  mutate("/api/envios/cajas/:id/cerrar", "Cerrar caja con contado exacto",
    z.object({ countedAmount: amount }).strict(),
    (state, actor, input, params) => closeRemittanceCash(state, actor, params.id, input.countedAmount));
  get("/api/envios/reportes", "Reportes de envíos por rango o día, sin mezclar monedas", async (req) => {
    const input = z.object({ from: z.iso.date(), to: z.iso.date(), grouping: z.enum(["range", "day"]).default("range") }).strict().parse(req.query);
    return remittanceReports(await store.read(), user(req), input);
  });
  mutate("/api/clientes/:id/actividad", "Activar o inactivar cliente conservando su historial",
    z.object({ active: z.boolean() }).strict(), (state, actor, input, params) => {
      assertAdmin(actor);
      const client = state.clients.find((c) => c.id === params.id);
      if (!client) throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
      client.active = input.active; return client;
    });
}
