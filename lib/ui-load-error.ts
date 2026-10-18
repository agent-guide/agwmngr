import { ApiError } from "./api";

export interface LoadFailure {
  kind: "forbidden" | "failed";
  message: string;
}

/** Keep authorization denials distinct from transport/store failures in collection UIs. */
export function loadFailureFrom(error: unknown, fallback: string): LoadFailure {
  return {
    kind: error instanceof ApiError && error.status === 403 ? "forbidden" : "failed",
    message: error instanceof Error ? error.message : fallback,
  };
}
