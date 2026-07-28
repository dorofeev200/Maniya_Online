import { Provider } from '../base.js';
import { AllohaClient } from './AllohaClient.js';
import { AllohaNormalizer } from './AllohaNormalizer.js';

export class AllohaProvider extends Provider {
  static id = 'alloha';
  static title = 'Alloha';

  constructor({ client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.client = client || new AllohaClient();
    this.normalizer = normalizer || new AllohaNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return true;
  }

  async search(query = {}) {
    const { title, original_title: originalTitle, year, type, imdb, kp, id } = query || {};
    const response = await this.client.search({ title, originalTitle, year, type, imdb, kp });
    return response.items.map((item) => this.normalizer.normalizeSearchItem({ ...item, id: item.id || id }));
  }

  async movie(item = {}) {
    return this.search({ ...item, type: 'movie' });
  }

  async serial(item = {}) {
    return this.search({ ...item, type: 'serial' });
  }

  async getSeasons(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeSeasons(payload);
  }

  async getEpisodes(item = {}, seasonNumber = null) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    const seasons = Array.isArray(payload?.item?.seasons) ? payload.item.seasons : [];
    const season = seasons.find((entry) => entry.season === seasonNumber || entry.number === seasonNumber) || seasons[0] || {};
    return (season.episodes || []).map((episode) => this.normalizer.normalizeEpisode(episode));
  }

  async getTranslations(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeTranslations(payload);
  }

  async getQualities(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeQualities(payload);
  }

  async streams(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.streams({
      token: item.token || item.id,
      translationId: item.translationId || item.t || item.translation || null,
      season: item.season || item.s || null,
      episode: item.episode || item.e || null,
      directorsCut: Boolean(item.directorsCut)
    });
    return this.normalizer.normalizeStreams(payload).map((stream) => this.streamItem({
      id: String(item.id || item.token || ''),
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

export default AllohaProvider;
