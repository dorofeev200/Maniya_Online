import test from 'node:test';
import assert from 'node:assert/strict';

import { adminGrantMarkup, daysLeft, formatExpiry, handleCallback, handleCommand, inlineKeyboard, isUserActive, makeToken, nickLabel, paymentReply, planLetter, pluginUrl, shortId, slugFrom } from '../src/telegram/bot.js';
import { TelegramBotClient } from '../src/telegram/BotClient.js';
import { createTelegramRunner } from '../src/telegram/runner.js';

const cfg = {
  publicBaseUrl: 'https://plugin.maniya-kvn.online',
  telegram: {
    admins: ['111'],
    trialDays: 3,
    trialPlan: 'trial',
    pluginUrlTemplate: 'https://plugin.maniya-kvn.online/dorofeev200_{short}.js',
    adminContact: 'https://t.me/admin'
  }
};
const NOW = 1_700_000_000_000;

// In-memory хранилище пользователей, повторяющее интерфейс store.js.
function memStore(initial = []) {
  let users = JSON.parse(JSON.stringify(initial));
  return {
    get: async () => users,
    set: async (next) => { users = JSON.parse(JSON.stringify(next)); },
    get users() { return users; }
  };
}

test('makeToken: уникальные, с префиксом и без небезопасных символов', () => {
  const a = makeToken();
  const b = makeToken();
  assert.notEqual(a, b);
  assert.ok(a.startsWith('mo-'));
  assert.match(a, /^mo-[a-f0-9]+$/);
});

test('shortId: берёт последние 12 hex из токена', () => {
  assert.equal(shortId('mo-abcdef1234567890abcdef1234567890'), 'ef1234567890');
  assert.equal(shortId('mo-111122223333'), '111122223333');
});

test('slugFrom: транслит, нижний регистр, безопасные символы', () => {
  assert.equal(slugFrom('Василий'), 'vasilii');
  assert.equal(slugFrom('Ivan'), 'ivan');
  assert.equal(slugFrom('Dima_238'), 'dima-238');
  assert.equal(slugFrom(''), '');
  assert.equal(slugFrom('Аня'), 'anya');
});

test('pluginUrl: короткая ссылка /{prefix}_{short}.js; старый {token}-шаблон и дефолт', () => {
  assert.equal(pluginUrl(cfg, 'mo-abcdef1234567890abcdef1234567890'), 'https://plugin.maniya-kvn.online/dorofeev200_ef1234567890.js');
  assert.equal(pluginUrl({ publicBaseUrl: 'https://x.test', telegram: {} }, 'mo-abcdef1234567890abcdef1234567890'), 'https://x.test/dorofeev200_ef1234567890.js');
  const old = { telegram: { pluginUrlTemplate: 'https://x.test/?token={token}' } };
  assert.equal(pluginUrl(old, 'mo-abc'), 'https://x.test/?token=mo-abc');
});

test('pluginUrl: ссылка с ником БЕЗ общего префикса; разные юзеры уникальны', () => {
  const a = pluginUrl(cfg, 'mo-abcdef1234567890abcdef1234567890', { slug: 'vasya' });
  const b = pluginUrl(cfg, 'mo-11112222333344445555666677778888', { slug: 'anya' });
  assert.equal(a, 'https://plugin.maniya-kvn.online/vasya_ef1234567890.js');
  assert.equal(b, 'https://plugin.maniya-kvn.online/anya_666677778888.js');
  assert.notEqual(a, b);

  // Без ника — префикс.
  assert.equal(pluginUrl(cfg, 'mo-abcdef1234567890abcdef1234567890', {}), 'https://plugin.maniya-kvn.online/dorofeev200_ef1234567890.js');

  // Шаблон с {slug} тоже без префикса при использовании {slug}.
  const withSlug = { publicBaseUrl: 'https://x.test', telegram: { pluginUrlTemplate: 'https://x.test/{prefix}_{slug}_{short}.js' } };
  assert.equal(pluginUrl(withSlug, 'mo-aabbccddeeff00112233445566778899', { slug: 'kate' }), 'https://x.test/dorofeev200_kate_445566778899.js');

  // Ник уже транслитован (translit делает slugFrom при создании пользователя).
  assert.equal(pluginUrl({ publicBaseUrl: 'https://x.test', telegram: {} }, 'mo-aabbccddeeff00112233445566778899', { slug: 'ivan' }), 'https://x.test/ivan_445566778899.js');
});

