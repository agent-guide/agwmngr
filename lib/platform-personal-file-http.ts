import { maxPersonalFileBytes, type PersonalFileUploadRequest } from "@/packages/contracts/platform/personal-files";
import { IdentityError } from "@/packages/platform/services/identity";
import { getPlatformPersonalFiles } from "./platform-personal-files";
import { platformIdentityBody, withPlatformIdentity } from "./platform-access";

export async function personalFileHandler(
  request: Request,
  context: { params: Promise<{ tenantId: string; path?: string[] }> },
) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, path = [] } = await context.params;
    const service = await getPlatformPersonalFiles();
    audit.set({
      action: `tenant:personal_file_${request.method.toLowerCase()}`,
      tenantId,
      targetKind: "personal_file",
      targetId: path[0] ?? null,
    });
    if (request.method === "GET" && path.length === 0) {
      return Response.json({ items: await service.list(actor, tenantId) });
    }
    if (request.method === "POST" && path.length === 1 && path[0] === "upload-session") {
      const body = await platformIdentityBody(request, ["request_key", "name", "mime_type", "size_bytes", "content_hash"]);
      const created = await service.initiate(actor, tenantId, {
        requestKey: body.request_key as string,
        name: body.name as string,
        mimeType: body.mime_type as string,
        sizeBytes: body.size_bytes as number,
        ...(body.content_hash === undefined ? {} : { contentHash: body.content_hash as string }),
      } as PersonalFileUploadRequest);
      audit.set({ targetId: created.item.id });
      return Response.json({
        file: created.item,
        upload_url: `/api/platform/v1/storage/files?token=${encodeURIComponent(created.token)}`,
        method: "PUT",
        headers: { "Content-Type": created.item.mimeType },
        expires_at: created.expiresAt,
      }, { status: 201 });
    }
    if (request.method === "POST" && path.length === 2 && path[1] === "complete") {
      return Response.json(await service.complete(actor, tenantId, path[0]));
    }
    if (request.method === "GET" && path.length === 2 && (path[1] === "download-url" || path[1] === "preview-url")) {
      const operation = path[1] === "preview-url" ? "preview" : "download";
      const ticket = await service.createReadTicket(actor, tenantId, path[0], operation);
      return Response.json({
        url: `/api/platform/v1/storage/files?operation=${operation}&token=${encodeURIComponent(ticket.token)}`,
        method: "GET",
        expires_at: ticket.expiresAt,
      });
    }
    if (request.method === "DELETE" && path.length === 1) {
      await service.remove(actor, tenantId, path[0]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "personal file route not found");
  });
}

export async function personalFileStorageHandler(request: Request) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const operation = url.searchParams.get("operation") === "preview" ? "preview" : "download";
    const service = await getPlatformPersonalFiles();
    audit.set({ action: `tenant:personal_file_storage_${request.method.toLowerCase()}`, targetKind: "personal_file" });
    if (request.method === "PUT") {
      const contentLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxPersonalFileBytes) {
        throw new IdentityError("invalid_input", "file exceeds 25 MiB");
      }
      if (!request.body) throw new IdentityError("invalid_input", "file body is required");
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxPersonalFileBytes) {
          await reader.cancel();
          throw new IdentityError("invalid_input", "file exceeds 25 MiB");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const item = await service.upload(actor, token, bytes, request.headers.get("content-type") ?? "application/octet-stream");
      audit.set({ tenantId: item.tenantId, targetId: item.id });
      return Response.json(item);
    }
    if (request.method === "GET") {
      const result = await service.read(actor, token, operation);
      audit.set({ tenantId: result.item.tenantId, targetId: result.item.id });
      const preview = operation === "preview";
      const contentType = preview && result.item.mimeType === "text/html" ? "text/plain" : result.item.mimeType;
      return new Response(result.bytes as BodyInit, { headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(result.item.name)}`,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      } });
    }
    throw new IdentityError("not_found", "personal file storage route not found");
  });
}
