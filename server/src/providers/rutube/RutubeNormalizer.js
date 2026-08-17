import { searchNameTo } from '../shared/normalize/searchNameTo.js';

// Слова-исключения из выдачи поиска (перенос RutubeMovie.Index из Lampac).
// НЕ расширяются как основной механизм: reaction/review/stream-контент
// гасится скорингом (TITLE_NOISE/DESC_NOISE), а не списком слов.
const EXCLUDE_WORDS = ['трейлер', 'trailer', 'премьера', 'обзор', 'сезон', 'сериал', 'серия', 'серий'];

// Категории, под которыми реально встречаются полные фильмы (проверено живьём):
// 4=Фильмы, 13=Разное, 64=Культура, 73=Лайфстайл.
const CATEGORY_FILM = new Set([4, 13, 64, 73]);
// Заведомо шумовые категории: музыка/новости/игры/аниме/аудиокниги/развлечения/…
const CATEGORY_NOISE = new Set([6, 7, 8, 11, 17, 19, 22, 35, 41, 43, 48, 50, 52, 54, 55, 57, 58, 60, 71]);

// Маркеры reaction/review/stream-контента в НОРМАЛИЗОВАННОМ названии
// («Реакция на фильм Матрица», «смотрим вместе», «… Full Movie Review», ambient).
// Группы (по живой выдаче 2026-08-16, docs/rutube-normalizer-fix-001-report.md):
//   реакционные/обзорные шоу, музыка/саундтреки/петли, дубляжи/не-оригинал,
//   авторские наложения лекторов-инфоцарей. Это маркеры СЕТЕЙ/жанров, а не
//   конкретных фильмов; EXCLUDE_WORDS не расширяются как основной механизм.
const TITLE_NOISE = [
  'реакци', 'смотрим', 'стрим', 'разбор', 'киноклуб', 'посмотрел', 'реакциянафильм',
  'reaction', 'review', 'watchalong', 'recap', 'explained',
  'soundtrack', 'soundscape', 'ambient', 'саундтрек', 'ost', 'loop',
  'dubbed', 'hindi', 'дубляж',
  'гаряев', 'меняйлов',
  'досмотрели', 'подкаст', 'офильме', 'профильм', 'чилим', 'обсужда'
];

// Реакшн/монетизация в описании — слабый штраф (−2), не гейт.
// Аудит 2026-08-16: реакционные каналы заливают и ПОЛНЫЕ копии фильмов
// («Интерстеллар (2014)» 10169с — desc «ПОЛНАЯ РЕАКЦИЯ НА ФИЛЬМ…boosty»,
// «Зелёная Миля» 6460с — boosty в desc). Длинный title + категория-фильм
// надёжнее рекламы из описания: −4 топило реальные копии (7−4<4). −2=тай-брейк.
const DESC_NOISE = [
  'реакция на фильм', 'boosty', 'donationalerts', 'donate', 'patreon', 'патреон',
  'заказать реакцию', 'twitch', 'paypal'
];

// Проходной балл «похоже на полнометражный фильм» (см. отчёт, калибровка по живому API).
const MIN_SCORE = 4;
// «Сильная» запись — уверенное попадание (точное/начинающееся совпадение + категория
// + длительность). Если в yearful-выдаче нет НИ ОДНОЙ сильной записи, провайдер
// пробует yearless-запрос: полная копия часто лежит под названием БЕЗ года
// («Зелёная Миля» 6460с — по «Зеленая миля», не «Зеленая миля 1999»).
const STRONG_SCORE = 5;
// Сколько лучших кандидатов отдать провайдеру (дальше фильтрует playOptions).
const TOP_N = 3;

/**
 * Чистый слой: сырые результаты Rutube-поиска → записи провайдера.
 *
 * Scored ranking вместо «первой прошедшей» (Lampac-порт):
 *  +3 точное равенство ключу; +1 название начинается с ключа; +1 ТОЧНЫЙ год из
 *  титла (−3 штраф, когда в титле есть ДРУГОЙ год); +2 категория-фильм / −2 шумовая;
 *  +2 длительность ≥ 5400с / +1 между 3000 и 5400с; +1 за hits ≥ 200;
 *  −3 маркеры reaction/review/stream в титле; −2 маркеры монетизации/реакции
 *  в описании (тай-брейк: реакционные каналы заливают и полные копии — см. ниже).
 *
 * Жёсткие safety-фильтры сохранены: is_hidden/is_deleted/is_adult/is_locked/
 * is_audio/is_paid/is_livestream, EXCLUDE_WORDS, duration > 3000.
 */
export class RutubeNormalizer {
  static STRONG_SCORE = STRONG_SCORE;
  constructor({ searchKeys = [], searchTitle = '', year = 0 } = {}) {
    this.keys = normalizeKeys(searchTitle || searchKeys);
    this.year = Number(year) || 0;
  }

  with({ searchKeys = [], searchTitle = '', year = 0 } = {}) {
    this.keys = normalizeKeys(searchTitle || searchKeys);
    this.year = Number(year) || 0;
    return this;
  }

  searchResults(results = []) {
    return this.rankedCandidates(results).slice(0, TOP_N).map(({ _score, ...record }) => record);
  }

  /**
   * Максимальный балл среди кандидатов (или 0, если ни один не прошёл MIN_SCORE).
   * Используется провайдером для решения о yearless-фолбэке.
   */
  bestScore(results = []) {
    const keys = this.keys;
    if (!keys.length) return 0;
    let best = 0;
    for (const movie of results) {
      if (!movie || typeof movie !== 'object') continue;
      const entry = this.score(movie, keys);
      if (entry && entry.score > best) best = entry.score;
    }
    return best;
  }

