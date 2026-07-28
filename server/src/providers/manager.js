class ProviderManager {
  constructor() {
    this._providers = [];
  }

  register(provider) {
    this._providers.push(provider);
  }

  providers() {
    return this._providers;
  }

  search(context) {
    return [];
  }

  movie(context) {
    return [];
  }

  serial(context) {
    return [];
  }

  streams(context) {
    const results = [];

    for (const provider of this._providers) {
      if (typeof provider.streams !== 'function') {
        continue;
      }

      try {
        const providerResults = provider.streams(context);

        if (Array.isArray(providerResults)) {
          results.push(...providerResults);
        }
      } catch (error) {
        console.error(error);
      }
    }

    return results;
  }
}

module.exports = ProviderManager;
