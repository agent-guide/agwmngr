import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.error === "object" && obj.error !== null) {
    const err = obj.error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
  }
  // Agent runtime endpoints answer with the normalized runtime error contract
  // ({error_type, message}), which has no `error` wrapper at all.
  if (typeof obj.message === "string" && obj.message) return obj.message;
  if (typeof obj.error_type === "string" && obj.error_type) return obj.error_type;
  return fallback;
}

/**
 * The stable `error_type` from an Agent runtime failure, if the body carries
 * one. Callers use it to branch on capability_not_supported /
 * runtime_not_executable rather than pattern-matching prose.
 */
export function extractRuntimeErrorType(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const errorType = (data as Record<string, unknown>).error_type;
  return typeof errorType === "string" && errorType ? errorType : undefined;
}
