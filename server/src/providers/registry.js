import { config } from '../config.js';
import { AllohaProvider } from './alloha/AllohaProvider.js';
import { CDNvideohubProvider } from './cdnvideohub/CDNvideohubProvider.js';
import { FilmixProvider } from './filmix/FilmixProvider.js';
import { KodikProvider } from './kodik/KodikProvider.js';
import { RezkaProvider } from './rezka/RezkaProvider.js';
import { RutubeProvider } from './rutube/RutubeProvider.js';
import { CollapsProvider } from './collaps/CollapsProvider.js';

const providers = [
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
  })
];

export function registeredProviders() {
  return providers;
}

export function providerById(id) {
  return providers.find((provider) => provider.id === id) || null;
}