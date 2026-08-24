// Debug: scored records + playOptions per record (Матрица/Аватар/Интерстеллар).
import { config } from '../server/src/config.js';
import { providerById } from '../server/src/providers/registry.js';
import { searchNameTo } from '../server/src/providers/shared/normalize/searchNameTo.js';

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999 },
  { title: 'Аватар', original_title: 'Avatar', year: 2009 },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014 }
];

const provider = providerById('rutubemovie');

for (const film of films) {
  const searchKeys = [...new Set([film.title, film.original_title].map((t) => searchNameTo(t)).filter(Boolean))];

  const raw = await provider.client.searchAll([`${film.title} ${film.year}`, `${film.original_title} ${film.year}`]);
  console.log(`\n[${film.title} ${film.year}] raw=${raw.length}`);

  const scored = [];
  const norm = provider.normalizer.with({ searchKeys, year: film.year });
  for (const movie of raw) {
    const e = norm.score(movie, searchKeys);
    if (!e) continue;
    scored.push({ s: e.score, id: e.record.id, dur: e.record.duration, hits: movie.hits, cat: movie.category?.id, title: e.record.title });
  }
  scored.sort((a, b) => b.s - a.s || b.dur - a.dur);
  for (const r of scored.slice(0, 12)) {
    let ok = '?';
    try { ok = (await provider.client.playOptions(r.id)) ? 'm3u8' : 'EMPTY'; } catch (e) { ok = `ERR ${String(e).slice(0, 40)}`; }
    console.log(`  s=${r.s} dur=${r.dur} hits=${r.hits} cat=${r.cat} po=${ok} | ${String(r.title).slice(0, 75)}`);
  }
}