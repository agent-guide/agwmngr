import { maxDocumentBytes, type DocumentUploadRequest } from "@/packages/contracts/platform/knowledge";
import { IdentityError } from "@/packages/platform/services/identity";
import { getPlatformKnowledge } from "./platform-knowledge";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "./platform-access";

export function knowledgeAuditTarget(path: readonly string[]): {
  targetKind: "knowledge_base" | "knowledge_document";
  targetId: string | null;
} {
  const documentId = path[1] === "documents" && path[2] !== "upload-sessions"
    ? path[2] ?? null
    : null;
  return documentId
    ? { targetKind: "knowledge_document", targetId: documentId }
    : { targetKind: "knowledge_base", targetId: path[0] ?? null };
}

export async function knowledgeHandler(
  request: Request,
  context: { params: Promise<{ tenantId: string; path?: string[] }> },
) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, path = [] } = await context.params;
    const service = await getPlatformKnowledge();
    const target = knowledgeAuditTarget(path);
    audit.set({
      action: `tenant:knowledge_${request.method.toLowerCase()}`,
      tenantId,
      ...target,
    });
    if (request.method === "GET" && path.length === 0) {
      return Response.json({ items: await service.list(actor, tenantId) });
    }
    if (request.method === "POST" && path.length === 0) {
      const body = await platformIdentityBody(request, ["name", "description"]);
      return Response.json(await service.create(actor, tenantId, {
        name: requiredText(body, "name"),
        description: typeof body.description === "string" ? body.description : "",
      }), { status: 201 });
    }
    if (request.method === "GET" && path.length === 1) {
      return Response.json(await service.get(actor, tenantId, path[0]));
    }
    if (request.method === "PUT" && path.length === 1) {
      const body = await platformIdentityBody(request, ["name", "description"]);
      return Response.json(await service.update(actor, tenantId, path[0], {
        name: requiredText(body, "name"),
        description: typeof body.description === "string" ? body.description : "",
      }));
    }
    if (request.method === "DELETE" && path.length === 1) {
      await service.remove(actor, tenantId, path[0]);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && path.length === 2 && path[1] === "documents") {
      return Response.json({ items: await service.listDocuments(actor, tenantId, path[0]) });
    }
    if (request.method === "POST" && path.length === 3 && path[1] === "documents" && path[2] === "upload-sessions") {
      const body = await platformIdentityBody(request, ["files"]);
      if (!Array.isArray(body.files)) throw new IdentityError("invalid_input", "files must be an array");
      const inputs = body.files.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return value as DocumentUploadRequest;
        }
        const file = value as Record<string, unknown>;
        return {
          requestKey: file.request_key,
          name: file.name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          ...(file.content_hash === undefined ? {} : { contentHash: file.content_hash }),
        } as DocumentUploadRequest;
      });
      const results = await service.initiateUploads(actor, tenantId, path[0], inputs);
      return Response.json({
        items: results.map((result) => result.ok ? {
          request_key: result.requestKey,
          ok: true,
          document: result.item,
          upload_url: `/api/platform/v1/storage/documents?token=${encodeURIComponent(result.token)}`,
          method: "PUT",
          headers: { "Content-Type": result.item.mimeType },
          expires_at: result.expiresAt,
        } : {
          request_key: result.requestKey,
          ok: false,
          error: result.error,
          code: result.code,
        }),
      }, { status: 201 });
    }
    if (request.method === "POST" && path.length === 4 && path[1] === "documents" && path[3] === "complete") {
      return Response.json(await service.complete(actor, tenantId, path[0], path[2]));
    }
    if (request.method === "GET" && path.length === 4 && path[1] === "documents" && path[3] === "download-url") {
      const ticket = await service.downloadTicket(actor, tenantId, path[0], path[2]);
      return Response.json({
        download_url: `/api/platform/v1/storage/documents?token=${encodeURIComponent(ticket.token)}`,
        method: "GET",
        expires_at: ticket.expiresAt,
      });
    }
    if (request.method === "DELETE" && path.length === 3 && path[1] === "documents") {
      await service.deleteDocument(actor, tenantId, path[0], path[2]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "knowledge route not found");
  });
}

export async function documentStorageHandler(
  request: Request,
) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    audit.set({ action: `tenant:document_storage_${request.method.toLowerCase()}`, targetKind: "knowledge_document" });
    const service = await getPlatformKnowledge();
    if (request.method === "PUT") {
      const contentLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxDocumentBytes) {
        throw new IdentityError("invalid_input", "document exceeds 25 MiB");
      }
      if (!request.body) throw new IdentityError("invalid_input", "document body is required");
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxDocumentBytes) {
          await reader.cancel();
          throw new IdentityError("invalid_input", "document exceeds 25 MiB");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const mime = request.headers.get("content-type") ?? "application/octet-stream";
      const item = await service.upload(actor, token, bytes, mime);
      audit.set({ tenantId: item.tenantId, targetId: item.id });
      return Response.json(item);
    }
    if (request.method === "GET") {
      const result = await service.download(actor, token);
      audit.set({ tenantId: result.item.tenantId, targetId: result.item.id });
      return new Response(result.bytes as BodyInit, {
        headers: {
          "Content-Type": result.item.mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.item.name)}`,
          "Content-Length": String(result.bytes.byteLength),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw new IdentityError("not_found", "storage route not found");
  });
}
