export interface UsageBoundResult extends Record<string, unknown> {
  usageProxy: unknown | null;
  estimatedApiEquivalentUsd?: number;
  codexChatgptCredits: null;
  codexChatgptCreditsReason: "public_conversion_unavailable";
}
/**
 * Codex/ChatGPT plan credits do not have a public per-token conversion. Keep
 * that boundary machine-readable instead of relabeling API-equivalent costs as
 * official credits.
 */
export function withUsageBoundary(value: unknown): UsageBoundResult {
  const source = value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : { result: value };
  const sanitized = { ...source };
  // Older prototypes used this ambiguous field. Never let it escape as an
  // official Codex/ChatGPT credit estimate.
  delete sanitized.estimatedCredits;
  const bounded: UsageBoundResult = {
    ...sanitized,
    usageProxy: inferUsageProxy(source),
    codexChatgptCredits: null,
    codexChatgptCreditsReason: "public_conversion_unavailable",
  };
  if (
    typeof source.estimatedApiEquivalentUsd === "number" &&
    Number.isFinite(source.estimatedApiEquivalentUsd)
  ) {
    bounded.estimatedApiEquivalentUsd = source.estimatedApiEquivalentUsd;
  }
  return bounded;
}

function inferUsageProxy(source: Record<string, unknown>): unknown | null {
  if (Object.hasOwn(source, "usageProxy")) return source.usageProxy;
  if (!Array.isArray(source.aggregates)) return null;
  const byPolicy: Record<string, number> = {};
  for (const aggregate of source.aggregates) {
    if (
      aggregate !== null &&
      typeof aggregate === "object" &&
      typeof (aggregate as { policy?: unknown }).policy === "string" &&
      typeof (aggregate as { totalUsageProxy?: unknown }).totalUsageProxy === "number"
    ) {
      byPolicy[(aggregate as { policy: string }).policy] =
        (aggregate as { totalUsageProxy: number }).totalUsageProxy;
    }
  }
  return Object.keys(byPolicy).length > 0 ? byPolicy : null;
}
