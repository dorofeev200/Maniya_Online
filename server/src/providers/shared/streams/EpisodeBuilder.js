export class EpisodeBuilder {
  constructor(seed = {}) { this.episode = { streams: [], ...seed }; }
  number(number) { this.episode.number = number; return this; }
  title(title) { this.episode.title = title; return this; }
  stream(stream) { if (stream) this.episode.streams.push(stream); return this; }
  build() { return { ...this.episode, streams: [...this.episode.streams] }; }
}
