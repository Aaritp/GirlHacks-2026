import type { GroveApi } from './contracts';
import { ApiError } from './contracts';

export function createJsonClient(baseUrl = '/api', fetcher: typeof fetch = fetch) {
  return async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, payload?.error?.code ?? 'HTTP_ERROR',
        payload?.error?.message ?? `Request failed (${response.status})`);
    }
    if (payload === null) throw new ApiError(502, 'INVALID_RESPONSE', 'Expected a JSON response');
    return payload as T;
  };
}

export function createHttpApi(baseUrl = '/api', fetcher: typeof fetch = fetch): GroveApi {
  const request = createJsonClient(baseUrl, fetcher);
  return {
    getSpeechToken: () => request('/speech-token', 'POST'),
    saveUtterance: (body) => request('/utterances', 'POST', body),
    extract: (body) => request('/extract', 'POST', body),
    extractSource: (body) => request('/extract/source', 'POST', body),
    getUtterances: (meetingId) => request(`/meetings/${encodeURIComponent(meetingId)}/utterances`),
    createSeed: (body) => request('/seeds', 'POST', body),
    updateSeed: (meetingId, id, body) => request(
      `/seeds/${encodeURIComponent(id)}?meetingId=${encodeURIComponent(meetingId)}`, 'PATCH', body),
    getGrove: (meetingId) => request(`/meetings/${encodeURIComponent(meetingId)}/grove`),
    readWhiteboard: (body) => request('/whiteboard', 'POST', body),
    suggest: (body) => request('/leaves/suggest', 'POST', body),
    compose: (body) => request('/leaves/compose', 'POST', body),
  };
}
