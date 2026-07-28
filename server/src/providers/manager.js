import { assertStreamItems, isStreamItem } from './base.js';

function toApiItem(item) {
  if (!isStreamItem(item)) throw new TypeError('ProviderManager can only serialize StreamItem');

  return {
    title: item.title,
    method: 'play',
    url: item.stream.url,
    quality: {
      [item.quality]: item.stream.url
    },
    subtitles: item.subtitles
  };
}

export class ProviderManager {
  constructor(providers = []) {
    this.providers = [];
    this.registerMany(providers);
  }

  register(provider) {
    if (!provider || typeof provider !== 'object') throw new TypeError('ProviderManager.register expects Provider instance');
    if (typeof provider.name !== 'function') throw new TypeError('Provider must implement name()');
    if (typeof provider.enabled !== 'function') throw new TypeError('Provider must implement enabled()');
    if (typeof provider.streams !== 'function') throw new TypeError('Provider must implement streams()');

    this.providers.push(provider);
    return this;
  }

  registerMany(providers) {
    if (!Array.isArray(providers)) throw new TypeError('ProviderManager constructor expects an array of providers');
    providers.forEach((provider) => this.register(provider));
    return this;
  }

  async getStreamItems(context) {
    const enabledProviders = this.providers.filter((provider) => provider.enabled());
    const groups = await Promise.all(enabledProviders.map(async (provider) => {
      const items = await provider.streams(undefined, context);
      return assertStreamItems(items, provider.name());
    }));

    return groups.flat();
  }

  async getVideosForRequest(context) {
    const items = await this.getStreamItems(context);
    return items.map(toApiItem);
  }
}

export { toApiItem };
export const providerManager = new ProviderManager();
