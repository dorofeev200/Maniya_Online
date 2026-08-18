import crypto from 'node:crypto';
import { HttpError } from '../../errors.js';

const DEFAULT_API_HOST = 'https://kodik-api.com';
const DEFAULT_LINK_HOST = 'https://kodikres.com';
const DEFAULT_PLAYER_HOST = 'https://kodikplayer.com';

export class KodikClient {
  constructor(options = {}) {
    this.apiHost = trimSlash(options.apiHost || process.env.KODIK_API_HOST || DEFAULT_API_HOST);
    this.linkHost = trimSlash(options.linkHost || process.env.KODIK_LINK_HOST || DEFAULT_LINK_HOST);
    this.playerHost = trimSlash(options.playerHost || process.env.KODIK_PLAYER_HOST || DEFAULT_PLAYER_HOST);
    this.token = options.token || process.env.KODIK_TOKEN || '';
    this.secretToken = options.secretToken || process.env.KODIK_SECRET_TOKEN || '';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return Boolean(this.token);
  }

  /**
   * Поиск по внешним id — аналог KodikInvoke.Embed(imdb_id, kinopoisk_id, s).
   * Отдельный запрос на kinopoisk_id и/или imdb_id, результаты склеиваются
   * и дедуплицируются по id. season добавляется только в id-запрос.
   */
  async searchByIds({ kinopoiskId = 0, imdbId = '', season = 0 } = {}) {
    if (!this.token) throw new HttpError(503, 'kodik_token_required', 'Kodik token is not configured');

    const normalizedKp = Number(kinopoiskId) || 0;
    const normalizedImdb = String(imdbId || '').trim();
    if (!normalizedKp && !normalizedImdb) return [];

    const base = new URL('/search', `${this.apiHost}/`);
    base.searchParams.set('token', this.token);
    base.searchParams.set('limit', '100');
    base.searchParams.set('with_episodes', 'true');
    if (Number(season) > 0) base.searchParams.set('season', String(season));

    const results = [];
    if (normalizedKp) results.push(...await this.searchUrl(this.withParam(base, 'kinopoisk_id', normalizedKp)));
    if (normalizedImdb) results.push(...await this.searchUrl(this.withParam(base, 'imdb_id', normalizedImdb)));

    return dedupeById(results);
  }

  /**
   * Поиск по названию — аналог KodikInvoke.Embed(title, original_title, clarification):
   * title-параметр берёт original_title первым, with_material_data=true для постеров.
   */
  async searchByTitle({ title = '', originalTitle = '' } = {}) {
    if (!this.token) throw new HttpError(503, 'kodik_token_required', 'Kodik token is not configured');

    const query = String(originalTitle || title || '').trim();
    if (!query) return [];

    const url = new URL('/search', `${this.apiHost}/`);
    url.searchParams.set('token', this.token);
    url.searchParams.set('limit', '100');
    url.searchParams.set('title', query);
    url.searchParams.set('with_episodes', 'true');
    url.searchParams.set('with_material_data', 'true');

    return this.searchUrl(url);
  }

  async searchUrl(url) {
    const data = await this.getJson(url);
    return Array.isArray(data?.results) ? data.results : [];
  }

  withParam(url, key, value) {
    const copy = new URL(url);
    copy.searchParams.set(key, String(value));
    return copy;
  }

  async streams(link, { ip = '127.0.0.1' } = {}) {
    if (!link) throw new HttpError(400, 'kodik_link_required', 'Kodik link is required');
    if (this.secretToken) return this.directStreams(link, ip);
    return this.parsePlayer(link);
  }

  async directStreams(link, ip) {
    // d — как в Lampac Controller.cs: AddHours(4).ToString("yyyyMMddHH"),
    // HMAC-сообщение: link:ip:d.
    const deadline = deadlineFormat(new Date(Date.now() + 4 * 3600 * 1000));
    const signature = crypto.createHmac('sha256', this.secretToken).update(`${link}:${ip}:${deadline}`).digest('hex');
    const url = new URL('/api/video-links', `${this.linkHost}/`);
    url.searchParams.set('link', link);
    url.searchParams.set('p', this.token);
    url.searchParams.set('ip', ip);
    url.searchParams.set('d', deadline);
    url.searchParams.set('s', signature);
    url.searchParams.set('auto_proxy', 'true');
    url.searchParams.set('skip_segments', 'true');
    return this.getJson(url);
  }

