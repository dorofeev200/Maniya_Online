export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toHttpError(error) {
  if (error instanceof HttpError) return error;
  return new HttpError(500, 'internal_error', 'Internal server error');
}
