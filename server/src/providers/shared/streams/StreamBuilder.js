import { normalizeQuality } from '../normalize/QualityNormalizer.js';
import { normalizeVoice } from '../normalize/VoiceNormalizer.js';

export class StreamBuilder {
  constructor(seed = {}) {
    this.stream = { headers: {}, subtitles: [], ...seed };
  }

  url(url) { this.stream.url = url; return this; }
  title(title) { this.stream.title = title; return this; }
  quality(quality) { this.stream.quality = normalizeQuality(quality); return this; }
  voice(voice) { this.stream.voice = normalizeVoice(voice); return this; }
  header(name, value) { if (value !== undefined && value !== null) this.stream.headers[name] = value; return this; }
  subtitle(subtitle) { if (subtitle) this.stream.subtitles.push(subtitle); return this; }
  build() { return { ...this.stream, headers: { ...this.stream.headers }, subtitles: [...this.stream.subtitles] }; }
}