  async parsePlayer(link) {
    const playerUrl = absoluteUrl(link, this.playerHost);
    const html = await this.getText(playerUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: `${this.playerHost}/`
      }
    });

    // 1) Легаси: inline-{links} JSON (доплеерный формат, до перехода на AMS).
    const payload = extractPlayerPayload(html);
    if (payload) return payload;

    // 2) Легаси: явный video-links/get-video ajax-эндпоинт в HTML.
    const apiLink = extractApiLink(html, playerUrl);
    if (apiLink) {
      return this.getJson(apiLink, {
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          origin: new URL(playerUrl).origin,
          referer: playerUrl,
          'x-requested-with': 'XMLHttpRequest'
        }
      });
    }

    // 3) AMS-плеер (2026+): ссылки получаются POST-запросом к {linkHost}{uri},
    //    где uri — atob-эндпоинт из app.player_*.js, а подпись — это декодированные
    //    var-глобалы страницы (koa_urlParams). Это поведение Lampac VideoParse
    //    (Service.cs), которое включается ровно тогда, когда secret_token пуст
    //    (Controller.cs line 162). Возвращает {links:{q:[{src}]}} с уже расшиф­
    //    рованными src (Lampac shift+18 → URL-base64).
    const ams = await this.amsStreams(html, playerUrl);
    if (ams) return ams;

    throw new HttpError(502, 'kodik_player_parse_failed', 'Unable to parse Kodik player links');
  }

  /**
   * AMS-плеер, поток ссылок без secret_token (аналог Lampac VideoParse):
   * POST {linkHost}{uri} с глобалами страницы (domain/d_sign/pd/pd_sign/ref/ref_sign
   * + vInfo.type/hash/id), ответ — {links:{«240»:[{src}],…}}; src зашифрован сдвигом
   * букв +18 и URL-base64 (если без manifest.m3u8) → реальный m3u8.
   */
  async amsStreams(html, playerUrl) {
    const vars = extractAmsVars(html);
    if (!vars || !vars.hash || !vars.id) return null;

    const jsMatch = html.match(/["'\s](\/?assets\/js\/app\.player_[^"']+\.js)["']/i);
    if (!jsMatch) return null;
    const postUri = await this.playerPostUri(jsMatch[1]);
    if (!postUri) return null;

    const body = new URLSearchParams();
    body.set('d', vars.domain);
    body.set('d_sign', vars.dSign);
    body.set('pd', vars.pd);
    body.set('pd_sign', vars.pdSign);
    body.set('ref', vars.ref);
    body.set('ref_sign', vars.refSign);
    body.set('bad_user', 'false');
    body.set('cdn_is_working', 'true');
    body.set('type', vars.type || 'video');
    body.set('hash', vars.hash);
    body.set('id', vars.id);
    body.set('info', '{}');

    try {
      const response = await this.fetchImpl(`${this.linkHost}${postUri}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          'content-type': 'application/x-www-form-urlencoded',
          origin: this.linkHost,
          referer: playerUrl,
          'x-requested-with': 'XMLHttpRequest'
        },
        body: body.toString()
      });
      if (!response.ok) throw new HttpError(response.status, 'kodik_http_error', `Kodik HTTP ${response.status}`);
      const json = await response.json();
      return decodeAmsLinks(json);
    } catch {
      return null;
    }
  }

  /** POST-эндпоинт from app.player_*.js: `type:"POST",url:atob("…")` → декодированный uri. */
  async playerPostUri(jsPath) {
    if (playerPostUriCache.has(jsPath)) return playerPostUriCache.get(jsPath) || null;

    const js = await this.getText(`${this.linkHost}/${jsPath.replace(/^\/+/, '')}`, {
      headers: { accept: 'application/javascript, */*;q=0.8', referer: `${this.playerHost}/` }
    }).catch(() => '');
    const match = js.match(/type:\s*"POST",\s*url:\s*atob\("([^"]+)"\)/);
    const uri = match ? decodeUrlBase64(match[1]) : '';
    playerPostUriCache.set(jsPath, uri);
    return uri || null;
  }

  async getJson(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    if (!response.ok) throw new HttpError(response.status, 'kodik_http_error', `Kodik HTTP ${response.status}`);
    return response.json();
  }

  async getText(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    if (!response.ok) throw new HttpError(response.status, 'kodik_http_error', `Kodik HTTP ${response.status}`);
    return response.text();
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function deadlineFormat(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}`;
}

function dedupeById(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (!item || item.id == null || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function absoluteUrl(link, base) {
  if (/^https?:\/\//i.test(link)) return link;
  return new URL(link, `${base}/`).toString();
}

function extractPlayerPayload(html) {
  const jsonMatch = html.match(/\{\s*"links"\s*:\s*\{[\s\S]*?\}\s*(?:,\s*"segments"\s*:\s*\[[\s\S]*?\])?\s*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// Кэш POST-эндпоинтов из app.player_*.js (имя js-файла → декодированный uri).
const playerPostUriCache = new Map();

/** AMS-глобалы страницы плеера: var domain/d_sign/pd/pd_sign/ref/ref_sign + vInfo.type/hash/id. */
function extractAmsVars(html) {
  const get = (name) => {
    const match = html.match(new RegExp(`\\bvar\\s+${name}\\s*=\\s*["']([^"']*)["']`));
    return match ? match[1] : '';
  };
  const getVInfo = (name) => {
    const match = html.match(new RegExp(`vInfo\\.${name}\\s*=\\s*['"]([^'"]+)['"]`));
    return match ? match[1] : '';
  };
  const domain = get('domain');
  const dSign = get('d_sign');
  const ref = get('ref');
  const refSign = get('ref_sign');
  const hash = getVInfo('hash');
  const id = getVInfo('id');
  const type = getVInfo('type');
  // pd/pd_sign не всегда присутствуют (аниме-сериалы Lampac слайсит advertDebug→preview-icons);
  // фолбэк — дублировать domain/d_sign (как в наблюдаемом upstream-ответе).
  const pd = get('pd') || domain;
  const pdSign = get('pd_sign') || dSign;
  if (!domain || !dSign || !hash || !id) return null;
  return { domain, dSign, pd, pdSign, ref, refSign, type, hash, id };
}

/** Часть Lampac DecodeUrlBase64: URL-safe base64 → utf8. */
function decodeUrlBase64(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const padding = (4 - (s.length % 4)) % 4;
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding);
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Сдвиг букв +18 с обёрткой по регистру (Lampac VideoParse cipher). */
function shiftLetters(value) {
  return String(value || '').replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const ceiling = code <= 90 ? 90 : 122;
    const shifted = code + 18;
    return String.fromCharCode(shifted <= ceiling ? shifted : shifted - 26);
  });
}

/** src из AMS-ответа: если не manifest.m3u8 — shift+18 → URL-base64 decode. */
function decodeAmsSrc(src) {
  if (!src) return '';
  if (src.includes('manifest.m3u8')) return src;
  return decodeUrlBase64(shiftLetters(src));
}

/** {links:{q:[{src}]}} → расшифрованные src (сохранение формата для normalizer.streams). */
function decodeAmsLinks(json) {
  if (!json || typeof json !== 'object' || !json.links) return json;
  const links = {};
  for (const [quality, variants] of Object.entries(json.links)) {
    const list = Array.isArray(variants) ? variants : [variants];
    links[quality] = list.map((variant) => {
      if (typeof variant === 'string') return decodeAmsSrc(variant);
      const src = variant?.src || variant?.Src || variant?.url || '';
      return src ? { ...variant, Src: decodeAmsSrc(src) } : variant;
    });
  }
  return { ...json, links };
}

function extractApiLink(html, playerUrl) {
  const direct = html.match(/["']([^"']*video-links[^"']*)["']/i)?.[1];
  if (direct) return absoluteUrl(direct.replace(/\\\//g, '/'), playerUrl);

  const ajax = html.match(/["']([^"']*get-video[^"']*)["']/i)?.[1];
  if (ajax) return absoluteUrl(ajax.replace(/\\\//g, '/'), playerUrl);

  return null;
}