test('/start: разные аккаунты получают разные ссылки с учётом их ника (без префикса)', async () => {
  const store = memStore();
  const a = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'Vasya' } });
  const b = await handleCommand({ text: '/start', chatId: 333, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { first_name: 'Аня' } });
  assert.equal(store.users[0].slug, 'vasya');
  assert.equal(store.users[1].slug, 'anya');
  assert.notEqual(store.users[0].token, store.users[1].token);
  assert.notEqual(a.text, b.text);
  // PLUGIN-INSTALL-003: legacy-формат /{slug}_{short}.js — уникальный, без /p/ и без реального токена.
  assert.ok(store.users[0].install_token, 'install_token создан (для /x/ и обратной совместимости)');
  assert.ok(store.users[1].install_token, 'install_token создан');
  assert.notEqual(store.users[0].install_token, store.users[1].install_token, 'install-токены уникальны');
  assert.match(a.text, new RegExp(`/vasya_${shortId(store.users[0].token)}\\.js`));
  assert.match(b.text, new RegExp(`/anya_${shortId(store.users[1].token)}\\.js`));
  assert.ok(!a.text.includes('/p/'), '/p/ не выдаётся');
  assert.ok(!b.text.includes('/p/'), '/p/ не выдаётся');
  assert.ok(!a.text.includes(store.users[0].token), 'реальный токен не в ответе');
  assert.ok(!b.text.includes(store.users[1].token), 'реальный токен не в ответе');
});

test('/start выдает триал новому чату и создаёт пользователя', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /MANIYA ONLINE/);
  assert.match(reply.text, /Осталось/);
  // PLUGIN-INSTALL-003: legacy-формат /dorofeev200_<short>.js вместо /p/<install>.js
  assert.match(reply.text, new RegExp(`/dorofeev200_${shortId(store.users[0].token)}\\.js`));
  assert.ok(!reply.text.includes('/p/'), '/p/ не выдаётся');
  assert.ok(store.users[0].install_token, 'install_token в записи пользователя');
  assert.ok(!/🔑 Токен:/.test(reply.text));
  assert.equal(store.users.length, 1);
  assert.equal(store.users[0].telegram_id, '222');
  assert.equal(store.users[0].active, true);
  assert.equal(store.users[0].plan, 'trial');
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 3 * 24 * 3600 * 1000);
});

test('/start повторно не выдаёт новый триал, а возвращает ту же ссылку', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const before = store.users[0].token;
  const installBefore = store.users[0].install_token;
  const again = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(store.users.length, 1);
  assert.equal(store.users[0].token, before);
  assert.equal(store.users[0].install_token, installBefore, 'install_token не пересоздаётся');
  assert.match(again.text, /Ваша подписка активна/);
});

