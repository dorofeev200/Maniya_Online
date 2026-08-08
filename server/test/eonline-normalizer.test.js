import test from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import { EoNormalizer } from '../src/providers/eonline/EoNormalizer.js';

const normalizer = new EoNormalizer();

async function fixture(name) {
  return readFile(`C:/tmp/showy/${name}`, 'utf8');
}

test('cards: play-карточки filmix — quality map и translate', async () => {
  const html = await fixture('eo-fx.json');
  const cards = normalizer.cards(html);

  assert.ok(cards.length > 0);
  const play = cards.filter((card) => card.method === 'play');
  assert.ok(play.length >= 1);
  assert.ok(Object.keys(play[0].quality || {}).length >= 1);
});

test('cards: сериал — переводы (t=) и сезоны (s=) раздельные', async () => {
  const html = await fixture('eo-got-rezka.html');
  const cards = normalizer.cards(html);

  const voices = normalizer.voices(cards);
  const seasons = normalizer.seasons(cards);

  assert.ok(voices.length >= 6, `≥6 переводов, было ${voices.length}`);
  assert.ok(seasons.length >= 1, 'есть сезоны');

  // Ни один голос не называется «1 сезон» (регресс: текст из соседней карточки)
  const seasonNames = seasons.map((s) => String(s.title).toLowerCase());
  for (const voice of voices) {
    assert.ok(!seasonNames.includes(String(voice.name).toLowerCase()),
      `голос «${voice.name}» оказался сезоном (t=${voice.t})`);
  }
  // В переводе обязательно есть t, сезоны — s
  assert.ok(voices.every((v) => v.t != null));
  assert.ok(seasons.every((s) => s.number != null));
});

test('isSerial: фикстура сериала → true, фильма → false', async () => {
  assert.equal(normalizer.isSerial(await fixture('eo-got-rezka.html')), true);
  assert.equal(normalizer.isSerial(await fixture('eo-fx.json')), false);
});

test('episodeItems: серии из страницы сезона', async () => {
  const html = await fixture('eo-got-ep.html');
  const cards = normalizer.cards(html);

  const episodes = normalizer.episodeItems(cards, 1);
  assert.ok(episodes.length >= 1, `эпизоды S1: ${episodes.length}`);
  const first = episodes.find((e) => e.episode === 1);
  assert.ok(first);
  assert.equal(first.season, 1);
  assert.ok(first.stream, 'у эпизода есть stream-URL');
});

test('filmItems: play-карточки фильма → items с качеством', async () => {
  const html = await fixture('eo-fx.json');
  const cards = normalizer.cards(html);
  const items = normalizer.filmItems(cards, { title: 'Film' });

  const plays = items.filter((i) => i.method === 'play');
  assert.ok(plays.length >= 1);
  assert.ok(plays[0].url);
  assert.ok(typeof plays[0].subtitles === 'undefined' || Array.isArray(plays[0].subtitles));
});

test('recordFromCard: метаданные из url (imdb_id и т.д.)', () => {
  const record = normalizer.recordFromCard(
    { url: 'http://h/lite/x?rjson=False&id=45&imdb_id=tt0944947&t=111', title: 'Игра престолов' },
    { year: 2011, serial: true }
  );
  assert.equal(record.metadata.id, 45);
  assert.equal(record.metadata.imdb_id, 'tt0944947');
  assert.equal(record.type, 'serial');
});