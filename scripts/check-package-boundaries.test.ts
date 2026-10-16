import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "agwmngr-boundaries-"));
  try {
    for (const layer of ["contracts", "platform", "gateway-client"]) {
      mkdirSync(join(root, "packages", layer), { recursive: true });
    }
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, "packages", name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }

    const result = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "check-package-boundaries.ts"),
      "--root",
      root,
    ]);
    return {
      code: result.exitCode,
      output: result.stderr.toString() + result.stdout.toString(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("allows pure services and Gateway adapters to depend on contracts", () => {
  expect(
    check({
      "contracts/identity.ts": "export interface Identity { id: string }",
      "platform/authorization/service.ts":
        "import type { Identity } from '../../contracts/identity'; export function idOf(value: Identity) { return value.id; }",
      "gateway-client/admin.ts":
        "import type { Identity } from '../contracts/identity'; export function respond(value: Identity) { return Response.json(value); }",
    }).code,
  ).toBe(0);
});

test("rejects framework and manager-layer imports from contracts", () => {
  const result = check({
    "contracts/invalid.ts":
      "import type { ReactNode } from 'react'; import { getToken } from '@/lib/auth'; export type Value = ReactNode;",
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("external import react");
  expect(result.output).toContain("crosses the contracts boundary");
});

test("rejects HTTP-coupled platform services and reverse adapter imports", () => {
  const result = check({
    "platform/invalid.ts":
      "export function parse(req: Request) { return req.json(); } import type { Data } from '../gateway-client/admin'; const adapter = import('../gateway-client/admin'); const name = 'react'; require(name);",
    "gateway-client/admin.ts": "export interface Data { id: string }",
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("HTTP/browser identifier Request");
  expect(result.output).toContain("crosses the platform boundary");
  expect(result.output).toContain("computed module loading");
});
