// RUTUBE-NORMALIZER-FIX-001: детальный probe сырой выдачи (RU+EN, 2 страницы)
// для калибровки scoring. Публичное API, креды не нужны. Удалить после.
const host = 'https://rutube.ru';

async function searchRaw(query, pages = 2) {
  const out = [];
  let url = new URL('api/search/video/', `${host}/`);
  url.searchParams.set('content_type', 'video');
  url.searchParams.set('duration', 'movie');
  url.searchParams.set('query', query);
  for (let i = 0; i < pages; i++) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) break;
    const d = await r.json();
    for (const it of d.results || []) out.push(it);
    if (!d.has_next) break;
    const nxt = new URL(d.next, host);
    url = nxt;
  }
  return out;
}

const nameTo = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/щ/g, 'ш').replace(/[^0-9a-zа-я]/g, '');

const films = [
  { ru: 'Матрица', en: 'The Matrix', year: 1999 },
  { ru: 'Аватар', en: 'Avatar', year: 2009 },
  { ru: 'Интерстеллар', en: 'Interstellar', year: 2014 },
  { ru: 'Зеленая миля', en: 'The Green Mile', year: 1999 },
  { ru: 'Дюна: Часть вторая', en: 'Dune: Part Two', year: 2024 },
  { ru: 'Аннигиляция', en: 'Annihilation', year: 2018 },
  { ru: 'Братство', en: 'Bratstvo', year: 2000 }
];

for (const f of films) {
  const queries = [`${f.ru} ${f.year}`, `${f.en} ${f.year}`];
  console.log(`\n===== ${f.ru} (${f.en}) ${f.year} =====`);
  for (const q of queries) {
    const raw = await searchRaw(q);
    const keys = [nameTo(f.ru), nameTo(f.en)].filter(Boolean);
    console.log(`--- q="${q}" raw=${raw.length}`);
    raw.slice(0, 8).forEach((m, i) => {
      const name = nameTo(m.title);
      const match = keys.some((k) => name.includes(k)) ? '+' : '-';
      const flags = ['hidden','deleted','adult','locked','audio','paid','livestream'].map((k) => m[`is_${k}`] ? k : '').filter(Boolean).join(',');
      console.log(`  #${i + 1} ${match} cat=${m.category?.id} dur=${m.duration} hits=${m.hits} [${flags}] name=${name.slice(0, 40)}`);
      console.log(`       title="${String(m.title).slice(0, 60)}" desc="${String(m.description || '').slice(0, 70)}"`);
    });
  }
}