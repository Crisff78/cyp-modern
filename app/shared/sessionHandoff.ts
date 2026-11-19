// One sign-in page for every account. When the account belongs to the other portal, the session
// goes there in this tab's sessionStorage, which that portal reads at start; it never travels in the
// URL and ends when the tab is closed (shared/sessionLifetime.ts). Only the same origin shares that
// storage (Render: "/" and "/collector/"); between the two development servers the other portal asks
// for the password again.
export const ADMIN_TOKEN_KEY = "cyp-admin-token";
export const COLLECTOR_TOKEN_KEY = "cyp-collector-token";

export function openCollectorPortal(token: string, url: string) {
  sessionStorage.setItem(COLLECTOR_TOKEN_KEY, token);
  window.location.assign(url);
}

export function openAdminPortal(token: string, url: string) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  window.location.assign(url);
}
