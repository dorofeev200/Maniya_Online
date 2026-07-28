import { ProviderError } from './ProviderError.js';

export class TimeoutError extends ProviderError {
  constructor(message = 'Provider request timed out', { timeoutMs = 0, url = null, provider = null, cause = null } = {}) {
    super(message, { code: 'timeout_error', provider, cause, details: { timeoutMs, url } });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}
