// Deep v2: есть ли полные копии Дюна2/Аннигиляция/Братство/Матрица1999 в выдаче?
// 6 страниц по RU+EN, печатаем только записи с duration>=4000, ключ входит в title,
// и год 2024/2018/2010/1999 в title, либо score по новому скорингу.
import { searchNameTo } from '../server/src/providers/shared/normalize/searchNameTo.js';
import { RutubeClient } from '../server/src/providers/rutube/RutubeClient.js';
import { RutubeNormalizer } from '../server/src/providers/rutube/RutubeNormalizer.js';

const client = new RutubeClient({ host: 'https://rutube.ru' });
const norm = new RutubeNormalizer();

const cases = [
  { q: 'Дюна: Часть вторая', en: 'Dune: Part Two', year: 2024, key: 'дюначастьвторая', enKey: 'duneparttwo' },
  { q: 'Аннигиляция', en: 'Annihilation', year: 2018, key: 'аннигиляция', enKey: 'annihilation' },
  { q: 'Братство', en: 'Bratstvo', year: 2010, key: 'братство', enKey: 'bratstvo' },
  { q: 'Матрица', en: 'The Matrix', year: 1999, key: 'матрица', enKey: 'thematrix' }
];

for (const c of cases) {
  for (const [q, keys] of [[c.q, [c.key]], [c.en, [c.enKey]]]) {
    console.log(`\n######## "${q}" (year=${c.year}) ########`);
    let scanned = 0;
    for (let p = 1; p <= 6; p++) {
      let url = `${client.host}/api/search/video/?content_type=video&duration=movie&query=${encodeURIComponent(q)}&page=${p}`;
      let data;
      try { data = await (await fetch(url, { headers: { 'User-Agent': 'probe' } })).json(); }
      catch (e) { console.log(`  page ${p} ERR ${String(e).slice(0, 40)}`); break; }
      const arr = data.results || [];
      scanned += arr.length;
      for (const m of arr) {
        const dur = Number(m.duration) || 0;
        if (dur < 4000) continue;
        const name = searchNameTo(m.title || '');
        if (!name || !keys.some((k) => name.includes(k))) continue;
        const e = norm.with({ searchKeys: keys, year: c.year }).score(m, keys);
        const s = e ? e.score : 'BLOCK';
        const hasYear = new RegExp(String(c.year)).test(m.title || '');
        const mark = hasYear ? ' <== YEAR' : '';
        console.log(`  p${p} s=${String(s).padStart(5)} dur=${String(dur).padStart(6)} hits=${String(m.hits).padStart(7)} cat=${m.category?.id}${mark} | ${String(m.title).slice(0, 62)}`);
      }
      if (!data.has_next || !arr.length) break;
    }
    console.log(`  scanned=${scanned}`);
  }
}
