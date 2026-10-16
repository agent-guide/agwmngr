// Evaluate this in the serving process so health never reports the build runtime.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    status: "ok",
    runtime: process.versions.bun ? "bun" : "node",
  });
}
