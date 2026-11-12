export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorEnvelope = { error?: { code?: string; message?: string } };

export type ApiOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  csrfToken?: string;
  idempotencyKey?: string;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.csrfToken) headers['X-CSRF-Token'] = options.csrfToken;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the payment service. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = (data ?? {}) as ErrorEnvelope;
    throw new ApiError(response.status, envelope.error?.code ?? 'REQUEST_FAILED', envelope.error?.message ?? 'The request failed. Try again.');
  }
  return data as T;
}