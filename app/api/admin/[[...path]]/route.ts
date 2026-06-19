import { requireAuth } from "@/lib/require-auth";
import { proxyToGateway } from "@/lib/gateway-proxy";

async function handle(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { path } = await params;
  const segments = path ?? [];
  const proxyPath = "/admin/" + segments.join("/");

  return proxyToGateway(req, proxyPath);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
