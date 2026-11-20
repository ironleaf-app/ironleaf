// In the former host app's window (one product step 2, 8 Nov 2026). Vault's page lives in the former host
// app's window as a view behind NS_VAULT_IN_WINDOW; the view loads the same renderer file with ?inWindow=1,
// the second window without it. In the view Vault hides its own Places side bar and the former host app |
// Vault | Bot switch and shows only tabs and pages; the window keeps its bar exactly as today.
export function inVaultView(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('inWindow') === '1';
  } catch {
    return false;
  }
}
