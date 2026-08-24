// RUTUBE-NORMALIZER-FIX-001: где реальные копии в сырой выдаче?
// Для каждого фильма гоняем 4 запроса (RU/EN × с годом/без) и печатаем
// первые 30 сырых названий, помечая хорошие по эвристике «фильм/полн/movie».
import { searchNameTo } from '../server/src/providers/shared/normalize/searchNameTo.js';
import { RutubeClient } from '../server/src/providers/rutube/RutubeClient.js';

const client = new RutubeClient({ host: 'https://rutube.ru' });

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999 },
  { title: 'Аватар', original_title: 'Avatar', year: 2009 },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014 },
  { title: 'Зеленая миля', original_title: 'The Green Mile', year: 1999 }
];

const GOOD = [
  'фильм', 'полн', 'movie', 'full', 'hd', '4k', '1080', '2160'
];
const GOODRE = new RegExp(GOOD.join('|'), 'i');

for (const film of films) {
  console.log(`\n######## ${film.title} (${film.year}) ########`);
  const queries = [
    `${film.title} ${film.year}`, film.title,
    `${film.original_title} ${film.year}`, film.original_title
  ];
  for (const q of queries) {
    let raw = [];
    try { raw = await client.searchAll([q]); } catch (e) { console.log(`query "${q}" ERR ${String(e).slice(0, 60)}`); continue; }
    console.log(`\n--- query "${q}" -> ${raw.length} raw`);
    raw.slice(0, 30).forEach((m, i) => {
      const n = searchNameTo(m.title || '');
      let tag = '';
      if (m.is_hidden || m.is_deleted || m.is_adult) tag += ' [BLOCK]';
      if (m.category && [4, 13, 64, 73].includes(Number(m.category.id))) tag += ' [filmcat]';
      else if (m.category) tag += ` [cat${m.category.id}]`;
      const year = (String(m.title).match(/(1[89]\d\d|20\d\d)/) || [])[0] || '';
      const good = GOODRE.test(m.title) ? ' <== GOOD?' : '';
      console.log(`  ${String(i + 1).padStart(2)} ${m.id} y=${year.padStart(4)} dur=${String(m.duration).padStart(6)} hits=${String(m.hits).padStart(7)}${tag}${good} | ${String(m.title).slice(0, 70)}`);
    });
  }
}