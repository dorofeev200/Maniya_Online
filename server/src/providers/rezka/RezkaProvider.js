import { Provider } from '../base.js';
import { RezkaClient } from './RezkaClient.js';
import { RezkaNormalizer } from './RezkaNormalizer.js';

export class RezkaProvider extends Provider {
  static id = 'rezka';
  static title = 'Rezka';

  constructor({ client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.client = client || new RezkaClient();
    this.normalizer = normalizer || new RezkaNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return true;
  }

  async search(query = {}) {
    const { title, original_title: originalTitle, originalTitle: camelOriginalTitle, year, type, id } = query || {};
    const response = await this.safeProviderCall(
      () => this.client.search({ title, originalTitle: camelOriginalTitle || originalTitle, year, type }),
      { items: [], selected: null }
    );
    return (Array.isArray(response.items) ? response.items : [])
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => this.normalizer.normalizeSearchItem({ ...item, id: item.id || id }));
  }

  async movie(item = {}) {
    return this.resolveCard({ ...item, type: 'movie' });
  }

  async serial(item = {}) {
    return this.resolveCard({ ...item, type: 'serial' });
  }

  async resolveCard(item = {}) {
    const id = item?.id || item?.post_id || item?.postId;
    if (!id) return null;
    const card = await this.safeProviderCall(() => this.client.card(id), null);
    if (!card) return null;
    return this.normalizer.normalizeCard({ ...item, ...card, id: card.id || id, type: card.type || item.type });
  }

  async streams(item = {}) {
    const id = item?.id || item?.post_id || item?.postId;
    if (!id) return [];
    const payload = await this.safeProviderCall(() => this.client.streams(id, item), null);
    return this.normalizer.normalizeStreams(payload, item).map((stream) => this.streamItem({
      id: String(id),
      title: item.title || item.original_title || this.id,
      type: item.type || 'movie',
      quality: stream.quality || 'auto',
      voice: stream.voice || item.voice || '',
      stream: {
        url: stream.url,
        headers: stream.headers
      },
      subtitles: stream.subtitles || []
    }));
  }

  async safeProviderCall(callback, fallback) {
    try {
      const result = await callback();
      return result ?? fallback;
    } catch {
      return fallback;
    }
  }
}

export default RezkaProvider;
