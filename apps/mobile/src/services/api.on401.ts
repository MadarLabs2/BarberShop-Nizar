/**
 * Callback for 401 (unauthorized) responses. Registered at app init.
 * Used by apiFetch to clear local auth when the api_token is invalid or revoked.
 */
let handler: (() => void) | null = null;

export function setOn401(fn: () => void): void {
  handler = fn;
}

export function callOn401(): void {
  handler?.();
}
