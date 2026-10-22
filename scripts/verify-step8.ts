import { spawn } from "node:child_process";

if (!process.env.PLATFORM_TEST_POSTGRES_URL) {
  throw new Error(
    "PLATFORM_TEST_POSTGRES_URL must point to a disposable PostgreSQL administrative database",
  );
}

const commands: Array<{ label: string; args: string[] }> = [
  { label: "migration manifest", args: ["run", "check:migrations"] },
  { label: "test suite", args: ["test"] },
  { label: "lint", args: ["run", "lint"] },
  { label: "typecheck", args: ["run", "typecheck"] },
  { label: "contract typecheck", args: ["run", "typecheck:contracts"] },
  { label: "package boundaries", args: ["run", "check:boundaries"] },
  { label: "production build", args: ["run", "build"] },
  { label: "Bun runtime", args: ["run", "smoke:runtime"] },
  {
    label: "SQLite/PostgreSQL migration parity",
    args: ["test", "lib/platform-persistence.test.ts"],
  },
  { label: "real Agent Gateway", args: ["run", "smoke:step6-gateway"] },
];

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`bun ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

for (const command of commands) {
  console.log(`\n== Step 8: ${command.label} ==`);
  await run(command.args);
}

console.log("\nStep 8 release acceptance passed.");
