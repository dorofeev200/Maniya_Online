import { FilmixClient } from './src/providers/filmix/FilmixClient.js';
import { FilmixProvider } from './src/providers/filmix/FilmixProvider.js';

const client = new FilmixClient({});
const provider = new FilmixProvider({ client, pro: false, token: '' });

const context = {
  query: { title: 'Дом Дракона', original_title: 'House of the Dragon', year: '2022' },
  request: { headers: {} }
};

const res = await client.search({ title: 'Дом Дракона', originalTitle: 'House of the Dragon', year: 2022 });
console.log('=== search item RAW keys ===', Object.keys(res.items[0] || {}).join(','));
console.log('search count:', res.items.length, '| first id:', res.items[0]?.id, '| type:', res.items[0]?.type);

const payload = await provider.videos(context);
console.log('\n=== provider.videos() [correct context] ===');
console.log('seasons:', JSON.stringify(payload.seasons));
console.log('voices:', JSON.stringify(payload.voices.map(v => v.name).slice(0,5)), '... (total', payload.voices.length + ')');
console.log('items:', payload.items.length);
for (const it of payload.items.slice(0,8)) {
  console.log(`  s=${it.season} e=${it.episode} voice="${it.voice_name}" title="${it.title}"`);
}

// выборочная проверка title у одного из items по голосу 0
if (payload.items.length) {
  const first = payload.items.find(i => i.season === 1 && i.episode === 1);
  console.log('\nfirst ep item keys:', Object.keys(first || {}).join(','));
}
