import { ProviderError } from './ProviderError.js';

export class HttpError extends ProviderError {
  constructor(message, { statusCode = 0, url = null, method = 'GET', provider = null, cause = null, details = null } = {}) {
    super(message, { code: 'http_error', provider, cause, details });
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.url = url;
    this.method = method;
  }
}
