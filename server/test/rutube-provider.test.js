// RUTUBE-NORMALIZER-FIX-001: native Rutube-поиск/нормализация.
// Scored ranking вместо «первой прошедшей»: реальные фильмы находятся
// (в т.ч. англоязычные копии), а reaction/review/stream-контент не проходит.
// Отчёт: docs/rutube-normalizer-fix-001-report.md.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RutubeProvider } from '../src/providers/rutube/RutubeProvider.js';
import { RutubeNormalizer } from '../src/providers/rutube/RutubeNormalizer.js';
import { searchNameTo } from '../src/providers/shared/normalize/searchNameTo.js';

/** Fake RutubeClient: search(queryString) по карте, playOptions по m3u8 (можно function). */
class FakeRutubeClient {
  constructor({ searchByQuery = null, m3u8 = '', enabled = true } = {}) {
    this.calls = [];
    this.searchByQuery = searchByQuery || {};
    this.m3u8 = m3u8;
    this.enabledFlag = enabled;
    this.host = 'https://rutube.ru';
  }

  enabled() {
    return this.enabledFlag;
  }

  async search(query) {
    this.calls.push(['search', query]);
    return this.searchByQuery[query] ?? [];
  }

  async searchAll(queries = []) {
    const seen = new Set();
    const out = [];
    for (const query of queries) {
      for (const item of await this.search(query)) {
        const id = String(item?.id || '');
        if (id && !seen.has(id)) {
          seen.add(id);
          out.push(item);
        }
      }
    }
    return out;
  }

  async playOptions(linkid) {
    this.calls.push(['playOptions', linkid]);
    return typeof this.m3u8 === 'function' ? this.m3u8(linkid) : this.m3u8;
  }
}

/** Базовый валидный item: категория «Фильмы»=4, полнометражный, без флагов. */
const base = (over = {}) => ({
  id: '8a1f2c3d',
  title: 'Начало (Inception, 2010) — фильм',
  duration: 7200000,
  category: { id: 4 },
  hits: 1000,
  description: 'Фильм о снах внутри снов',
  is_hidden: false,
  is_deleted: false,
  is_adult: false,
  is_locked: false,
  is_audio: false,
  is_paid: false,
  is_livestream: false,
  thumbnail_url: 'https://i.rutube.ru/thumb.jpg',
  ...over
});

test('searchNameTo: нормализация как SearchNameTo.Convert', () => {
  assert.equal(searchNameTo('Начало (2010)'), 'начало2010');
  assert.equal(searchNameTo('Ёлка, "2:0"!'), 'елка20');
  assert.equal(searchNameTo('Щелкунчик'), 'шелкунчик'); // щ→ш
  assert.equal(searchNameTo('---!!!'), null);           // нет букв/цифр
  assert.equal(searchNameTo(''), null);
});

test('RutubeProvider.search: RU-only query, правильная полная копия найдена', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: { 'Начало 2010': [base()], 'Inception 2010': [] }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Начало', original_title: 'Inception', year: '2010' });

  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.provider, 'rutubemovie');
  assert.equal(record.id, '8a1f2c3d');
  assert.equal(record.title, 'Начало (Inception, 2010) — фильм');
  assert.equal(record.year, 2010);
  assert.equal(record.type, 'movie');
  assert.equal(record.poster, 'https://i.rutube.ru/thumb.jpg');
  assert.equal(record.duration, 7200000);
  // Мульти-запрос: RU первым, EN дальше; слитый список дедуплицирован.
  assert.deepEqual(client.calls, [['search', 'Начало 2010'], ['search', 'Inception 2010']]);
});

test('RutubeProvider.search: EN fallback — REAL англоязычная копия (валидный original_title)', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Аватар 2009': [],
      'Avatar 2009': [base({ id: 'av-en', title: 'Avatar (movie, 2009)', hits: 278 })]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Аватар', original_title: 'Avatar', year: '2009' });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'av-en');
  assert.equal(records[0].title, 'Avatar (movie, 2009)');
});

test('RutubeProvider.search: exact title ранжируется первым (бонус точного равенства)', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Матрица 1999': [
        base({ id: 'b', title: 'Матрица (фильм, 1999)' }),
        base({ id: 'a', title: 'Матрица' })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Матрица', year: '1999' });

  assert.deepEqual(records.map((r) => r.id), ['a', 'b']);
});

test('RutubeProvider.search: reaction/review-контент не проходит, полная копия остаётся', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Матрица 1999': [
        base({ id: 'r', title: 'Реакция на фильм Матрица (1999)', duration: 3730, hits: 156, description: 'Закажи реакцию — boosty' }),
        base({ id: 'l', title: 'Матрица (фильм, 1999)' })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Матрица', year: '1999' });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'l');
});