  rankedCandidates(results = []) {
    const keys = this.keys;
    if (!keys.length) return [];

    const candidates = [];
    for (const movie of results) {
      if (!movie || typeof movie !== 'object') continue;
      const entry = this.score(movie, keys);
      if (!entry || entry.score < MIN_SCORE) continue;
      candidates.push({ ...entry.record, _score: entry.score });
    }

    // Ранг: балл → длительность (полные копии длиннее реакций) → стабильный порядок.
    candidates.sort((a, b) => (b._score - a._score) || (b.duration - a.duration) || String(a.id).localeCompare(String(b.id)));
    return candidates;
  }

  score(movie, keys) {
    const name = searchNameTo(movie.title);
    if (!name) return null;

    // Жёсткие safety-фильтры (только те, что были; is_adult обязателен).
    if (movie.is_hidden || movie.is_deleted || movie.is_adult || movie.is_locked || movie.is_audio || movie.is_paid || movie.is_livestream) return null;
    if (EXCLUDE_WORDS.some((word) => name.includes(word))) return null;
    const duration = Number(movie.duration) || 0;
    if (!(duration > 3000)) return null;

    // Название должно содержать хотя бы один из поисковых ключей (рус./ориг.).
    if (!keys.some((key) => name.includes(key))) return null;

    let score = 0;

    // Точное равенство ключу — сильнейший признак полной копии; иначе — название
    // начинается с ключа («Doom: Аннигиляция» не получает бонус лидера).
    if (keys.some((key) => name === key)) score += 3;
    else if (keys.some((key) => name.startsWith(key))) score += 1;

    // Год — только из самого названия (в полях DTO года нет). Бонус за ТОЧНЫЙ год
    // в титле; наличие в титле ДРУГОГО года — сильный штраф: «Doom: Аннигиляция
    // (2019)» у запроса 2018 и сиквелы тонут, реальные копии с соседним годом
    // всё равно проходят по категории/длительности/лидерству.
    const year = this.year;
    if (year > 0) {
      const yearsInName = collectYears(name);
      const hasRequestedYear = yearsInName.includes(year);
      if (hasRequestedYear) score += 1;
      else if (yearsInName.length) score -= 3;

      // FIX-002: год из описания — ТОЛЬКО через явный маркер «Год: NNNN»/«год NNNN».
      // У сиквелов год лежит в description («Матрица: Воскрешение» — «Год: 2021»),
      // поэтому титл-правило выше не видит чужой год и сиквел проходил без штрафа.
      // Если маркер несёт год ≠ запрошенному — тот же штраф −3; совпал — штрафа нет.
      // Случайные 4-значные числа БЕЗ слова «год» перед ними не учитываются (иначе
      // тонули бы «Интерстеллар (2014)» с 1976 и «Зелёная Миля» с 1960/2003 в desc).
      // Титл-год в приоритете: если запрошенный год уже в названии (exact title/year),
      // противоречивый маркер описания не оспаривает его.
      if (!hasRequestedYear) {
        const descYear = collectDescYear(movie.description);
        if (descYear && descYear !== year) score -= 3;
      }
    }

    const category = Number(movie.category?.id);
    if (CATEGORY_FILM.has(category)) score += 2;
    else if (CATEGORY_NOISE.has(category)) score -= 2;

    if (duration >= 5400) score += 2; // ≥ 90 минут — полнометраж
    else if (duration > 3000) score += 1;

    const hits = Number(movie.hits) || 0;
    if (hits >= 200) score += 1;

    if (TITLE_NOISE.some((marker) => name.includes(marker))) score -= 3;

    const description = String(movie.description || '').toLowerCase();
    if (DESC_NOISE.some((marker) => description.includes(marker))) score -= 2;

    return { score, record: this.normalizeSearchItem(movie) };
  }

  normalizeSearchItem(movie = {}) {
    return {
      provider: 'rutubemovie',
      id: String(movie.id || ''),
      title: movie.title || null,
      original_title: null,
      year: this.year,
      poster: movie.thumbnail_url || movie.thumbnailUrl || null,
      duration: Number(movie.duration) || 0,
      type: 'movie'
    };
  }
}

function normalizeKeys(value) {
  if (typeof value === 'string') value = [value];
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const key of value) {
    const normalized = searchNameTo(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function collectYears(name) {
  const years = [];
  const re = /(?:1[89]\d\d|20\d\d)/g;
  let match;
  while ((match = re.exec(name))) years.push(Number(match[0]));
  return years;
}

/**
 * Год из ЯВНОГО маркера «Год: NNNN» / «год NNNN» / «Год выпуска: NNNN» в описании.
 * Случайные 4-значные числа без слова «год» ПЕРЕД ними («…1960 годы…», «в 2003
 * году…») не распознаются — иначе тонули бы полные копии с упоминаниями лет в
 * описании: «Интерстеллар (2014)» 1976, «Зелёная Миля» 1960/2003. (FIX-002)
 */
function collectDescYear(description) {
  // «год» отдельным словом, затем хвост (« выпуска »), разделитель и 4-значный год.
  // \s* внутри пропускает пробелы между «год» и хвостом («Год выпуска: 2009»).
  // Никакого \b перед кириллицей (JS \b знает только ASCII): lookahead (?![а-яё])
  // отсекает «годовщину/году/годный» (там слово или год ПЕРЕД числом).
  const match = /год(?![а-яё])\s*[а-яё]{0,15}\s*[:–—-]?\s*(1[89]\d\d|20\d\d)/i.exec(String(description || ''));
  return match ? Number(match[1]) : null;
}