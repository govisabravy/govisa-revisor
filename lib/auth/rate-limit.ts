import { NextRequest } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const b = store.get(key);
  if (!b || b.resetAt < now) {
    const resetAt = now + opts.windowMs;
    store.set(key, { count: 1, resetAt });
    return { ok: true, remaining: opts.limit - 1, resetAt, retryAfterSeconds: 0 };
  }
  b.count += 1;
  if (b.count > opts.limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: b.resetAt,
      retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000)
    };
  }
  return {
    ok: true,
    remaining: opts.limit - b.count,
    resetAt: b.resetAt,
    retryAfterSeconds: 0
  };
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}

export function getClientIp(req: NextRequest | Request): string {
  const h = (name: string) =>
    (req.headers as any).get ? (req.headers as any).get(name) : (req.headers as any)[name];
  const xff = h("x-forwarded-for");
  if (xff) return String(xff).split(",")[0].trim();
  const real = h("x-real-ip");
  if (real) return String(real).trim();
  return "unknown";
}

// housekeeping pra não vazar memória indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of store.entries()) {
    if (b.resetAt < now) store.delete(k);
  }
}, 60_000).unref?.();
