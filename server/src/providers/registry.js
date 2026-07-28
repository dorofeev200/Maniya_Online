import { KodikProvider } from './kodik/KodikProvider.js';

const providers = [new KodikProvider()];

export function registeredProviders() {
  return providers;
}

export function providerById(id) {
  return providers.find((provider) => provider.id === id) || null;
}
