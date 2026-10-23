type MinuteBucket = {
  minute: number;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  rateLimited: number;
  authFailures: number;
  totalDurationMs: number;
  durationSamples: number[];
};

const buckets = new Map<number, MinuteBucket>();
const MAX_BUCKETS = 180;
const MAX_SAMPLES_PER_BUCKET = 512;

const minuteKey = (at = Date.now()) => Math.floor(at / 60_000);

const trim = () => {
  if (buckets.size <= MAX_BUCKETS) return;
  const ordered = [...buckets.keys()].sort((a, b) => a - b);
  for (const key of ordered.slice(0, buckets.size - MAX_BUCKETS)) buckets.delete(key);
};

export const recordRequestMetric = (params: {
  status: number;
  durationMs: number;
  path: string;
  at?: number;
}) => {
  const key = minuteKey(params.at);
  const bucket = buckets.get(key) ?? {
    minute: key,
    requests: 0,
    errors4xx: 0,
    errors5xx: 0,
    rateLimited: 0,
    authFailures: 0,
    totalDurationMs: 0,
    durationSamples: [],
  };
  bucket.requests += 1;
  bucket.totalDurationMs += Math.max(0, params.durationMs);
  if (params.status >= 400 && params.status < 500) bucket.errors4xx += 1;
  if (params.status >= 500) bucket.errors5xx += 1;
  if (params.status === 429) bucket.rateLimited += 1;
  if (
    (params.status === 401 || params.status === 403) &&
    (/^\/users\/(?:login|refresh|session|send-auth|verfication-auth|reset-password)/.test(params.path) ||
      params.path.startsWith("/admin"))
  ) {
    bucket.authFailures += 1;
  }
  if (bucket.durationSamples.length < MAX_SAMPLES_PER_BUCKET) {
    bucket.durationSamples.push(Math.max(0, params.durationMs));
  }
  buckets.set(key, bucket);
  trim();
};

export const getOperationalSnapshot = (windowMinutes = 60, now = Date.now()) => {
  const safeWindow = Math.min(180, Math.max(1, Math.floor(windowMinutes) || 60));
  const cutoff = minuteKey(now) - safeWindow + 1;
  const selected = [...buckets.values()]
    .filter((bucket) => bucket.minute >= cutoff)
    .sort((a, b) => a.minute - b.minute);
  const totals = selected.reduce(
    (sum, bucket) => ({
      requests: sum.requests + bucket.requests,
      errors4xx: sum.errors4xx + bucket.errors4xx,
      errors5xx: sum.errors5xx + bucket.errors5xx,
      rateLimited: sum.rateLimited + bucket.rateLimited,
      authFailures: sum.authFailures + bucket.authFailures,
      totalDurationMs: sum.totalDurationMs + bucket.totalDurationMs,
    }),
    { requests: 0, errors4xx: 0, errors5xx: 0, rateLimited: 0, authFailures: 0, totalDurationMs: 0 },
  );
  const durations = selected.flatMap((bucket) => bucket.durationSamples).sort((a, b) => a - b);
  const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : -1;

  return {
    windowMinutes: safeWindow,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    coverage: "current_process_only" as const,
    requests: totals.requests,
    errors4xx: totals.errors4xx,
    errors5xx: totals.errors5xx,
    rateLimited: totals.rateLimited,
    authFailures: totals.authFailures,
    errorRate: totals.requests > 0
      ? Number((((totals.errors4xx + totals.errors5xx) / totals.requests) * 100).toFixed(2))
      : null,
    averageLatencyMs: totals.requests > 0
      ? Number((totals.totalDurationMs / totals.requests).toFixed(1))
      : null,
    p95LatencyMs: p95Index >= 0 ? durations[p95Index] : null,
    buckets: selected.map((bucket) => ({
      minute: new Date(bucket.minute * 60_000).toISOString(),
      requests: bucket.requests,
      errors4xx: bucket.errors4xx,
      errors5xx: bucket.errors5xx,
      rateLimited: bucket.rateLimited,
      authFailures: bucket.authFailures,
      averageLatencyMs: bucket.requests > 0
        ? Number((bucket.totalDurationMs / bucket.requests).toFixed(1))
        : null,
    })),
  };
};

export const resetOperationalMetricsForTests = () => buckets.clear();
