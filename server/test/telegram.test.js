import test from 'node:test';
import assert from 'node:assert/strict';

import { handleCommand, isUserActive, makeToken, pluginUrl } from '../src/telegram/bot.js';
import { TelegramBotClient } from '../src/telegram/BotClient.js';
import { createTelegramRunner } from '../src/telegram/runner.js';

const cfg = {
  publicBaseUrl: 'https://plugin.maniya-kvn.online',
  telegram: {
    admins: ['111'],
    trialDays: 3,
    trialPlan: 'trial',
    pluginUrlTemplate: 'https://plugin.maniya-kvn.online/maniya-online.js?token={token}'
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

test('pluginUrl: подставляет {token} в шаблон', () => {
  assert.equal(pluginUrl(cfg, 'abc'), 'https://plugin.maniya-kvn.online/maniya-online.js?token=abc');
  assert.equal(pluginUrl({ publicBaseUrl: 'https://x.test' }, 'tok'), 'https://x.test/maniya-online.js?token=tok');
});

test('/start выдает триал новому чату и создаёт пользователя', async () => {
  const store = memStore();
  const reply = await handleCommand({ text: '/start', chatId: 222, config: cfg, getUsers: store.get, setUsers: store.set, now: NOW });
  assert.match(reply.text, /Триал‑подписка выдана/);
  assert.match(reply.text, /token=\w+/);
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
  assert.equal(sent.length, 1);
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