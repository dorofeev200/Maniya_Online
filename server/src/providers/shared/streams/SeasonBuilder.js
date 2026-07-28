export class SeasonBuilder {
  constructor(seed = {}) { this.season = { episodes: [], ...seed }; }
  number(number) { this.season.number = number; return this; }
  title(title) { this.season.title = title; return this; }
  episode(episode) { if (episode) this.season.episodes.push(episode); return this; }
  build() { return { ...this.season, episodes: [...this.season.episodes] }; }
}