test('RutubeProvider.search: duration ranking — полнометражная копия выше короткой', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Интерстеллар 2014': [
        base({ id: 'short', title: 'Интерстеллар (2014)', duration: 4400 }),
        base({ id: 'long', title: 'Интерстеллар (2014) полный фильм', duration: 10144 })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Интерстеллар', year: '2014' });

  assert.deepEqual(records.map((r) => r.id), ['long', 'short']);
});

test('RutubeProvider.search: отсутствующий фильм → пусто (без ложного чужого контента)', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Аннигиляция 2018': [base({ id: 'doom', title: 'Doom: Аннигиляция (фильм, 2019)', duration: 5800, hits: 177374 })]
    }
  });
  const provider = new RutubeProvider({ client });

  // «Doom: Аннигиляция» не стартует с ключа и несёт другой год → ниже порога.
  assert.deepEqual(await provider.search({ title: 'Аннигиляция', year: '2018' }), []);
});

test('RutubeProvider.search: несколько кандидатов — сиквел с чужим годом отсекан, копия в тренде', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Матрица 1999': [
        base({ id: 'sq', title: 'Матрица: Революция (2003) / The Matrix Revolutions', hits: 37149 }),
        base({ id: 'l', title: 'Матрица (фильм, 1999)' })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Матрица', year: '1999' });

  assert.deepEqual(records.map((r) => r.id), ['l']);
});

test('RutubeProvider.search: мусор в yearful-запросе → yearless-fallback находит полную копию', async () => {
  // Живой кейс 2026-08-16: «Зеленая миля 1999» по топ-2 страницам даёт только
  // пересказ «Джон Коффи…mp4» (3877с) и реакционные шоу; полная копия «Зелёная
  // Миля» (6460с, cat=4) лежит под запросом БЕЗ года. Пока yearful-результат
  // не прошёл MIN_SCORE — пробуем yearless (до этого fallback шёл только на
  // полностью пустой raw).
  const yearlessFull = base({ id: 'full-movie', title: 'Зелёная Миля', duration: 6460, hits: 109, description: 'ВСЯ КНИГА https://boosty.to/...' });
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Зеленая миля 1999': [
        base({ id: 'recap', title: 'Зеленая Миля (Стивен Кинг) - Джон Коффи и история его тетради.mp4', duration: 3877, hits: 145 })
      ],
      'Зеленая миля': [yearlessFull],
      'The Green Mile 1999': [],
      'The Green Mile': []
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Зеленая миля', original_title: 'The Green Mile', year: '1999' });

  assert.deepEqual(records.map((r) => r.id), ['full-movie']);
  // Хотя первичный RU-запрос шёл с годом, сырой EN-запрос тоже пробовался.
  assert.deepEqual(client.calls, [
    ['search', 'Зеленая миля 1999'], ['search', 'The Green Mile 1999'],
    ['search', 'Зеленая миля'], ['search', 'The Green Mile']
  ]);
});

test('RutubeProvider.search: год не обязателен (yearless query), safety-флаги блокируют', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Зеленая миля': [
        base({ id: 'legit', title: 'Зеленая миля (1999) / The Green Mile', year_to_ignore: true }),
        base({ id: 'adult', title: 'Зеленая миля', is_adult: true, duration: 11323 })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Зеленая миля' });

  assert.deepEqual(records.map((r) => r.id), ['legit']);
  assert.deepEqual(client.calls, [['search', 'Зеленая миля']]);
});

test('RutubeProvider.search: пустой title/keys → [], клиент не трогается', async () => {
  const client = new FakeRutubeClient();
  const provider = new RutubeProvider({ client });

  assert.deepEqual(await provider.search({}), []);
  assert.deepEqual(await provider.search({ title: '   ' }), []);
  assert.equal(client.calls.length, 0);
});

test('RutubeProvider.movie/serial: только фильмы', async () => {
  const client = new FakeRutubeClient({ searchByQuery: { 'Начало 2010': [base()] } });
  const provider = new RutubeProvider({ client });

  const movies = await provider.movie({ title: 'Начало', year: '2010' });
  assert.equal(movies.length, 1);
  assert.deepEqual(await provider.serial({ title: 'Начало', year: '2010' }), []);
});

