/** Typed application error → consistent JSON error body: { error: { code, message, details } } */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 428 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (code: string, message: string, details?: unknown) =>
  new AppError(403, code, message, details);
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);

export const ERROR_DOCS_BASE = "https://github.com/nabeelali0707/asli/blob/main/docs/ERRORS.md#";

/** RFC 9457 problem details (application/problem+json). `error` is kept for older clients. */
export function problem(status: number, code: string, message: string, instance: string, requestId?: string, details?: unknown) {
  return {
    type: ERROR_DOCS_BASE + code.toLowerCase(),
    title: code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    status,
    detail: message,
    instance,
    code,
    requestId,
    ...(details === undefined ? {} : { details }),
    error: { code, message, details },
  };
}
