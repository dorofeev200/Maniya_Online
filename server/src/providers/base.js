const REQUIRED_STREAM_ITEM_FIELDS = [
  'provider',
  'id',
  'title',
  'type',
  'quality',
  'voice',
  'stream',
  'subtitles'
];

/**
 * Provider interface.
 *
 * Providers are internal adapters that expose stream data from one source.
 * Implementations must not return API response objects directly. Search and
 * entity lookup methods return provider-local records, while streams() returns
 * an array of StreamItem objects created through streamItem().
 *
 * Required methods:
 * - constructor(options): initialize provider configuration.
 * - name(): return the stable provider identifier.
 * - enabled(): return true when the provider may be used.
 * - search(query, context): return provider-local search results.
 * - movie(item, context): return provider-local movie data.
 * - serial(item, context): return provider-local serial data.
 * - streams(item, context): return StreamItem[] for the selected entity.
 */
export class Provider {
  constructor({ id, title } = {}) {
    this.id = asString(id || this.constructor.id || this.constructor.name, 'provider.id');
    this.title = String(title || this.constructor.title || this.id).trim();
  }

  name() {
    return this.id;
  }

  enabled() {
    return false;
  }

  async search() {
    return [];
  }

  async movie() {
    return [];
  }

  async serial() {
    return [];
  }

  async streams() {
    return [];
  }

  async getStreams(context) {
    return this.streams(undefined, context);
  }

  streamItem(item) {
    return createStreamItem({ provider: this.name(), ...item });
  }
}

function asObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`StreamItem.${field} must be an object`);
  }
  return value;
}

function asString(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`StreamItem.${field} must be a non-empty string`);
  return text;
}

function normalizeHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  return { ...asObject(headers, 'stream.headers') };
}

function normalizeSubtitles(subtitles) {
  if (subtitles === undefined || subtitles === null) return [];
  if (!Array.isArray(subtitles)) throw new TypeError('StreamItem.subtitles must be an array');
  return subtitles.map((subtitle) => ({ ...asObject(subtitle, 'subtitles[]') }));
}

export function createStreamItem(item) {
  const source = asObject(item, '');
  const stream = asObject(source.stream, 'stream');

  return Object.freeze({
    provider: asString(source.provider, 'provider'),
    id: asString(source.id, 'id'),
    title: asString(source.title, 'title'),
    type: asString(source.type, 'type'),
    quality: asString(source.quality, 'quality'),
    voice: String(source.voice ?? '').trim(),
    stream: Object.freeze({
      url: asString(stream.url, 'stream.url'),
      headers: Object.freeze(normalizeHeaders(stream.headers))
    }),
    subtitles: Object.freeze(normalizeSubtitles(source.subtitles))
  });
}

export function isStreamItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!REQUIRED_STREAM_ITEM_FIELDS.every((field) => Object.hasOwn(item, field))) return false;
  if (!item.stream || typeof item.stream !== 'object') return false;
  return typeof item.stream.url === 'string'
    && item.stream.url.length > 0
    && item.stream.headers
    && typeof item.stream.headers === 'object'
    && Array.isArray(item.subtitles);
}

export function assertStreamItems(items, providerName = 'provider') {
  if (!Array.isArray(items)) throw new TypeError(`${providerName} must return an array of StreamItem`);

  return items.map((item, index) => {
    const streamItem = createStreamItem(item);
    if (!isStreamItem(streamItem)) throw new TypeError(`${providerName} returned invalid StreamItem at index ${index}`);
    return streamItem;
  });
}

export const BaseProvider = Provider;
