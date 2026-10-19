import { tenantAuthoredResourceHandler } from "@/lib/platform-authored-resource-http";

export const dynamic = "force-dynamic";
const handler = tenantAuthoredResourceHandler("instruction");
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
