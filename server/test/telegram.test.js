import test from 'node:test';
import assert from 'node:assert/strict';

import { daysLeft, handleCallback, handleCommand, inlineKeyboard, isUserActive, makeToken, pluginUrl, shortId, slugFrom } from '../src/telegram/bot.js';
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
  assert.match(a.text, /vasya_[0-9a-f]{12}\.js/);
  assert.match(b.text, /anya_[0-9a-f]{12}\.js/);
});

test('/start выдает триал новому чату и создаёт пользователя', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /MANIYA ONLINE/);
  assert.match(reply.text, /Осталось/);
  assert.match(reply.text, /dorofeev200_[0-9a-f]{12}\.js/);
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
  const again = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(store.users.length, 1);
  assert.equal(store.users[0].token, before);
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

test('/grant (админ): бессрочно или продлевает по токену', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const token = store.users[0].token;

  const grant7 = await handleCommand({ text: `/grant ${token} 7`, chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(grant7.text, /🟢 активна/);
  assert.equal(store.users[0].plan, 'full');
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 7 * 24 * 3600 * 1000);

  const forever = await handleCommand({ text: `/grant ${token}`, chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.equal(store.users[0].expires_at, null);
});

test('/grant не-админ: отклоняется', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const token = store.users[0].token;
  const reply = await handleCommand({ text: `/grant ${token} 7`, chatId: 777, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /только для админ/);
});

test('/grant по неизвестному токену: сообщение об ошибке', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/grant nope-123 7', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /Не найден пользователь/);
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

test('handleCallback get_link: возвращает ссылку существующего пользователя', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  const token = store.users[0].token;
  const reply = await handleCallback({ data: 'get_link', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /MANIYA ONLINE/);
  assert.ok(reply.text.includes('dorofeev200_'));
  assert.ok(reply.text.includes(`${shortId(token)}.js`));
  assert.ok(!reply.text.includes(token));
  assert.equal(store.users.length, 1);
});

test('handleCallback неизвестный data → null (только ack)', async () => {
  const reply = await handleCallback({ data: 'something_else', chatId: 222, config: cfg, getUsers: () => Promise.resolve([]), setUsers: () => Promise.resolve() });
  assert.equal(reply, null);
});

test('/start нового пользователя: adminNote для выдачи подписки админом', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'vitya' } });
  assert.ok(reply.adminNote.includes('/grant 222'));
  assert.ok(reply.adminNote.includes('@vitya'));
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

test('/grant по @ник: выдаёт полную подписку и прилагает ссылку', async () => {
  const store = memStore();
  await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW, sender: { username: 'Vasya' } });
  const r = await handleCommand({ text: '/grant @vasya 5', chatId: 111, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(r.text, /🟢 активна/);
  assert.ok(r.text.includes('vasya_'));
  assert.equal(new Date(store.users[0].expires_at).getTime(), NOW + 5 * 24 * 3600 * 1000);
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