test('RutubeProvider.videos: топ-кандидат → {method:play} с quality.auto через прокси', async () => {
  const m3u8 = 'https://rutube.ru/video/balancer/m3u8/8a1f2c3d';
  const client = new FakeRutubeClient({ searchByQuery: { 'Начало 2010': [base()] }, m3u8 });
  const provider = new RutubeProvider({ client });

  const payload = await provider.videos({ query: { title: 'Начало', year: '2010' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.voice_name, 'Оригинал');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(item.url, /rutube\.ru/);
  assert.equal(item.quality.auto, item.url);
  assert.equal(item.headers.Referer, 'https://rutube.ru/');
  assert.deepEqual(payload.seasons, []);
  assert.deepEqual(payload.voices, []);
});

test('RutubeProvider.videos: сломанный playOptions у топ-1 → следующий кандидат даёт item', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Начало 2010': [base({ id: 'broken' }), base({ id: 'ok', title: 'Начало (2010)' })]
    },
    m3u8: (linkid) => (linkid === 'ok' ? 'https://rutube.ru/video/balancer/m3u8/ok' : '')
  });
  const provider = new RutubeProvider({ client });

  const payload = await provider.videos({ query: { title: 'Начало', year: '2010' } });

  assert.equal(payload.items.length, 1);
  // URL прокинут через наш прокси (buildProxyUrl) → путь закодирован.
  assert.match(payload.items[0].url, /%2Fm3u8%2Fok/);
});

test('RutubeProvider.videos: нет записей/пустой m3u8/ошибка → пустой payload', async () => {
  const empty = new FakeRutubeClient({ searchByQuery: {} });
  const providerEmpty = new RutubeProvider({ client: empty });
  assert.deepEqual(await providerEmpty.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });

  const noStream = new FakeRutubeClient({ searchByQuery: { 'Начало 2010': [base()] }, m3u8: '' });
  const providerNoStream = new RutubeProvider({ client: noStream });
  assert.deepEqual(await providerNoStream.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });

  const failing = new FakeRutubeClient({ searchByQuery: { 'Начало 2010': [base()] }, m3u8: 'https://rutube.ru/x.m3u8' });
  failing.playOptions = async () => { throw new Error('geo'); };
  const providerFailing = new RutubeProvider({ client: failing });
  assert.deepEqual(await providerFailing.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });
});

test('RutubeProvider.streams: linkid → StreamItem[] (auto, прокси, Referer)', async () => {
  const m3u8 = 'https://rutube.ru/video/balancer/m3u8/8a1f2c3d';
  const client = new FakeRutubeClient({ m3u8 });
  const provider = new RutubeProvider({ client });

  const items = await provider.streams({ id: '8a1f2c3d', title: 'Начало', type: 'movie' });

  assert.equal(items.length, 1);
  const stream = items[0];
  assert.equal(stream.provider, 'rutubemovie');
  assert.equal(stream.id, '8a1f2c3d');
  assert.equal(stream.type, 'movie');
  assert.equal(stream.quality, 'auto');
  assert.equal(stream.voice, 'Оригинал');
  assert.match(stream.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(stream.stream.headers.Referer, 'https://rutube.ru/');
  assert.deepEqual(stream.subtitles, []);
});

test('RutubeProvider.streams: пустой linkid / ошибка → []', async () => {
  const client = new FakeRutubeClient();
  const provider = new RutubeProvider({ client });
  assert.deepEqual(await provider.streams({}), []);

  const failing = new FakeRutubeClient({ m3u8: 'https://rutube.ru/x.m3u8' });
  failing.playOptions = async () => { throw new Error('network'); };
  const providerFailing = new RutubeProvider({ client: failing });
  assert.deepEqual(await providerFailing.streams({ id: '8a1f2c3d' }), []);
});

test('RutubeProvider: отключён → [] везде, клиент не трогается', async () => {
  const client = new FakeRutubeClient({ searchByQuery: { 'Начало 2010': [base()] }, m3u8: 'https://rutube.ru/x.m3u8' });
  const provider = new RutubeProvider({ client, enabled: false });

  assert.deepEqual(await provider.search({ title: 'Начало', year: '2010' }), []);
  assert.deepEqual(await provider.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ id: '8a1f2c3d' }), []);
  assert.equal(client.calls.length, 0);
});

test('RutubeNormalizer: scored ranking в изоляции (без сети)', () => {
  const normalizer = new RutubeNormalizer();
  const records = normalizer.with({ searchKeys: ['inception', 'начало'], year: 2010 }).searchResults([
    base(),
    base({ id: 'adult', is_adult: true }),
    base({ id: 'locked', is_locked: true }),
    base({ id: 'live', is_livestream: true }),
    base({ id: 'ep', title: 'Начало (Inception, 2010) серия 1' })
  ]);

  // Adult/locked/livestream — жёсткий блок; «серия» исключена словом; без флагов — остаётся.
  assert.deepEqual(records.map((r) => r.id), ['8a1f2c3d']);
});

