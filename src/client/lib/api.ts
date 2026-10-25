export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public fieldErrors: Record<string, string[]> = {},
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(
      'Could not connect. Your changes are still here; check your connection and try again.',
      'NETWORK_ERROR',
    );
  }
  if (response.status === 204) return undefined as T;
  let payload: {
    error?: {
      message: string;
      code: string;
      fieldErrors?: Record<string, string[]>;
      requestId?: string;
    };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new ApiError(
      'The server returned an unexpected response. Please try again.',
      'SERVER_ERROR',
    );
  }
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'Something went wrong. Please try again.',
      payload.error?.code ?? 'SERVER_ERROR',
      payload.error?.fieldErrors,
      payload.error?.requestId,
    );
  }
  return payload as T;
}

export function queryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function mutation(method: string, body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
