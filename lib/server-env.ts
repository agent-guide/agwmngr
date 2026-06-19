import { readFileSync } from "fs";
import { join } from "path";

// Parse a .env file respecting single-quoted values (no $VAR expansion).
// Double-quoted values have their surrounding quotes stripped but are NOT expanded either.
// This works around @next/env which expands $VAR references even inside single-quoted values,
// corrupting values like bcrypt hashes that contain literal $ characters.
function parseEnvFile(filepath: string): Record<string, string> {
  try {
    const content = readFileSync(filepath, "utf8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

// Load once at module init. In production .env.local typically doesn't exist;
// actual env vars are injected by the platform and are never subject to $-expansion.
const rawEnv = parseEnvFile(join(process.cwd(), ".env.local"));

/**
 * Read a server-side environment variable, preferring the raw parsed value from
 * .env.local over process.env to avoid @next/env variable expansion corrupting
 * values that contain literal $ signs (e.g. bcrypt hashes).
 */
export function getServerEnv(key: string): string {
  return rawEnv[key] ?? process.env[key] ?? "";
}
