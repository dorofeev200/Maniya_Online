// Фикстуры протокола HDRezka для юнит-тестов (без сети).
// HTML-формы и base64-обёртка соответствуют Lampac Modules/OnlinePaid/Rezka.

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

/** Поток фильма: base64(`[quality]url`) с мусором `#h` + trashListBase. */
const STREAM_DECODED = [
  '[1080p]https://cdn.hdrezka.me/cdn/a/123/456.mp4 or https://backup.hdrezka.me/456.mp4',
  '[720p]https://cdn.hdrezka.me/cdn/a/123/456.720p.mp4',
  '[480p]https://cdn.hdrezka.me/cdn/a/123/456.480p.mp4'
].join(', ');

const STREAM_TRASH_TOKEN = 'JCQhIUAkJEBeIUAjJCRA'; // член trashListBase
const STREAM_ENCODED = `#h${b64(STREAM_DECODED)}//_//${STREAM_TRASH_TOKEN}`;

const STREAM_PREMIUM_DECODED = [
  '[4K]https://cdn.hdrezka.me/cdn/a/123/456.4k.mp4',
  '[1440p]https://cdn.hdrezka.me/cdn/a/123/456.1440p.mp4',
  '[1080p Ultra]https://cdn.hdrezka.me/cdn/a/123/456.uhd.mp4',
  STREAM_DECODED
].join(', ');
const STREAM_PREMIUM_ENCODED = `#h${b64(STREAM_PREMIUM_DECODED)}`;

const SEARCH_HTML = `<!DOCTYPE html>
<html><body>
  <div class="b-content__inline_item">
    <div class="b-content__inline_item-link">
      <a href="https://rezka.ag/films/12345-testovyy-film-2024.html" title="Тестовый фильм">Тестовый фильм</a>
      <div>2024</div>
    </div>
    <div class="b-content__inline_item-cover">
      <img src="https://st.hdrezka.ag/photo/f/12345/cover_12345.jpg" alt="Тестовый фильм">
    </div>
  </div>
  <div class="b-content__inline_item">
    <div class="b-content__inline_item-link">
      <a href="https://rezka.ag/cartoons/fantasy/99999-testovy-serial-2023.html" title="Тестовый сериал">Тестовый сериал</a>
      <div>2023</div>
    </div>
  </div>
  <!-- Реальный DOM: title в text-контенте якоря без атрибута title,
       cover-якорь оборачивает <img> и не должен спутать извлечение. -->
  <div class="b-content__inline_item" data-id="77777" data-url="https://rezka.ag/films/fiction/77777-live-film-2024.html">
    <div class="b-content__inline_item-cover">
      <a href="https://rezka.ag/films/fiction/77777-live-film-2024.html"><img src="https://static.hdrezka.ac/i/2024/1/1/cover.jpg" alt="Живой фильм" /><span class="cat films"><i class="entity">Фильм</i></span></a>
    </div>
    <div class="b-content__inline_item-link">
      <a href="https://rezka.ag/films/fiction/77777-live-film-2024.html">Живой фильм</a>
      <div>2024, США, Фантастика</div>
    </div>
  </div>
</body></html>`;

const EMBED_SERIAL_HTML = `<!DOCTYPE html>
<html>
<body>
  <ul id="translators-list">
    <li class="b-translator__item" data-translator_id="7"><span>Дубляж</span></li>
    <li class="b-translator__item" data-translator_id="13"><span>Оригинал</span></li>
  </ul>
  <div class="b-post__wrapper" data-season_id="1" data-episode_id="1">1 серия</div>
  <script>var t = sof.tv.initCDNSeriesEvents(12345, 7);</script>
</body>
</html>`;

const EMBED_MOVIE_HTML = `<!DOCTYPE html>
<html>
<body>
  <ul id="translators-list">
    <li class="b-translator__item" data-translator_id="7"><span>Дубляж</span></li>
  </ul>
  <script>
    var player = {"id":"cdnplayer","streams":"${STREAM_PREMIUM_ENCODED.replace(/\\/g, '\\\\')}"};
  </script>
</body>
</html>`;

const EPISODES_HTML = {
  seasons: `<ul class="b-simple_season__item_wrap"><li class="b-simple_season__item" data-tab_id="1">1 сезон</li><li class="b-simple_season__item" data-tab_id="2">2 сезон</li></ul>`,
  episodes: `<ul><li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">1 серия</li><li class="b-simple_episode__item" data-season_id="1" data-episode_id="2">2 серия</li><li class="b-simple_episode__item" data-season_id="2" data-episode_id="1">1 серия</li></ul>`
};

const SUBTITLE_HTML = '[Русские]https://cdn.hdrezka.me/subs/12345.ru.vtt,[English]https://cdn.hdrezka.me/subs/12345.en.vtt';

/** Solvable Anubis: `{"challenge":{id,randomData},"rules":{"algorithm":"fast","difficulty":N}}`. */
function anubisHtml({ id = 'challenge-test-id', randomData = 'some-random-data-123', difficulty = 4 } = {}) {
  const json = JSON.stringify({ challenge: { id, randomData }, rules: { algorithm: 'fast', difficulty } });
  return `<!DOCTYPE html><html><body><div id="anubis_challenge">${json}</div></body></html>`;
}

export {
  b64,
  STREAM_DECODED,
  STREAM_ENCODED,
  STREAM_PREMIUM_DECODED,
  STREAM_PREMIUM_ENCODED,
  SEARCH_HTML,
  EMBED_SERIAL_HTML,
  EMBED_MOVIE_HTML,
  EPISODES_HTML,
  SUBTITLE_HTML,
  anubisHtml
};
