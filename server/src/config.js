import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..');
const rootDir = path.join(serverDir, '..');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const rows = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(rootDir, '.env'));
loadDotEnv(path.join(serverDir, '.env'));

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function list(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function resolvePath(value) {
  if (!value) return '';
  if (/^file:\/\//i.test(value)) return fileURLToPath(value);
  if (/^\/[A-Za-z]:\//.test(value)) return value.replace(/^\/([A-Za-z]:)/, '$1');
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '0.0.0.0',
  port: integer('PORT', 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://plugin.maniya-kvn.online',
  corsOrigins: list('CORS_ORIGINS', ['https://plugin.maniya-kvn.online']),
  rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: integer('RATE_LIMIT_MAX', 120),
  tokenMinLength: integer('TOKEN_MIN_LENGTH', 8),
  // Секрет для скрытого ключа плагина (PLUGIN-INSTALL-002): реальный JS отдаётся
  // только по пути `/x/<install>_<key>.js`, где key = HMAC-SHA256(PLUGIN_CODE_SECRET,
  // 'plugin-code:'+install). Без секрета /p/ недоступен (fail-closed, 503) —
  // полный JS по /p/ НЕ отдаётся.
  pluginCodeSecret: (process.env.PLUGIN_CODE_SECRET || '').trim(),
  usersFile: resolvePath(process.env.USERS_FILE || ''),
  videosFile: resolvePath(process.env.VIDEOS_FILE || ''),
  publicDir: resolvePath(process.env.PUBLIC_DIR || path.join(rootDir, 'public')),
  shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10_000),
  // Telegram-бот авто-выдачи подписок (триал + ручная выдача админом).
  telegram: {
    enabled: bool('TELEGRAM_ENABLED', false),
    // Токен бота от @BotFather. Без него polling не стартует (enabled остаётся true,
    // но клиент молчит, как Lamac при пустом bot_token).
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    apiBase: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
    pollTimeoutSeconds: integer('TELEGRAM_POLL_TIMEOUT', 60),
    trialDays: integer('TELEGRAM_TRIAL_DAYS', 3),
    // План триал-подписки, выдаваемой по /start.
    trialPlan: (process.env.TELEGRAM_TRIAL_PLAN || 'trial').trim(),
    // Chat-id админов (разрешена ручная выдача / продление). Пусто → команд нет.
    admins: list('TELEGRAM_ADMINS', []),
    // Ссылка плагина. Подстановки: {token} (полный), {short} (суффикс токена),
    // {prefix} (linkPrefix). Короткая форма: /{prefix}_{short}.js (проще вводить).
    pluginUrlTemplate: (process.env.TELEGRAM_PLUGIN_URL || '').trim(),
    // Префикс короткой ссылки /<prefix>_<short>.js (бренд/ник, напр. dorofeev200).
    linkPrefix: (process.env.TELEGRAM_LINK_PREFIX || 'dorofeev200').trim(),
    // Баннер в шапке сообщений (бренд). По умолчанию — Maniya Online.
    bannerText: (process.env.TELEGRAM_BANNER || '').trim(),
    // URL/контакт админа для inline-кнопки «Связь с админом». Пусто → кнопки нет.
    adminContact: (process.env.TELEGRAM_ADMIN_CONTACT || '').trim(),
    // Реквизиты для оплаты (кнопка «💳 Оплатить»). Пусто → секции оплаты нет.
    paymentDetails: (process.env.TELEGRAM_PAYMENT_DETAILS || '').trim(),
    maxTrialChats: integer('TELEGRAM_MAX_TRIAL_CHATS', 0)
  },
  filmix: {
    enabled: bool('FILMIX_ENABLED', true),
    pro: bool('FILMIX_PRO', false),
    hls: bool('FILMIX_HLS', false),
    host: (process.env.FILMIX_HOST || 'https://filmix.my').replace(/\/+$/, ''),
    tvHost: (process.env.FILMIX_TV_HOST || 'https://api.filmix.tv').replace(/\/+$/, ''),
    token: (process.env.FILMIX_TOKEN || '').trim(),
    // FilmixTV-учётка для api.filmix.tv (auth-флоу как Lampac FilmixTV:
    // request-token → auth → Bearer). Без неё video-links беззащитен перед
    // Cloudflare; с ней — прямой доступ к CDN-ссылкам через api-fx.
    tvUser: (process.env.FILMIX_TV_USER || '').trim(),
    tvPassword: (process.env.FILMIX_TV_PASSWORD || '').trim()
  },
  rezka: {
    enabled: bool('REZKA_ENABLED', true),
    baseUrl: (process.env.REZKA_BASE_URL || 'https://rezka.ag').replace(/\/+$/, ''),
    login: (process.env.REZKA_LOGIN || '').trim(),
    password: process.env.REZKA_PASSWORD || '',
    premium: bool('REZKA_PREMIUM', false),
    hls: bool('REZKA_HLS', false),
    // CDN-хосты Rezka по умолчанию (суффиксное сопоставление в proxy:
    // "voidboost.one" покрывает stream.voidboost.one и т.д.). Расширяется
    // REZKA_ALLOW_HOSTS, если Rezka сменит CDN.
    allowHosts: list('REZKA_ALLOW_HOSTS', ['voidboost.one', 'voidboost.com', 'hdrezka.me'])
  },
  kodik: {
    enabled: bool('KODIK_ENABLED', true),
    apiHost: (process.env.KODIK_API_HOST || 'https://kodik-api.com').replace(/\/+$/, ''),
    linkHost: (process.env.KODIK_LINK_HOST || 'https://kodikres.com').replace(/\/+$/, ''),
    playerHost: (process.env.KODIK_PLAYER_HOST || 'https://kodikplayer.com').replace(/\/+$/, ''),
    // Публичный токен Kodik-info (https://kodik.info/developer/). Без него
    // провайдер скрыт (enabled() = false). Приватный secret_token включает
    // прямой маршрут /api/video-links (HMAC) вместо парсинга плеера.
    token: (process.env.KODIK_TOKEN || '').trim(),
    secretToken: (process.env.KODIK_SECRET_TOKEN || '').trim()
  },
  alloha: {
    enabled: bool('ALLOHA_ENABLED', true),
    // API-хост (поиск/детали). По умолчанию — как в Lampac ModInit.
    apiHost: (process.env.ALLOHA_API_HOST || 'https://apbugall.org/v2').replace(/\/+$/, ''),
    // Linkhost для /direct (стримы) — отдельный хост, на api-хосте /direct 404.
    linkHost: (process.env.ALLOHA_LINK_HOST || 'https://torso-as.stloadi.live').replace(/\/+$/, ''),
    // Bearer-токен для API поиска/деталей (обязателен → TOKEN_REQUIRED без него).
    token: (process.env.ALLOHA_TOKEN || '').trim(),
    // Секретный ключ для /direct. Если не задан — берётся тот же token.
    secretToken: (process.env.ALLOHA_SECRET_TOKEN || '').trim()
  },
  rutubemovie: {
    enabled: bool('RUTUBEMOVIE_ENABLED', true),
    // Без токена — открытый Rutube-поиск фильмов.
    host: (process.env.RUTUBE_HOST || 'https://rutube.ru').replace(/\/+$/, '')
  },
  cdnvideohub: {
    enabled: bool('CDNVIDEOHUB_ENABLED', true),
    // Плеерное API (host по умолчанию — как Lampac ModInit).
    host: (process.env.CDNVIDEOHUB_HOST || 'https://plapi.cdnvideohub.com').replace(/\/+$/, '')
  },
  // Collaps — HTML+JSON (как Lampac OnlineRUS/Collaps).
  collaps: {
    enabled: bool('COLLAPS_ENABLED', true),
    apihost: (process.env.COLLAPS_API_HOST || 'https://api.bhcesh.me').replace(/\/+$/, ''),
    embedHost: (process.env.COLLAPS_EMBED_HOST || 'https://api.ortified.ws').replace(/\/+$/, ''),
    // Публичный токен зашит в Lampac = поведенческий реф, но по соглашению
    // выносим в config. Задать COLLAPS_TOKEN (иначе enabled()=false).
    token: (process.env.COLLAPS_TOKEN || '').trim()
  },
  // HDVB — JSON API + POST playlist с csrf (как Lampac OnlineRUS/HDVB).
  hdvb: {
    enabled: bool('HDVB_ENABLED', true),
    apihost: (process.env.HDVB_API_HOST || 'https://apivb.com').replace(/\/+$/, ''),
    // Stream/frame-хост (init.host Lampac). Нода отвечает на /movie|/serial/{token}/iframe
    // только с referer movielab.one (расшифровка `encrypt:kwwsv=22prylhode1rqh2`).
    frameHost: (process.env.HDVB_FRAME_HOST || 'https://vid1733431681.entouaedon.com').replace(/\/+$/, ''),
    referer: (process.env.HDVB_REFERER || 'https://movielab.one').replace(/\/+$/, '') + '/',
    // Публичный токен зашит в Lampac = поведенческий реф, но по соглашению
    // выносим в config. Задать HDVB_TOKEN (иначе enabled()=false).
    token: (process.env.HDVB_TOKEN || '').trim()
  },
  // E-Online (источники-бренда «Maniya»): каждый балансер — отдельный источник.
  // Авторизация — account_email + uid в URL каждого запроса (E-ONLINE-REPORT §9);
  // на потоки skaz/voidboost обязателен Origin. Секреты только из env, не в гит.
  eonline: {
    enabled: bool('EO_ENABLED', true),
    // Хосты балансеров (ротация при недоступности). СЕССИЯ 12: 94.249.* стали
    // отдавать 503/302, а online3/8.skaz.tv живы напрямую (проoved live: cors/check
    // 200, lite/* 200 с cards). Поэтому первыми идут рабочее skaz.tv, IP — резерв.
    hosts: list('EO_HOSTS', ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109']),
    // skaz-кластер — карточки сериалов ссылаются на него (тот же пул).
    skazHosts: list('EO_SKAZ_HOSTS', ['http://online3.skaz.tv', 'http://online8.skaz.tv']),
    // Балансеры (каждый = источник «Maniya · <source>»). Дефолт — только live-зелёные
    // (многотайтловая матрица test/eolive.test.js 2026-08-08 + AUDIT 09.08, §10.3):
    // veoveo/alloha/filmix/rezka/kinoflix/pidtor — 200 PLAY/CALL на skaz-хостах;
    // kinopub — 200, карточки-ссылки (Lime, двухшаговая follow-схема postid);
    // videoseed/solntse — 3/3 по матрице 08.08.
    // BALANCER-002 (2026-08-13): добавлен rhsprem (live probe: data-json=true на
    // online3, REST-играемый); исключены zagonka/videocdn/lumex/kinobase — их НЕТ в
    // live-универсуме lite/events, светились мёртвыми. rch/WS-источники — зарезервированы
    // (§10.5): vk RUS-1, rutube RUS-2, videohub, turboserial, fanserials, fancdn, mirage,
    // а также ashdi/kinoukr/eneyida (BALANCER-002: `{"rch":true}` — WebSocket-only, Maniya
    // REST-клиент играть их не может) — в дефолт НЕ входят.
    // ПОСЛЕ отчёта (2026-08-13, решение юзера): remux/kinotochka тоже rch-reserved
    // (`{"rch":true}` стабильно на каждой карточке; REST-клиент их не воспроизводит —
    // OLD videos()=0, на Play «видео не найдено»). Из видимого списка убраны.
    // Видимые источники «Maniya · …» + СКРЫТЫЕ фоллбэки native-дублей
    // (filmix/rezka/hdvb/rutubemovie регистрируются, но в UI их отдаёт native;
    // eonline-близнец выигрывает где native вернул 0 items).
    balancers: list('EO_BALANCERS', ['alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse', 'filmix', 'rezka', 'hdvb', 'rutubemovie', 'vkmovie', 'kodik', 'geosaitebi', 'rhsprem']),
    // Аккаунт E-Online. Не коммитить — только server/.env.
    accountEmail: (process.env.EO_ACCOUNT_EMAIL || '').trim(),
    uid: (process.env.EO_UID || '').trim(),
    // Обязательный Origin для потоков skaz/voidboost.
    origin: (process.env.EO_ORIGIN || 'http://lampa.mx').trim()
  },
  // skaz-кластер (Lampac-протокол): та же логика, что E-Online, но НЕ зависит
  // от E-Online-плагина (docs/skaz-architecture.md §0-§6). Ключи SKAZ_* —
  // primary, старый EO_* — фолбэк: VPS server/.env отдаёт EO_* и продолжает
  // работать без изменений.
  skaz: {
    enabled: bool('SKAZ_ENABLED', true),
    hosts: list('SKAZ_HOSTS', list('EO_HOSTS', ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'])),
    balancers: list('SKAZ_BALANCERS', list('EO_BALANCERS', ['alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse', 'filmix', 'rezka', 'hdvb', 'rutubemovie', 'vkmovie', 'kodik', 'geosaitebi', 'rhsprem'])),
    // BALANCER-002: per-card availability (/api/lampa/sources/card).
    // checkEnabled=false → эндпоинт возвращает статический список (все show:true),
    // без походов в кластер (rollback-переключатель, менять без деплоя нельзя).
    checkEnabled: bool('SKAZ_CHECK_ENABLED', true),
    // Таймаут одного хоста при checksearch (на один балансер × хостов ≤ дедлайн).
    // 10с = паритет с E-Online (OnlineApi.cs checkSearch timeoutSeconds: 10):
    // при 8с под 18-ю параллельными запросами кластер не успевал ответить для
    // части балансеров → таймаут трактовался как «нет источника» (ложный скрыт —
    // провал OLD∩NEW гейта в live-сверке, kinopub/27190).
    checkTimeoutMs: integer('SKAZ_CHECK_TIMEOUT_MS', 10_000),
    // Аккаунт skaz-кластера (вход через Lampa «Настройки — Синхронизация»,
    // §6.5—6.7 отчёта). Не коммитить — только server/.env.
    accountEmail: (process.env.SKAZ_ACCOUNT_EMAIL || process.env.EO_ACCOUNT_EMAIL || '').trim(),
    uid: (process.env.SKAZ_UID || process.env.EO_UID || '').trim(),
    // Обязательный Origin для потоков skaz/voidboost.
    origin: (process.env.SKAZ_ORIGIN || process.env.EO_ORIGIN || 'http://lampa.mx').trim()
  },
  proxy: {
    allowHosts: list('PROXY_ALLOW_HOSTS', ['filmix.my', 'filmix.gg', 'filmix.tv', 'filmix.pub', 'filmix.fm', 'filmix.ac', 'werkecdn.me', 'cdnsqu.com', 'kodikres.com', 'solodcdn.com', 'stloadi.live', 'rutube.ru', 'rtbcdn.ru', 'vkuser.net', 'okcdn.ru', 'interkh.com', 'sevstar933krop.com', 'entouaedon.com', 'vkvideo.cloud', 'cdntogo.net', 'rstprgapipt.com', 'mvapspdmpg.com']),
    // E-Online-хосты и CDN-манифест voidboost — http:// (validateProxyTarget по
    // умолчанию разрешает http только для loopback). Явный узкий список.
    httpAllowHosts: list('PROXY_HTTP_ALLOW_HOSTS', ['94.249.239.63', '94.249.239.37', '94.249.239.11', '77.90.33.109', 'skaz.tv', 'voidboost.one', 'voidboost.com', 'scts.tv']),
    timeoutMs: integer('PROXY_TIMEOUT_MS', 15_000),
    maxRedirects: integer('PROXY_MAX_REDIRECTS', 4)
  }
};

// CDN-хосты Rezka разрешаем в прокси (дедуп по регистру). Живой CDN-хост
// (из ответа get_movie/get_stream) добавляется сюда на live-валидации.
{
  const extra = [...config.rezka.allowHosts, 'rezka.ag'];
  const merged = [...config.proxy.allowHosts];
  for (const host of extra) {
    const key = String(host).toLowerCase();
    if (!merged.some((entry) => String(entry).toLowerCase() === key)) merged.push(host);
  }
  config.proxy.allowHosts = merged;
}

export function isProduction() {
  return config.env === 'production';
}