test('/status: триал активен, потом протухает', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const st = await handleCommand({ text: '/status', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(st.text, /🟢 активна/);
  const expired = await handleCommand({ text: '/status', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW + 4 * 24 * 3600 * 1000 });
  assert.match(expired.text, /🔴 не активна/);
});

test('кнопка выдачи (админ): выдача на месяц, план full, ссылка', async () => {
  const store = memStore([{ telegram_id: '222', token: 'mo-222', slug: 'vasya', active: true, expires_at: null, plan: 'trial' }]);
  const r = await handleCallback({ data: 'grant_issue:222:30', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /🟢 активна/);
  assert.equal(store.users[0].plan, 'full');
  assert.equal(store.users[0].active, true);
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 30 * 24 * 3600 * 1000);
  assert.match(r.text, /Ссылка плагина/);
});

test('кнопка выдачи: продлевает от текущего срока, а не заново от now', async () => {
  const store = memStore([{ telegram_id: '222', token: 'mo-222', slug: 'vasya', active: true, plan: 'full', expires_at: new Date(NOW + 100 * 24 * 3600 * 1000).toISOString() }]);
  const r = await handleCallback({ data: 'grant_issue:222:30', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /🟢 активна/);
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 130 * 24 * 3600 * 1000);
});

test('кнопка выдачи — не-админ: отклоняется, подписка не меняется', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const before = store.users[0].expires_at;
  const r = await handleCallback({ data: 'grant_issue:222:30', chatId: 777, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /только для админ/);
  assert.equal(store.users[0].plan, 'trial');
  assert.equal(store.users[0].expires_at, before);
});

test('кнопка выдачи несуществующего пользователя: подсказка с /list', async () => {
  const r = await handleCallback({ data: 'grant_issue:999:30', chatId: 111, config: cfg, getUsers: () => Promise.resolve([]), setUsers: () => Promise.resolve() });
  assert.match(r.text, /Пользователь не найден/);
});

test('adminGrantMarkup: callback grant_issue:<id>:<месяц>', () => {
  const mk = adminGrantMarkup(222);
  const btn = mk.inline_keyboard[0][0];
  assert.match(btn.text, /Выдать подписку/);
  assert.equal(btn.callback_data, 'grant_issue:222:30');
});

test('/revoke (админ): отключает подписку', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const token = store.users[0].token;
  const reply = await handleCommand({ text: `/revoke ${token}`, chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /отключена/);
  assert.equal(store.users[0].active, false);
});

test('неизвестная команда → подсказка', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/foo bar', chatId: 1, config: cfg, getUsers: store.get, setUsers: store.set });
  assert.match(reply.text, /Неизвестная команда/);
});

