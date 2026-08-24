// COLLAPS-EGRESS-001: инспекция HTML embed (изменился ли гейт → парсится ли источник).
// Смотрим: фичи source (dasha/hls/mp4), decoy-маркеры, geo-текст, редиректы.
import { pathToFileURL } from 'node:url';
const SRC = 'C:/Users/Admin/Maniya_Online/server/src';
const { CollapsClient } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsClient.js`));
const { CollapsNormalizer } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsNormalizer.js`));

const EMBED = 'https://api.luxembd.ws';
const client = new CollapsClient({ embedHost: EMBED });

const cases = [
  ['Матрица kp/301', { kp: 301 }],
  ['Интерстеллар kp/258687', { kp: 258687 }],
  ['Одиссея orid/87624', { orid: 87624 }],
];

for (const [label, opt] of cases) {
  try {
    const { text, embedHost } = await client.embed(opt);
    const m = /<title>([^<]*)<\/title>/i.exec(text);
    const vk = /video_id|video\.css|dasha|\.m3u8|"stream"|"hls"|"source"/ig;
    const marks = [...new Set((text.match(vk) || []))].slice(0, 6);
    console.log(`===== ${label}`);
    console.log(`  host=${embedHost} bytes=${text.length} title=${m ? m[1].slice(0, 60) : '(none)'}`);
    console.log(`  маркеры source: ${marks.join(', ') || '(нет)'}`);
    // Если маркеры есть — пробуем нормализатор извлечь playable item.
    if (marks.length) {
      const rec = new CollapsNormalizer().record(text, { title: label.split(' ')[0], year: 0 });
      console.log(`  normalizer: method=${rec?.method} url=${String(rec?.url || '').slice(0, 110)}`);
    } else {
      console.log(`  НЕТ маркеров плеера → декой/гейт-страница`);
    }
  } catch (e) {
    console.log(`===== ${label}\n  ERR ${e.status || e?.info?.kind || ''} ${String(e.message || e).slice(0, 80)}`);
  }
}
console.log('DONE');