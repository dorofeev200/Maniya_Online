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
    const { title, original_title: originalTitle, year, type, id } = query || {};
    const response = await this.client.search({ title, originalTitle, year, type });
    return response.items.map((item) => this.normalizer.normalizeSearchItem({ ...item, id: item.id || id }));
  }

  async movie(item = {}) {
    return this.search({ ...item, type: 'movie' });
  }

  async serial(item = {}) {
    return this.search({ ...item, type: 'serial' });
  }

  async streams(item = {}) {
    if (!item?.id) return [];
    const payload = await this.client.streams(item.id);
    return this.normalizer.normalizeStreams(payload).map((stream) => this.streamItem({
      id: String(item.id),
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
}

export default RezkaProvider;
