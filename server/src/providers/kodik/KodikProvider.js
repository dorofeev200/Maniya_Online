import { clientIp } from '../../security.js';
import { Provider } from '../base.js';
import { KodikClient } from './KodikClient.js';
import { KodikNormalizer } from './KodikNormalizer.js';

export class KodikProvider extends Provider {
  static id = 'kodik';
  static title = 'Kodik';

  constructor({ client = new KodikClient(), normalizer = new KodikNormalizer(), ...options } = {}) {
    super(options);
    this.client = client;
    this.normalizer = normalizer;
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.client.enabled();
  }

  async search(queryOrContext = {}, context) {
    if (!this.enabled()) return [];

    const requestContext = context || (queryOrContext?.request ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};

    const raw = await this.client.search({
      title: query.title,
      original_title: query.original_title,
      kinopoisk_id: query.kinopoisk_id || query.kp,
      imdb_id: query.imdb_id || query.imdb,
      season: query.season || query.s
    });

    return this.normalizer.search(raw);
  }

  async movie() {
    return [];
  }

  async serial() {
    return [];
  }

  async streams(item, context) {
    const requestContext = context || item;
    const link = requestContext?.query?.link || requestContext?.query?.url || '';
    const raw = await this.client.streams(link, {
      ip: requestContext?.request ? clientIp(requestContext.request) : '127.0.0.1'
    });

    return this.normalizer.streams(raw);
  }
}

export default KodikProvider;
