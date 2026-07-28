export class ProviderError extends Error {
  constructor(message, { code = 'provider_error', provider = null, cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider;
    this.details = details;
  }
}
