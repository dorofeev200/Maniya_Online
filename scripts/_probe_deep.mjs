// Deep: полные копии есть ли вообще? Пробегаем до 6 страниц (120 записей)
// по «Матрица 1999»/«The Matrix», «Зеленая миля»/«The Green Mile» и печатаем
// КАЖДУЮ запись с duration>=5000 и названием, где есть год 1999,
// либо фильный счёт по новому скорингу.
import { searchNameTo } from '../server/src/providers/shared/normalize/searchNameTo.js';
import { RutubeClient } from '../server/src/providers/rutube/RutubeClient.js';
import { RutubeNormalizer } from '../server/src/providers/rutube/RutubeNormalizer.js';

const client = new RutubeClient({ host: 'https://rutube.ru' });
const norm = new RutubeNormalizer();

const cases = [
  { q: 'Матрица 1999', keys: ['матрица'], year: 1999 },
  { q: 'The Matrix', keys: ['thematrix'], year: 1999 },
  { q: 'Зеленая миля', keys: ['зеленаямиля'], year: 1999 },
  { q: 'The Green Mile', keys: ['thegreenmile'], year: 1999 }
];

for (const c of cases) {
  console.log(`\n######## "${c.q}" ########`);
  let page = 1;
  let total = 0;
  for (let p = 1; p <= 6; p++) {
    let url = `${client.host}/api/search/video/?content_type=video&duration=movie&query=${encodeURIComponent(c.q)}&page=${p}`;
    let data;
    try { data = await (await fetch(url, { headers: { 'User-Agent': 'probe' } })).json(); }
    catch (e) { console.log(`page ${p} ERR ${String(e).slice(0, 40)}`); break; }
    const arr = data.results || [];
    total += arr.length;
    for (const m of arr) {
      const dur = Number(m.duration) || 0;
      if (dur < 4000) continue;
      const name = searchNameTo(m.title || '');
      if (!name || !name.includes(c.keys[0])) continue;
      const e = norm.with({ searchKeys: c.keys, year: c.year }).score(m, c.keys);
      const s = e ? e.score : 'BLOCK';
      const rel = /1999/.test(m.title || '') ? ' <== 1999' : '';
      console.log(`  p${p} s=${String(s).padStart(5)} dur=${String(dur).padStart(6)} hits=${String(m.hits).padStart(7)} cat=${m.category?.id}${rel} | ${String(m.title).slice(0, 68)}`);
    }
    if (!data.has_next || !arr.length) break;
    page++;
  }
  console.log(`  scanned=${total}`);
}