test('BotClient: getUpdates разбирает массив; API-ошибка в {error}', async () => {
  const okClient = new TelegramBotClient({
    botToken: 't',
    fetchFn: async (m, p) => new Response(JSON.stringify({ ok: true, result: [{ update_id: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  const denied = await okClient.getUpdates({ offset: 0 });
  assert.deepEqual(denied, [{ update_id: 1 }]);

  const errClient = new TelegramBotClient({
    botToken: 't',
    fetchFn: async () => new Response('{"ok":false,"description":"Conflict: terminated by other getUpdates"}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  const bad = await errClient.getUpdates({ offset: 0 });
  assert.match(String(bad.error), /Conflict/);

  const httpErr = new TelegramBotClient({
    botToken: 't',
    fetchFn: async () => new Response('nope', { status: 401 })
  });
  await assert.rejects(httpErr.api('getMe', {}), /telegram_getMe_failed: HTTP 401/);
});

test('runner.pollOnce: /start обрабатывается, отправляется ответ, offset растёт', async () => {
  const store = memStore();
  const sent = [];
  const fetchImpl = async (m, p) => {
    if (m === 'getUpdates') return new Response(JSON.stringify({ ok: true, result: [{ update_id: 10, message: { chat: { id: 222 }, text: '/start' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (m === 'sendMessage') { sent.push(p); return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new TelegramBotClient({ botToken: 't', fetchFn: fetchImpl });
  const runner = createTelegramRunner(cfg, { client, getUsers: store.get, setUsers: store.set, now: NOW });
  await runner.pollOnce();
  // Ответ пользователю + уведомление админу о новом пользователе.
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chat_id, 222);
  assert.equal(sent[0].parse_mode, 'HTML');
  assert.equal(runner.offset, 11);
});

test('BotClient.sendMessage шлёт текст + parse_mode', async () => {
  const sent = [];
  const client = new TelegramBotClient({
    botToken: 't',
    fetchFn: async (m, p) => { if (m === 'sendMessage') sent.push(p); return new Response('{"ok":true,"result":{}}', { status: 200, headers: { 'content-type': 'application/json' } }); }
  });
  await client.sendMessage(42, 'Привет <b>мир</b>', { parse_mode: 'HTML' });
  assert.equal(sent[0].chat_id, 42);
  assert.equal(sent[0].text, 'Привет <b>мир</b>');
});

test('isUserActive: null expires → бессрочно; протухший false', () => {
  assert.equal(isUserActive({ active: true, expires_at: null }, NOW), true);
  assert.equal(isUserActive({ active: true, expires_at: new Date(NOW - 1).toISOString() }, NOW), false);
  assert.equal(isUserActive(null, NOW), false);
});

test('daysLeft: полные дни до окончания; протухший 0; бессрочный Infinity', () => {
  assert.equal(daysLeft({ active: true, expires_at: new Date(NOW + 3 * 24 * 3600 * 1000).toISOString() }, NOW), 3);
  assert.equal(daysLeft({ active: true, expires_at: new Date(NOW + 1000 + 24 * 3600 * 1000).toISOString() }, NOW), 2);
  assert.equal(daysLeft({ active: true, expires_at: new Date(NOW - 1).toISOString() }, NOW), 0);
  assert.equal(daysLeft({ active: true, expires_at: null }, NOW), Infinity);
  assert.equal(daysLeft(null, NOW), 0);
});

test('inlineKeyboard: кнопки Получить ссылку и Связь с админом; без контакта одна кнопка', () => {
  const kb = inlineKeyboard(cfg);
  assert.deepEqual(kb.inline_keyboard[0].map((b) => b.text), ['🎬 Получить ссылку', '📩 Связь с админом']);
  assert.ok(kb.inline_keyboard[0].find((b) => b.url === 'https://t.me/admin'));
  const noContact = inlineKeyboard({ telegram: {} });
  assert.deepEqual(noContact.inline_keyboard[0].map((b) => b.text), ['🎬 Получить ссылку']);
});

test('/start: баннер-бренд MANIYA ONLINE, остаток дней и inline-кнопки', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /MANIYA ONLINE/);
  assert.match(reply.text, /Осталось <b>3 дн\.<\/b>/);
  assert.ok(reply.replyMarkup.inline_keyboard[0].some((b) => b.callback_data === 'get_link'));
});

test('handleCallback get_link: возвращает opaque install-ссылку пользователя', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const token = store.users[0].token;
  const installToken = store.users[0].install_token;
  const reply = await handleCallback({ data: 'get_link', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /MANIYA ONLINE/);
  assert.ok(installToken, 'install_token задан');
  // PLUGIN-INSTALL-003: legacy-формат /dorofeev200_<short>.js, /p/ не выдаётся.
  assert.ok(reply.text.includes(`/dorofeev200_${shortId(token)}.js`), 'ссылка — legacy /dorofeev200_<short>.js');
  assert.ok(!reply.text.includes('/p/'), '/p/ не выдаётся');
  assert.ok(!reply.text.includes(token), 'реальный токен не в ответе');
  assert.equal(store.users.length, 1);
});

test('handleCallback неизвестный data → null (только ack)', async () => {
  const reply = await handleCallback({ data: 'something_else', chatId: 222, config: cfg, getUsers: () => Promise.resolve([]), setUsers: () => Promise.resolve() });
  assert.equal(reply, null);
});

test('/start нового пользователя: adminNote с кнопкой выдачи (без /grant)', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'vitya' } });
  assert.ok(reply.adminNote, 'adminNote есть');
  assert.equal(typeof reply.adminNote, 'object');
  assert.match(reply.adminNote.text, /Новый пользователь/);
  assert.ok(reply.adminNote.text.includes('@vitya'));
  const btn = reply.adminNote.replyMarkup.inline_keyboard[0][0];
  assert.equal(btn.callback_data, 'grant_issue:222:30');
  assert.match(btn.text, /Выдать подписку/);
});

test('/list (админ): перечисляет пользователей с токеном; не-админ — отклонение', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const list = await handleCommand({ text: '/list', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(list.text, /Пользователей: 1/);
  assert.ok(list.text.includes(store.users[0].token));
  const denied = await handleCommand({ text: '/list', chatId: 777, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(denied.text, /только для админ/);
});

test('/list: компактный вид @ник DD.MM.YY <буква> (P/T/X)', async () => {
  const store = memStore([
    { telegram_id: '222', token: 'mo-a1', slug: 'dorofeev200', active: true, plan: 'full', expires_at: '2026-10-10T12:00:00.000Z' },
    { telegram_id: '333', token: 'mo-b2', slug: 'anya', active: true, plan: 'trial', expires_at: NOW + 3 * 24 * 3600 * 1000 },
    { telegram_id: '444', token: 'mo-c3', active: true, plan: 'full', expires_at: '2040-01-01T00:00:00.000Z' },
    { telegram_id: '555', token: 'mo-d4', slug: 'pet', active: false, plan: 'full', expires_at: '2026-10-10T12:00:00.000Z' }
  ]);
  const list = await handleCommand({ text: '/list', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(list.text, /1\) @dorofeev200 10\.10\.26 P/);
  assert.match(list.text, /@anya \d\d\.\d\d\.\d\d T/);
  assert.match(list.text, /id 444 01\.01\.40 P/, 'без ника — «id N», бессрочно/далеко — P');
  assert.match(list.text, /@pet 10\.10\.26 X/, 'отключённая — X');
});

test('formatExpiry: DD.MM.YY, ∞ для бессрочно, — для невалидного', () => {
  assert.equal(formatExpiry('2026-10-10T12:00:00.000Z'), '10.10.26');
  assert.equal(formatExpiry(null), '∞');
  assert.equal(formatExpiry(''), '∞');
  assert.equal(formatExpiry('nope'), '—');
});

test('planLetter: P полная/бессрочно, T триал, X истекла/выключена', () => {
  const future = '2040-01-01T00:00:00.000Z';
  const past = '2000-01-01T00:00:00.000Z';
  assert.equal(planLetter({ active: true, plan: 'full', expires_at: future }), 'P');
  assert.equal(planLetter({ active: true, plan: 'full', expires_at: null }), 'P');
  assert.equal(planLetter({ active: true, expires_at: future }), 'P', 'без plan → P');
  assert.equal(planLetter({ active: true, plan: 'trial', expires_at: future }), 'T');
  assert.equal(planLetter({ active: true, plan: 'trial', expires_at: past }), 'X');
  assert.equal(planLetter({ active: false, plan: 'full', expires_at: future }), 'X');
});

test('nickLabel: @slug или id N', () => {
  assert.equal(nickLabel({ slug: 'vasya', telegram_id: '7' }), '@vasya');
  assert.equal(nickLabel({ telegram_id: '7' }), 'id 7');
  assert.equal(nickLabel(null), '—');
});

test('/grant: admin выдаёт 30 дней по нику; ответ «✅ @ник → DD.MM.YY P»', async () => {
  const store = memStore([
    { telegram_id: '222', token: 'mo-a1', slug: 'dorofeev200', active: false, plan: 'trial', expires_at: new Date(NOW - 1 * 24 * 3600 * 1000).toISOString() }
  ]);
  const r = await handleCommand({ text: '/grant @dorofeev200 30', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(store.users[0].active, true);
  assert.equal(store.users[0].plan, 'full');
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 30 * 24 * 3600 * 1000, 'у истёкшего — от now');
  assert.match(r.text, /✅ @dorofeev200 → \d\d\.\d\d\.\d\d P/);
  assert.match(r.text, /Ссылка плагина/);
});

test('/grant: продлевает от текущего срока (не с нуля), www по id без @', async () => {
  const store = memStore([
    { telegram_id: '222', token: 'mo-a1', slug: 'dorofeev200', active: true, plan: 'full', expires_at: new Date(NOW + 100 * 24 * 3600 * 1000).toISOString() }
  ]);
  await handleCommand({ text: '/grant 222 30', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 130 * 24 * 3600 * 1000);
});

test('/grant: не-админ отклонён; неверный формат — подсказка; нет юзера — ошибка', async () => {
  const store = memStore([{ telegram_id: '222', token: 'mo-a1', slug: 'vasya', active: true, expires_at: null }]);
  const opts = { text: '/grant @vasya 10', chatId: 777, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW };
  const denied = await handleCommand(opts);
  assert.match(denied.text, /только для админ/);
  const bad = await handleCommand({ ...opts, chatId: 111, text: '/grant @vasya' });
  assert.match(bad.text, /Формат: \/grant/);
  const notFound = await handleCommand({ ...opts, chatId: 111, text: '/grant @nobody 5' });
  assert.match(notFound.text, /Не найден пользователь/);
});

test('/revoke по нику: поиск устойчив — кириллица, регистр, пробелы/дефисы', async () => {
  const store = memStore([{ telegram_id: '222', token: 'mo-222', slug: 'ivan-ivanov', active: true, expires_at: null, plan: 'full' }]);
  const r = await handleCommand({ text: '/revoke @ИВАН ИВАНОВ', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /отключена/);
  assert.equal(store.users[0].active, false);
});

test('/revoke по старому слитному slug (без дефисов): тоже находит', async () => {
  const store = memStore([{ telegram_id: '333', token: 'mo-333', slug: 'ivanivanov', active: true, expires_at: null, plan: 'full' }]);
  const r = await handleCommand({ text: '/revoke @Иван Иванов', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(store.users[0].active, false);
});

test('handleCommand /revoke несуществующий ник: понятная ошибка', async () => {
  const store = memStore();
  const r = await handleCommand({ text: '/revoke @некто', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /Не найден пользователь/);
  assert.match(r.text, /@ник \/ id \/ токен/);
});

test('paymentReply: реквизиты + кнопки прикрепить/отправить', () => {
  const p = paymentReply(cfg);
  assert.match(p.text, /Оплата подписки Maniya Online/);
  assert.ok(p.replyMarkup.inline_keyboard[0].some((b) => b.callback_data === 'attach_receipt'));
  assert.ok(p.replyMarkup.inline_keyboard[0].some((b) => b.callback_data === 'send_receipt'));
});

test('handleCallback pay: включает режим квитанции и показывает реквизиты', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const r = await handleCallback({ data: 'pay', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /Оплата/);
  assert.equal(store.users[0].awaiting_receipt, true);
});

test('handleCallback send_receipt без квитанции → просьба прикрепить; с фото → adminNotePhoto', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'Vasya' } });
  const empty = await handleCallback({ data: 'send_receipt', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(empty.text, /Сначала прикрепите квитанцию/);

  store.users[0].receipt_file_id = 'AgRECEIPT123';
  store.users[0].receipt_caption = 'оплата';
  const r = await handleCallback({ data: 'send_receipt', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /✅ Квитанция отправлена/);
  assert.equal(r.adminNotePhoto.fileId, 'AgRECEIPT123');
  assert.match(r.adminNotePhoto.caption, /@vasya/);
  assert.ok(!/\/grant/.test(r.adminNotePhoto.caption), 'в квитанции больше нет /grant');
  assert.equal(r.adminNotePhoto.replyMarkup.inline_keyboard[0][0].callback_data, 'grant_issue:222:30');
  assert.equal(store.users[0].receipt_file_id, '');
});

test('runner: фото = квитанция в режиме оплаты; затем «send_receipt» шлёт фото админу', async () => {
  const store = memStore();
  // Сначала у пользователя включён режим квитанции.
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'vasya' } });
  store.users[0].awaiting_receipt = true;

  let sentFilter = null;
  const fetchImpl = async (m, p) => {
    if (m === 'getUpdates') return new Response('{"ok":true,"result":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    if (m === 'sendPhoto' || m === 'sendMessage' || m === 'answerCallbackQuery') { sentFilter = { m, p }; return new Response('{"ok":true,"result":{}}', { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new TelegramBotClient({ botToken: 't', fetchFn: fetchImpl });
  const runner = createTelegramRunner(cfg, { client, getUsers: store.get, setUsers: store.set, now: NOW });

  // 1) пользователь присылает фото квитанции.
  store.photoFlag = true;
  const mediaClient = new TelegramBotClient({
    botToken: 't',
    fetchFn: async (m, p) => {
      if (m === 'getUpdates') {
        return new Response(JSON.stringify({ ok: true, result: [{ update_id: 5, message: { chat: { id: 222 }, from: { username: 'vasya' }, photo: [{ file_id: 'PHOTO_high' }, { file_id: 'PHOTO_LOW' }, { file_id: 'PHOTO_MED' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (m === 'sendMessage') { sentFilter = { m, p }; return new Response('{"ok":true,"result":{}}', { status: 200, headers: { 'content-type': 'application/json' } }); }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const mediaRunner = createTelegramRunner(cfg, { client: mediaClient, getUsers: store.get, setUsers: store.set, now: NOW });
  await mediaRunner.pollOnce();
  assert.equal(store.users[0].receipt_file_id, 'PHOTO_MED');
  assert.equal(store.users[0].receipt_caption, '');
  assert.match(sentFilter.p.text, /Квитанция прикреплена/);
  assert.ok(sentFilter.p.reply_markup.inline_keyboard[0].some((b) => b.callback_data === 'send_receipt'));

  // 2) админ нажимает «Отправить» -> админ получает фото.
  const cbRunner = createTelegramRunner(cfg, {
    client: new TelegramBotClient({
      botToken: 't',
      fetchFn: async (m, p) => {
        if (m === 'getUpdates') {
          return new Response(JSON.stringify({ ok: true, result: [{ update_id: 6, callback_query: { id: 'c1', data: 'send_receipt', from: { id: 222 } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (m === 'sendPhoto' || m === 'sendMessage') { sentFilter = { m, p }; return new Response('{"ok":true,"result":{}}', { status: 200, headers: { 'content-type': 'application/json' } }); }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }),
    getUsers: store.get,
    setUsers: store.set,
    now: NOW
  });
  await cbRunner.pollOnce();
  assert.equal(sentFilter.m, 'sendPhoto');
  assert.equal(String(sentFilter.p.chat_id), '111');
  assert.equal(sentFilter.p.photo, 'PHOTO_MED');
  assert.match(sentFilter.p.caption, /@vasya/);
});

test('runner: новый пользователь → уведомление админу (выдача подписки)', async () => {
  const store = memStore();
  const sent = [];
  const fetchImpl = async (m, p) => {
    if (m === 'getUpdates') {
      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 222 }, from: { username: 'vitya' }, text: '/start' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (m === 'sendMessage') { sent.push(p); return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new TelegramBotClient({ botToken: 't', fetchFn: fetchImpl });
  const runner = createTelegramRunner(cfg, { client, getUsers: store.get, setUsers: store.set, now: NOW });
  await runner.pollOnce();
  const admin = sent.find((s) => String(s.chat_id) === '111');
  assert.ok(admin, 'админ получил уведомление');
  assert.match(admin.text, /Новый пользователь/);
  assert.ok(sent.some((s) => s.chat_id === 222));
});