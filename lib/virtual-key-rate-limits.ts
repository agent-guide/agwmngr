import type { VirtualKeyRateLimits } from "@/lib/api";

export const RATE_LIMIT_PROTOCOLS = ["llm", "mcp", "agent"] as const;

export type RateLimitProtocol = (typeof RATE_LIMIT_PROTOCOLS)[number];

export interface RateLimitFormEntry {
  enabled: boolean;
  requestsPerMinute: string;
  burst: string;
}

export type RateLimitsFormValue = Record<RateLimitProtocol, RateLimitFormEntry>;

const DEFAULT_REQUESTS_PER_MINUTE = "60";
const DEFAULT_BURST = "10";

function emptyEntry(): RateLimitFormEntry {
  return {
    enabled: false,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    burst: DEFAULT_BURST,
  };
}

export function emptyRateLimitsForm(): RateLimitsFormValue {
  return {
    llm: emptyEntry(),
    mcp: emptyEntry(),
    agent: emptyEntry(),
  };
}

export function rateLimitsToForm(rateLimits?: VirtualKeyRateLimits): RateLimitsFormValue {
  const form = emptyRateLimitsForm();
  for (const protocol of RATE_LIMIT_PROTOCOLS) {
    const limit = rateLimits?.[protocol];
    if (!limit) continue;
    form[protocol] = {
      enabled: true,
      requestsPerMinute: String(limit.requests_per_minute),
      burst: String(limit.burst),
    };
  }
  return form;
}

export interface RateLimitsFormResult {
  rateLimits?: VirtualKeyRateLimits;
  errors: Partial<Record<RateLimitProtocol, string>>;
}

export function rateLimitsFromForm(form: RateLimitsFormValue): RateLimitsFormResult {
  const rateLimits: VirtualKeyRateLimits = {};
  const errors: RateLimitsFormResult["errors"] = {};

  for (const protocol of RATE_LIMIT_PROTOCOLS) {
    const entry = form[protocol];
    if (!entry.enabled) continue;

    const requestsPerMinute = positiveInteger(entry.requestsPerMinute);
    const burst = positiveInteger(entry.burst);
    if (requestsPerMinute === null || burst === null) {
      errors[protocol] = "RPM and burst must both be positive integers.";
      continue;
    }
    rateLimits[protocol] = {
      requests_per_minute: requestsPerMinute,
      burst,
    };
  }

  return {
    rateLimits: Object.keys(rateLimits).length > 0 ? rateLimits : undefined,
    errors,
  };
}

function positiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
