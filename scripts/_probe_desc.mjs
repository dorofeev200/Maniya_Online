// Desc-аудит: description топ-кандидатов — реально ли там boosty/реакция?
import { searchNameTo } from '../server/src/providers/shared/normalize/searchNameTo.js';
import { RutubeClient } from '../server/src/providers/rutube/RutubeClient.js';
import { RutubeNormalizer } from '../server/src/providers/rutube/RutubeNormalizer.js';

const client = new RutubeClient({ host: 'https://rutube.ru' });
const norm = new RutubeNormalizer();

const cases = [
  { q: 'Интерстеллар', keys: ['интерстеллар', 'interstellar'], year: 2014 },
  { q: 'Зеленая миля', keys: ['зеленаямиля', 'thegreenmile'], year: 1999 }
];

const NOISE = ['boosty', 'donate', 'paypal', 'patreon', 'патреон', 'реакция на фильм', 'заказать реакцию', 'twitch', 'donationalerts'];

for (const c of cases) {
  console.log(`\n######## "${c.q}" ########`);
  const raw = await client.searchAll([c.q]);
  const scored = [];
  for (const m of raw) {
    const e = norm.with({ searchKeys: c.keys, year: c.year }).score(m, c.keys);
    if (!e) continue;
    scored.push({ s: e.score, id: e.record.id, dur: m.duration, hits: m.hits, cat: m.category?.id, title: m.title, desc: String(m.description || '') });
  }
  scored.sort((a, b) => b.s - a.s).slice(0, 8).forEach((r) => {
    const noiseHits = NOISE.filter((n) => r.desc.toLowerCase().includes(n));
    console.log(`s=${r.s} cat=${r.cat} dur=${r.dur} hits=${r.hits} noise=[${noiseHits.join('|') || '-'}]`);
    console.log(`   T: ${String(r.title).slice(0, 70)}`);
    console.log(`   D: ${r.desc.replace(/\s+/g, ' ').slice(0, 160)}`);
  });
}