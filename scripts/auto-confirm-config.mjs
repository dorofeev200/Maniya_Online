// Конфиг для auto-confirm.mjs: типовой набор тайтлов и источников.
// TOKEN подставляется из env или берётся тут (реальный пользовательский токен,
// в git не коммитится — для локальных прогонов через env TOKEN=...).
export const config = {
  TOKEN: 'mo-54f4ada00dc5bd8ed3b03cfdc9c00227',
  CONCURRENCY: 4,
  TIMEOUT_MS: 25000,
  MOVIES: [
    { key: 'interstellar', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', kinopoisk_id: '462682', imdb_id: 'tt0816692', tmdb_id: '157336' },
    { key: 'matrix', title: 'Матрица', original_title: 'The Matrix', year: '1999', kinopoisk_id: '301', imdb_id: 'tt0133093', tmdb_id: '603' },
    { key: 'darkKnight', title: 'Тёмный рыцарь', original_title: 'The Dark Knight', year: '2008', kinopoisk_id: '111543', imdb_id: 'tt0468569', tmdb_id: '155' },
    { key: 'forrestGump', title: 'Форрест Гамп', original_title: 'Forrest Gump', year: '1994', kinopoisk_id: '448', imdb_id: 'tt0109830', tmdb_id: '13' },
    { key: 'dune', title: 'Дюна', original_title: 'Dune', year: '2021', kinopoisk_id: '4445875', imdb_id: 'tt1160419', tmdb_id: '438631' },
    { key: 'joker', title: 'Джокер', original_title: 'Joker', year: '2019', kinopoisk_id: '1041568', imdb_id: 'tt7286456', tmdb_id: '475557' },
    { key: 'titanic', title: 'Титаник', original_title: 'Titanic', year: '1997', kinopoisk_id: '2213', imdb_id: 'tt0120338', tmdb_id: '597' },
    { key: 'sherlock-s1', title: 'Шерлок', original_title: 'Sherlock', year: '2010', kinopoisk_id: '569838', imdb_id: 'tt1475582', tmdb_id: '1622', serial: '1' }
  ],
  STOCKS: ['filmix', 'kodik', 'rezka', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb',
    'eonline-alloha', 'eonline-videoseed', 'eonline-kinoflix', 'eonline-veoveo', 'eonline-pidtor', 'eonline-solntse']
};