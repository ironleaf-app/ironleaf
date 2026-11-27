/** "host", "host:2222" or "user@host" → where to connect. */
export function addressOf(address: string): { host: string; port: number; user?: string } | null {
  const a = String(address || '').trim().replace(/^ssh:\/\//i, '').replace(/\/.*$/, '');
  const m = /^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s]+)(?::(\d{1,5}))?$/.exec(a);
  if (!m) return null;
  return { host: m[2].replace(/^\[|\]$/g, ''), port: m[3] ? Number(m[3]) : 22, ...(m[1] ? { user: m[1] } : {}) };
}
