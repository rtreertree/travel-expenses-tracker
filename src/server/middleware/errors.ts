export class ApiError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export function conflict(code: string, message: string): never {
  throw new ApiError(409, code, message);
}
export function notFound(): never {
  throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
}
