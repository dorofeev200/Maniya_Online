import test from 'node:test';
import assert from 'node:assert/strict';
import { FilmixNormalizer } from '../filmix/FilmixNormalizer.js';

function createNormalizer() {
  return new FilmixNormalizer({ streamProxy: (url) => url });
}

test('normalizes primary movie streams', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    link: 'https://filmix.my/s/abc/_[720,480,].mp4',
    translation: 'original'
  });

  assert.equal(streams.length, 2);
  assert.deepEqual(streams.map((stream) => stream.quality).sort(), ['480p', '720p']);
  assert.ok(streams.every((stream) => stream.voice === 'original'));
});

test('normalizes backup movie streams', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    link: 'https://filmix.my/s/abc/_[480,].mp4',
    backup: [{
      link: 'https://filmix.my/s/abc/_[720,].mp4',
      translation: 'backup'
    }]
  });

  assert.equal(streams.length, 2);
  assert.ok(streams.some((stream) => stream.voice === 'backup'));
  assert.ok(streams.some((stream) => stream.quality === '720p'));
});

test('normalizes reserve movie streams', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    link: 'https://filmix.my/s/abc/_[480,].mp4',
    reserve: [{
      link: 'https://filmix.my/s/abc/_[720,].mp4',
      translation: 'reserve'
    }]
  });

  assert.equal(streams.length, 2);
  assert.ok(streams.some((stream) => stream.voice === 'reserve'));
  assert.ok(streams.some((stream) => stream.quality === '720p'));
});

test('normalizes DASH streams without explicit quality metadata', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    dash: 'https://example.com/video.mpd',
    translation: 'dash'
  });

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://example.com/video.mpd');
  assert.equal(streams[0].voice, 'dash');
});

test('eliminates duplicate stream entries', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    link: 'https://filmix.my/s/abc/_[720,].mp4',
    translation: 'original',
    backup: [{
      link: 'https://filmix.my/s/abc/_[720,].mp4',
      translation: 'original'
    }],
    reserve: [{
      link: 'https://filmix.my/s/abc/_[720,].mp4',
      translation: 'original'
    }]
  });

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://filmix.my/s/abc/_720.mp4');
});

test('preserves distinct stream candidates when voices differ for the same URL and quality', () => {
  const normalizer = createNormalizer();
  const streams = normalizer.normalizeMovie({
    link: 'https://filmix.my/s/abc/_[720,].mp4',
    translation: 'original',
    backup: [{
      link: 'https://filmix.my/s/abc/_[720,].mp4',
      translation: 'dubbed'
    }]
  });

  assert.equal(streams.length, 2);
  assert.deepEqual(streams.map((stream) => stream.voice).sort(), ['dubbed', 'original']);
});
