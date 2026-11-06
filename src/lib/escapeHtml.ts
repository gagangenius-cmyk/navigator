/**
 * Escapes a value for safe interpolation into an HTML string. Use this for any
 * user/DB-controlled text that is written into a document opened with
 * window.open('', '_blank') + document.write(): that window shares the app's
 * origin, so an unescaped name like <img onerror=...> would run with access to
 * the signed-in user's session.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}
