import { AllohaProvider } from './alloha/AllohaProvider.js';
import { KodikProvider } from './kodik/KodikProvider.js';
import { RezkaProvider } from './rezka/RezkaProvider.js';

const providers = [new KodikProvider(), new RezkaProvider(), new AllohaProvider()];

export function registeredProviders() {
  return providers;
}

export function providerById(id) {
  return providers.find((provider) => provider.id === id) || null;
}
