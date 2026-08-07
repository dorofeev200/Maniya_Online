// Логика команд бота + выдача подписок. Чистые вычисления (без fetch), чтобы тестировать
// без сети. `getUsers`/`setUsers` — интерфейс хранения (по умолчанию store.js users.json).
import crypto from 'node:crypto';
import { listUsers, writeUsers } from '../store.js';

export function makeToken(prefix = 'mo') {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isUserActive(user, now = Date.now()) {
  if (!user || !user.active) return false;
  if (!user.expires_at) return true;
  return new Date(user.expires_at).getTime() > now;
}

function expiresLabel(user) {
  if (!user.expires_at) return '∞ без срока';
  return new Date(user.expires_at).toISOString();
}

export function pluginUrl(config, token) {
  const template = config?.telegram?.pluginUrlTemplate;
  if (template) return String(template).replace('{token}', encodeURIComponent(token));
  return `${config?.publicBaseUrl || ''}/maniya-online.js?token=${encodeURIComponent(token)}`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function linkReply(config, user, isNew, now = Date.now()) {
  if (!user) return { text: '—' };
  const url = pluginUrl(config, user.token);
  const header = isNew
    ? '🎉 Триал‑подписка выдана!\n'
    : `Ваша подписка ${isUserActive(user, now) ? 'активна' : 'отключена'}.\n`;
  return {
    text: `${header}` +
      `Ссылка плагина для Lampa (добавьте как кастом‑плагин):\n\n` +
      `<code>${escapeHtml(url)}</code>\n\n` +
      `Токен: <code>${escapeHtml(user.token)}</code>\n` +
      `Статус: /status · Помощь: /help`
  };
}

function statusText(config, user, now) {
  if (!user) return { text: 'У вас ещё нет подписки. Отправьте /start для бесплатного триала.' };
  const active = isUserActive(user, now);
  return {
    text: `Токен: <code>${escapeHtml(user.token)}</code>\n` +
      `Статус: ${active ? '🟢 активна' : '🔴 не активна'}\n` +
      `План: ${escapeHtml(user.plan || '—')}\n` +
      `Действует до: ${escapeHtml(expiresLabel(user))}`
  };
}

function helpReply(config) {
  const lines = [
    'Доступные команды:',
    '/start — получить триал‑подписку и ссылку плагина',
    '/status — статус вашей подписки',
    '/help — справка'
  ];
  if (config?.telegram?.admins?.length) {
    lines.push('/grant &lt;token&gt; [days] — выдача/продление (админ)');
    lines.push('/revoke &lt;token&gt; — отключить (админ)');
  }
  return { text: lines.join('\n') };
}

function findBySubject(users, subject) {
  const s = String(subject || '').trim();
  return users.find((u) => u.token === s) || users.find((u) => String(u.telegram_id) === s);
}

/**
 * Обработать одно текстовое сообщение и вернуть текст ответа.
 * @param {object} o
 * @param {string} o.text            сырой текст сообщения
 * @param {string|number} o.chatId   telegram chat id
 * @param {object} o.config          конфиг
 * @param {function} [o.getUsers]    async () => User[]
 * @param {function} [o.setUsers]    async (User[]) => void
 * @param {number} [o.now]
 */
export async function handleCommand({ text, chatId, config, getUsers = listUsers, setUsers = writeUsers, now = Date.now() }) {
  const raw = String(text || '').trim();
  const parts = raw.split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  const args = parts.slice(1).join(' ');
  const admins = (config?.telegram?.admins || []).map(String);
  const admin = admins.includes(String(chatId || ''));
  const users = (await getUsers()).slice();
  const user = users.find((u) => String(u.telegram_id) === String(chatId));

  switch (command) {
    case '/start': {
      let target = user;
      let fresh = false;
      if (!target) {
        const trialDays = Math.max(1, Number(config?.telegram?.trialDays) || 3);
        target = {
          telegram_id: String(chatId),
          email: '',
          token: makeToken(),
          active: true,
          plan: config?.telegram?.trialPlan || 'trial',
          expires_at: new Date(now + trialDays * DAY_MS).toISOString()
        };
        users.push(target);
        await setUsers(users);
        fresh = true;
      }
      return linkReply(config, target, fresh, now);
    }
    case '/status':
      return statusText(config, user, now);
    case '/help':
    case '/commands':
      return helpReply(config);
    case '/grant':
    case '/subscribe':
    case '/extend':
    case '/give': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      const grantArgs = args.trim().split(/\s+/);
      const target = findBySubject(users, grantArgs[0]);
      if (!target) return { text: 'Не найден пользователь по токену или chat‑id. Использование: /grant &lt;token&gt; [days]' };
      const days = Number.parseInt(grantArgs[1] || '', 10);
      if (Number.isFinite(days) && days > 0) target.expires_at = new Date(now + days * DAY_MS).toISOString();
      else target.expires_at = null;
      target.plan = 'full';
      target.active = true;
      await setUsers(users);
      return statusText(config, target, now);
    }
    case '/revoke':
    case '/expire':
    case '/suspend': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      const target = findBySubject(users, args);
      if (!target) return { text: 'Не найден пользователь.' };
      target.active = false;
      await setUsers(users);
      return { text: '⛔ Подписка отключена.' };
    }
    default:
      return { text: 'Неизвестная команда. Справка: /help' };
  }
}
