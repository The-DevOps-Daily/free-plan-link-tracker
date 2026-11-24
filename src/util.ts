export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLACEMENT = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function cleanPlacement(value: string | null): string {
  if (value === null || value === "") return "direct";
  const v = value.toLowerCase();
  return PLACEMENT.test(v) ? v : "invalid";
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 1), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}