test('RutubeProvider.search: реакционный подкаст/обзорный шоу не вытесняет полную копию', async () => {
  // Аудит 2026-08-16: «Интерстеллар. Досмотрелись #15» (cat73, подкаст-шоу)
  // и лекционный «…о фильме…» должны уступать полной 10169с копии, даже когда
  // у копии в description реклама реакционного канала («ПОЛНАЯ РЕАКЦИЯ…boosty»).
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Интерстеллар 2014': [
        base({ id: 'podcast', title: 'Интерстеллар. Досмотрелись #15', duration: 5690, hits: 59, category: { id: 73 } }),
        base({ id: 'talk', title: 'Дмитрий Пучков и Клим Жуков о фильме "Интерстеллар"', hits: 23000 }),
        base({ id: 'full', title: 'Интерстеллар (2014)', duration: 10144, hits: 50366, description: 'ПОЛНАЯ РЕАКЦИЯ НА ФИЛЬМ: https://boosty.to/...' }),
        base({ id: 'puchkov', title: 'Клим Жуков про "Интерстеллар" | Синий Фил 372', category: { id: 57 }, hits: 27000 })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' });

  assert.deepEqual(records.map((r) => r.id), ['full']);
});

test('RutubeProvider.search: «…о фильме…»/«про фильм» в титле — реакционный материал', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Дюна: Часть вторая 2024': [
        base({ id: 'puchkov', title: 'Дмитрий Пучков и Клим Жуков о фильме "Дюна: Часть вторая"', hits: 23000 }),
        base({ id: 'film', title: 'Дюна: Часть вторая (2024) — фильм', hits: 320000 })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: '2024' });

  assert.deepEqual(records.map((r) => r.id), ['film']);
});

// --- RUTUBE-NORMALIZER-FIX-002: год из описания по явному маркеру «Год: NNNN» (READ-ONLY-анализ → IMPL).
// Причина FP (docs/rutube-normalizer-fix-002-report.md): у сиквелов год лежит в description
// («Матрица: Воскрешение» — «Год: 2021»), титл-правило штрафовало только год в названии,
// и сиквел проходил без штрафа (s=6). Штраф −3 за НЕСОВПАДАЮЩИЙ маркерный год в описании.

test('RutubeProvider.search: сиквел с «Год:» в description не вытесняет точную копию', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Матрица 1999': [
        base({ id: 'sq', title: 'Матрица: Воскрешение', duration: 9000, hits: 50000, description: 'Год: 2021. Продолжение культового фильма.' }),
        base({ id: 'exact', title: 'Матрица (фильм, 1999)' })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  // Сиквел 6−3 (desc-маркер 2021≠1999)=3 < MIN_SCORE; точная копия s=7 — первая.
  const records = await provider.search({ title: 'Матрица', year: '1999' });
  assert.deepEqual(records.map((r) => r.id), ['exact']);
});

test('RutubeProvider.search: год в description БЕЗ маркера «Год:» не штрафуется', async () => {
  // Живой кейс: «Интерстеллар (2014)» несёт 1976 в desc, «Зелёная Миля» — 1960/2003.
  // Это случайные 4-значные числа без слова «год» ПЕРЕД числом — штрафа нет, копия лучшая.
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Зеленая миля 1999': [
        base({ id: 'full', title: 'Зелёная Миля', duration: 6460, description: 'Фильм о тюрьме. 1960–2003 годы на экране.' })
      ]
    }
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Зеленая миля', original_title: 'The Green Mile', year: '1999' });
  assert.deepEqual(records.map((r) => r.id), ['full']);
});

test('RutubeProvider.search: сиквел с «Год:» в description и без точной копии — пусто (не проходит MIN_SCORE)', async () => {
  // Живой кейс FIX-002: полной записи «Матрица» (1999) в индексе Rutube НЕТ;
  // единственный «фильм»-кандидат — «Матрица: Воскрешение» с «Год: 2021» в описании.
  // До фикса: s=6 (startsWith+cat4+dur+hits) → скопленный лучший кандидат.
  // После: 6−3=3 < MIN_SCORE=4 → пусто; в реальности пустой native → twin fallback.
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Матрица 1999': [base({ id: 'sq', title: 'Матрица: Воскрешение', duration: 9000, hits: 50000, description: 'Год: 2021. Продолжение истории Нео.' })]
    }
  });
  const provider = new RutubeProvider({ client });

  assert.deepEqual(await provider.search({ title: 'Матрица', year: '1999' }), []);
});

test('RutubeProvider.search: desc-маркер с СОВПАДАЮЩИМ годом не штрафуется', async () => {
  const client = new FakeRutubeClient({
    searchByQuery: {
      'Аватар 2009': [base({ id: 'av', title: 'Аватар (полная версия)', duration: 16200, description: 'Год: 2009. Джеймс Кэмерон.' })]
    }
  });
  const provider = new RutubeProvider({ client });

  // Маркер 2009 = запрошенный 2009 → штрафа нет, копия проходит.
  const records = await provider.search({ title: 'Аватар', original_title: 'Avatar', year: '2009' });
  assert.deepEqual(records.map((r) => r.id), ['av']);
});