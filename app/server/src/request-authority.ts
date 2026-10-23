// Only access.ts may establish this request-local authority after checking the
// route's individual permissions. It is never serialized into a JWT or an account.
const officeRequests = new WeakSet<object>();
export const allowOfficeRequest = (actor: object) => { officeRequests.add(actor); };
export const clearOfficeRequest = (actor: object) => { officeRequests.delete(actor); };
export const isOfficeRequest = (actor: object) => officeRequests.has(actor);
