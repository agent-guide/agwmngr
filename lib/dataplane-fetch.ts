// Explicit subpath bypasses Bun's built-in undici shim (which delegates to fetch).
import { request } from "undici/index.js";
import type { Dispatcher } from "undici";

/** Keep the connection URL separate from a route's virtual Host under Bun. */
export async function dataplaneFetch(url: string, options: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}): Promise<Response> {
  if (!options.headers.Host) return fetch(url, options);
  // Bun's fetch and node:http implementation can use an explicit Host as the
  // connection destination. Undici connects to the registered URL instead.
  const upstream = await request(url, {
    method: options.method as Dispatcher.HttpMethod,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    // Long ACP turns and interactive waits can legitimately be idle.
    headersTimeout: 0,
    bodyTimeout: 0,
  });
  const headers = new Headers();
  for (const [key, values] of Object.entries(upstream.headers)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value !== undefined) headers.append(key, value);
    }
  }
  if ([204, 205, 304].includes(upstream.statusCode)) {
    await upstream.body.dump();
    return new Response(null, { status: upstream.statusCode, headers });
  }
  const iterator = upstream.body[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await iterator.next();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) {
      upstream.body.destroy(reason instanceof Error ? reason : undefined);
      await iterator.return?.();
    },
  });
  return new Response(body, { status: upstream.statusCode, headers });
}
