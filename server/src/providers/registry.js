import { config } from '../config.js';
import { AllohaProvider } from './alloha/AllohaProvider.js';
import { CDNvideohubProvider } from './cdnvideohub/CDNvideohubProvider.js';
import { FilmixProvider } from './filmix/FilmixProvider.js';
import { KodikProvider } from './kodik/KodikProvider.js';
import { RezkaProvider } from './rezka/RezkaProvider.js';
import { RutubeProvider } from './rutube/RutubeProvider.js';
import { CollapsProvider } from './collaps/CollapsProvider.js';
import { HDVBProvider } from './hdvb/HDVBProvider.js';
import { EoProvider } from './eonline/EoProvider.js';

// Названия балансеров E-Online под брендом «Maniya» (для источников).
const EO_TITLES = {
  filmix: 'Maniya · Filmix',
  filmixtv: 'Maniya · FilmixTV',
  rezka: 'Maniya · Rezka',
  videoseed: 'Maniya · VideoSeed',
  hdvb: 'Maniya · HDVB',
  veoveo: 'Maniya · VeoVeo',
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

// E-Online: каждый REST-доступный балансер = отдельный источник «Maniya · …».
// Без EO_ACCOUNT_EMAIL/EO_UID провайдеры скрыты (enabled()=false) и не
// светятся в /api/lampa/sources.
// ❗ Балансер, у которого уже есть ВКЛЮЧЁННЫЙ native-провайдер с тем же id
// (filmix/rezka/hdvb/rutubemovie/…), не становится видимым источником —
// в UI его отдаёт native («такой источник должен быть один»), а eonline-
// близнец регистрируется как СКРЫТЫЙ фолбэк (`twinFor`): если native вернёт
// 0 items, store.js прозрачно отдаст его результат. Видимым eonline-балансер
// становится только когда native выключен (нет токена/ключа).
function buildEonlineProviders() {
  return (config.eonline.balancers || []).map((balancer) => {
    const nativeTwin = nativeProviders.find((p) => p.id === balancer);
    const hidden = Boolean(nativeTwin?.enabled?.());
    return new EoProvider({
      id: `eonline-${balancer}`,
      title: EO_TITLES[balancer] || `Maniya · ${capitalize(balancer)}`,
      balancer,
      hosts: config.eonline.hosts,
      skazHosts: config.eonline.skazHosts,
      accountEmail: config.eonline.accountEmail,
      uid: config.eonline.uid,
      origin: config.eonline.origin,
      show: !hidden,
      hiddenTwinNative: hidden ? balancer : null
    });
  });
}

const allEonlineProviders = buildEonlineProviders();
const eonlineProviders = allEonlineProviders.filter((provider) => provider.show);
const providers = [...nativeProviders, ...eonlineProviders];

/** Скрытый E-Online близнец native-провайдера (id совпадает) или null. */
export function twinFor(nativeId) {
  const id = String(nativeId || '').trim().toLowerCase();
  return allEonlineProviders.find((provider) => provider.hiddenTwinNative === id) || null;
}

export function registeredProviders() {
  return providers;
}

export function providerById(id) {
  return providers.find((provider) => provider.id === id) || null;
}

function capitalize(text) {
  const s = String(text || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}