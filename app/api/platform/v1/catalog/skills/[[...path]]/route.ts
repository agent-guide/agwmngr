import { platformAuthoredResourceHandler } from "@/lib/platform-authored-resource-http";

export const dynamic = "force-dynamic";
const handler = platformAuthoredResourceHandler("skill");
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
