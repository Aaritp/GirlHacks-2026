/**
 * Vercel serverless proxy: forwards /api/* from the browser to the Azure Functions backend and
 * adds the Functions key on the server, so the key is never shipped to the browser.
 * vercel.json rewrites every /api/<path> to /api/proxy?__path=<path>, because a catch-all
 * function file does not match multi-segment paths outside Next.js.
 *
 * Vercel environment variables (server-side only, never VITE_*):
 *   GROVEKEEPER_API_ORIGIN  e.g. https://grovekeeper-api.azurewebsites.net  (no trailing /api)
 *   GROVEKEEPER_API_KEY     an Azure Functions host key
 */
// Node runtime globals; declared here because web/ has no @types/node.
declare const process: { env: Record<string, string | undefined> };

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after'];

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

async function proxy(request: Request): Promise<Response> {
  const origin = process.env.GROVEKEEPER_API_ORIGIN?.trim().replace(/\/+$/, '');
  const key = process.env.GROVEKEEPER_API_KEY?.trim();
  if (!origin || !key) {
    return errorResponse(503, 'PROXY_NOT_CONFIGURED', 'The API proxy is missing GROVEKEEPER_API_ORIGIN or GROVEKEEPER_API_KEY.');
  }
  const incoming = new URL(request.url);
  const rewritten = incoming.searchParams.get('__path');
  incoming.searchParams.delete('__path');
  const pathname = rewritten !== null ? `/api/${rewritten.replace(/^\/+/, '')}` : incoming.pathname;
  if (!pathname.startsWith('/api/') || pathname === '/api/proxy') return errorResponse(404, 'NOT_FOUND', 'Not found.');
  const search = incoming.searchParams.toString();

  const headers = new Headers({ 'x-functions-key': key });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const upstream = await fetch(`${origin}${pathname}${search ? `?${search}` : ''}`, {
      method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined,
    });
    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return errorResponse(502, 'UPSTREAM_UNREACHABLE', 'The Grovekeeper API could not be reached.');
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
