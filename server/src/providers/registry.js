import { config } from '../config.js';
import { AllohaProvider } from './alloha/AllohaProvider.js';
import { CDNvideohubProvider } from './cdnvideohub/CDNvideohubProvider.js';
import { FilmixProvider } from './filmix/FilmixProvider.js';
import { KodikProvider } from './kodik/KodikProvider.js';
import { RezkaProvider } from './rezka/RezkaProvider.js';
import { RutubeProvider } from './rutube/RutubeProvider.js';
import { CollapsProvider } from './collaps/CollapsProvider.js';
import { HDVBProvider } from './hdvb/HDVBProvider.js';
import { SkazProvider } from './skaz/SkazProvider.js';

// Названия балансеров E-Online под брендом «Maniya» (для источников).
// Полная карта из исходного JS (`_0x39b522`, AUDIT 2026-08-09, E-ONLINE-REPORT §10.1):
// kinobase/veoveo/alloha/filmix/videoseed/videohub/turboserial/vk/rutube/zagonka/
// kinopub/hdvb/fancdn/mirage/kodik/fanserials/rezka/mirkino/xvideocdn/hdrezka/aniliberty/…
// Здесь — только slug, использованные в EO_BALANCERS (конфиг); имена-нарисованные
// для источников, не отдающихся по lite-REST (vk RUS-1, rutube RUS-2, fans-сериалы …)
// заведены в конфиге как зарезервированные (см. §10.5) и пока не светятся.
const EO_TITLES = {
  filmix: 'Maniya · Filmix',
  filmixtv: 'Maniya · FilmixTV',
  rezka: 'Maniya · Rezka',
  videoseed: 'Maniya · VideoSeed',
  hdvb: 'Maniya · HDVB',
  veoveo: 'Maniya · VeoVeo',
  kinopub: 'Maniya · Lime',
  kinoflix: 'Maniya · KinoFlix',
  alloha: 'Maniya · Alloha',
  pidtor: 'Maniya · PidTor',
  kinoteatrkg: 'Maniya · KinoteatrKG',
  solntse: 'Maniya · Solntse',
  rutubemovie: 'Maniya · RutubeMovie',
  vkmovie: 'Maniya · VKMovie',
  geosaitebi: 'Maniya · GeoVideo',
  aniliberty: 'Maniya · AniLiberty'
};

const nativeProviders = [
  new FilmixProvider({ token: config.filmix.token }),
  new KodikProvider({
    enabled: config.kodik.enabled,
    apiHost: config.kodik.apiHost,
    linkHost: config.kodik.linkHost,
    playerHost: config.kodik.playerHost,
    token: config.kodik.token,
    secretToken: config.kodik.secretToken
  }),
  new RezkaProvider({
    enabled: config.rezka.enabled,
    baseUrl: config.rezka.baseUrl,
    login: config.rezka.login,
    password: config.rezka.password,
    premium: config.rezka.premium,
    hls: config.rezka.hls
  }),
  new AllohaProvider({
    enabled: config.alloha.enabled,
    apiHost: config.alloha.apiHost,
    linkHost: config.alloha.linkHost,
    token: config.alloha.token,
    secretToken: config.alloha.secretToken
  }),
  new RutubeProvider({
    enabled: config.rutubemovie.enabled,
    host: config.rutubemovie.host
  }),
  new CDNvideohubProvider({
    enabled: config.cdnvideohub.enabled,
    host: config.cdnvideohub.host
  }),
  new CollapsProvider({
    enabled: config.collaps.enabled,
    apihost: config.collaps.apihost,
    embedHost: config.collaps.embedHost,
    token: config.collaps.token
  }),
  new HDVBProvider({
    enabled: config.hdvb.enabled,
    apihost: config.hdvb.apihost,
    frameHost: config.hdvb.frameHost,
    referer: config.hdvb.referer,
    token: config.hdvb.token
  })
];

// Skaz-кластер: каждый REST-доступный балансер = отдельный источник «Maniya · …».
// Без SKAZ_ACCOUNT_EMAIL/SKAZ_UID (или их EO_* алиасов) провайдеры скрыты
// (enabled()=false) и не светятся в /api/lampa/sources.
// ❗ Балансер, у которого уже есть ВКЛЮЧЁННЫЙ native-провайдер с тем же id
// (filmix/rezka/hdvb/rutubemovie/kodik/…), не становится видимым источником —
// в UI его отдаёт native («такой источник должен быть один»), а skaz-близнец
// регистрируется как СКРЫТЫЙ фоллбэк (`twinFor`): если native вернёт 0 items
// или битые стримы, store.js прозрачно отдаст его результат. Видимым skaz-балансер
// становится только когда native выключен (нет токена/ключа).
// E-Online (EoProvider/EoClient) оставлен в дереве для live-сравнения,
// см. scripts/e2e-skaz-vs-eo.mjs (доказано: клиенты байт-в-байт идентичны).
function buildSkazProviders() {
  return (config.skaz.balancers || []).map((balancer) => {
    const nativeTwin = nativeProviders.find((p) => p.id === balancer);
    const hidden = Boolean(nativeTwin?.enabled?.());
    return new SkazProvider({
      id: `skaz-${balancer}`,
      title: EO_TITLES[balancer] || `Maniya · ${capitalize(balancer)}`,
      balancer,
      hosts: config.skaz.hosts,
      accountEmail: config.skaz.accountEmail,
      uid: config.skaz.uid,
      origin: config.skaz.origin,
      show: !hidden,
      hiddenTwinNative: hidden ? balancer : null
    });
  });
}

const allSkazProviders = buildSkazProviders();
const skazProviders = allSkazProviders.filter((provider) => provider.show);
const providers = [...nativeProviders, ...skazProviders];
// ВСЕ провайдеры, включая скрытые skaz-близнецы native-источников: они производят
// `method:"call"` items (twin-first в store.js) и ОБЯЗАНЫ резолвиться через
// `/api/lampa/video`, даже если не светятся в /sources (иначе Play → 404).
const allProviderInstances = [...nativeProviders, ...allSkazProviders];

/** Скрытый skaz-близнец native-провайдера (id совпадает) или null. */
export function twinFor(nativeId) {
  const id = String(nativeId || '').trim().toLowerCase();
  return allSkazProviders.find((provider) => provider.hiddenTwinNative === id) || null;
}

export function registeredProviders() {
  return providers;
}

/** Все провайдеры, включая скрытые skaz-близнецы (для ленивого резолва call items). */
export function allProviders() {
  return allProviderInstances;
}

export function providerById(id) {
  return providers.find((provider) => provider.id === id) || null;
}

function capitalize(text) {
  const s = String(text || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}