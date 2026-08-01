import { Provider } from '../base.js';
import { FilmixClient } from './FilmixClient.js';
import { FilmixNormalizer } from './FilmixNormalizer.js';

export class FilmixProvider extends Provider {
  static id = 'filmix';
  static title = 'Filmix';

  constructor({ client = null, normalizer = null, token = '', pro = false, hls = false, streamProxy = (url) => url, ...options } = {}) {
    super(options);
    this.client = client || new FilmixClient({ token });
    this.normalizer = normalizer || new FilmixNormalizer({ pro, hls, streamProxy, hideFree720: !token });
  }

  name() {
    return this.id;
  }

  enabled() {
    return false;
  }

  searchMovie(query = {}) {
    return this.search({ ...query, type: 'movie' });
  }

  searchSeries(query = {}) {
    return this.search({ ...query, type: 'serial' });
  }

  async search({ title, original_title: originalTitle, originalTitle: camelOriginalTitle, kp, imdb, year, clarification = 0, similar = false } = {}) {
    const byTitle = await this.safeProviderCall(() => this.client.search({ title, originalTitle: camelOriginalTitle || originalTitle, clarification, year, similar }), { items: [], selected: null });
    const byIds = await this.safeProviderCall(() => this.client.searchByExternalIds({ kp, imdb, year }), []);
    const items = [...(Array.isArray(byTitle?.items) ? byTitle.items : []), ...(Array.isArray(byIds) ? byIds : [])]
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => this.normalizer.normalizeSearchItem(item));
    const selected = byTitle?.selected && typeof byTitle.selected === 'object' && !Array.isArray(byTitle.selected)
      ? this.normalizer.normalizeSearchItem(byTitle.selected)
      : null;
    return { selected, items: this.uniqueById(items) };
  }

  getCard(postId) {
    return this.safeProviderCall(() => this.client.card(postId), null);
  }

  async safeProviderCall(callback, fallback) {
    try {
      const result = await callback();
      return result ?? fallback;
    } catch {
      return fallback;
    }
  }

  async getStreams(postId, metadata = {}) {
    const card = typeof postId === 'object' ? postId : await this.getCard(postId);
    return this.normalizer.toStreamItems(card, metadata);
  }

  async getVoices(postId, seasonNumber = null) {
    const card = typeof postId === 'object' ? postId : await this.getCard(postId);
    return this.normalizer.voices(card, seasonNumber);
  }

  async getQualities(postId, options = {}) {
    const card = typeof postId === 'object' ? postId : await this.getCard(postId);
    return this.normalizer.qualities(card, options);
  }

  async getSeasons(postId) {
    const card = typeof postId === 'object' ? postId : await this.getCard(postId);
    return this.normalizer.seasons(card);
  }

  async getEpisodes(postId, seasonNumber, voiceIndex = 0, title = null) {
    const card = typeof postId === 'object' ? postId : await this.getCard(postId);
    return this.normalizer.episodes(card, seasonNumber, voiceIndex, title);
  }

  uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }
}

export default FilmixProvider;
