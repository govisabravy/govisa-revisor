export interface ModelPricing {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

const PRICING_PER_M_TOKENS: Record<string, ModelPricing> = {
  "claude-opus-4-7": { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 }
};

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function estimateCostUSD(model: string, usage: UsageTotals): number {
  const base = model.replace(/-\d{8}$/, "").replace(/\[.*\]/, "").trim();
  const p = PRICING_PER_M_TOKENS[base] ?? PRICING_PER_M_TOKENS["claude-sonnet-4-6"];
  const M = 1_000_000;
  return (
    (usage.input_tokens / M) * p.input +
    (usage.output_tokens / M) * p.output +
    (usage.cache_creation_input_tokens / M) * p.cache_write +
    (usage.cache_read_input_tokens / M) * p.cache_read
  );
}
