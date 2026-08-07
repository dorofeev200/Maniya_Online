// Логика команд бота + выдача подписок. Чистые вычисления (без fetch), чтобы тестировать
// без сети. `getUsers`/`setUsers` — интерфейс хранения (по умолчанию store.js users.json).
import crypto from 'node:crypto';
import { listUsers, writeUsers } from '../store.js';

export function makeToken(prefix = 'mo') {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const TRANSLIT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z',
  'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E', 'Ж': 'Zh', 'З': 'Z',
  'И': 'I', 'Й': 'I', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
  'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch',
  'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
};

/** Человекочитаемый ник пользователя → безопасный slug [a-z0-9-] для ссылки. */
export function slugFrom(...names) {
  const raw = names
    .map((n) => String(n || ''))
    .find((n) => n.trim() !== '') || '';
  let out = '';
  for (const ch of raw.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (TRANSLIT[ch]) out += TRANSLIT[ch].toLowerCase();
    else if (ch === '_' || ch === '-') out += '-';
  }
  return out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
}

export function isUserActive(user, now = Date.now()) {
  if (!user || !user.active) return false;
  if (!user.expires_at) return true;
  return new Date(user.expires_at).getTime() > now;
}

/** Сколько полных дней осталось до конца (0 = уже нет; Infinity = бессрочно). */
export function daysLeft(user, now = Date.now()) {
  if (!user || !user.active) return 0;
  if (!user.expires_at) return Infinity;
  const diff = new Date(user.expires_at).getTime() - now;
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
}

/** Короткий id из токена (последние 12 hex) для ссылки /{prefix}_{short}.js. */
export function shortId(token) {
  const t = String(token || '');
  const sep = t.lastIndexOf('-');
  const hex = sep >= 0 ? t.slice(sep + 1) : t;
  return (hex || t).slice(-12).toLowerCase();
}

/** Ссылка плагина для конкретного пользователя: /{prefix}_{slug}_...js — ник в ссылке. */
export function pluginUrl(config, token, user) {
  const prefix = config?.telegram?.linkPrefix || 'dorofeev200';
  const short = shortId(token);
  const slug = (user && user.slug ? String(user.slug) : '').replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  const tokenEnc = encodeURIComponent(token);
  const prefixEnc = encodeURIComponent(prefix);

  let template = config?.telegram?.pluginUrlTemplate;
  if (template) {
    if (template.includes('{slug}')) {
      return String(template)
        .replaceAll('{token}', tokenEnc)
        .replaceAll('{short}', short)
        .replaceAll('{slug}', slug)
        .replaceAll('{prefix}', prefixEnc);
    }
    if (slug) {
      // В шаблоне нет {slug} → внедряем ник перед суффиксом токена.
      template = String(template).replace('{short}', `{slug}_${'{short}'}`);
    }
    return String(template)
      .replaceAll('{token}', tokenEnc)
      .replaceAll('{slug}', slug)
      .replaceAll('{short}', short)
      .replaceAll('{prefix}', prefixEnc);
  }

  const name = slug ? `${slug}_${short}` : short;
  return `${config?.publicBaseUrl || ''}/${prefix}_${name}.js`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

/** Баннер-бренд (конфигурируется через TELEGRAM_BANNER). */
export function bannerText(config) {
  return (config?.telegram?.bannerText || '🎬 MANIYA ONLINE — ваш кино‑плагин для Lampa 🎬').trim();
}

/** Приветствие при входе с указанием остатка подписки. */
export function welcomeLine(user, now, isNew) {
  if (isNew) return '👋 Привет! Добро пожаловать в <b>Maniya Online</b>.';
  return isUserActive(user, now) ? '✅ Ваша подписка активна.' : '🔴 Подписка отключена.';
}

function solutionLine() {
  return '⚙️ Решение проблем: при проблемах — очистите кеш в Lampa\n' +
    '(<code>Настройки → Кеш и данные → Только кеш</code>).';
}

/** Inline-клавиатура: [🎬 Получить ссылку] и [📩 Связь с админом] (если задан контакт). */
export function inlineKeyboard(config, { getLink = true } = {}) {
  const row = [];
  if (getLink) row.push({ text: '🎬 Получить ссылку', callback_data: 'get_link' });
  const contact = config?.telegram?.adminContact;
  if (contact) row.push({ text: '📩 Связь с админом', url: contact });
  return row.length ? { inline_keyboard: [row] } : null;
}

/** Главный ответ: приветствие + оставшиеся дни + ссылка для Lampa + кнопки. */
function linkReply(config, user, isNew, now) {
  if (!user) return { text: '—' };
  const url = pluginUrl(config, user.token, user);
  const text =
    `${bannerText(config)}\n\n` +
    `${welcomeLine(user, now, isNew)}\n\n` +
    `✅ Осталось <b>${daysText(user, now)}</b> до окончания подписки\n\n` +
    `🔗 Ваша ссылка для Lampa:\n` +
    `<code>${escapeHtml(url)}</code>\n\n` +
    `${solutionLine()}`;
  return { text, replyMarkup: inlineKeyboard(config) };
}

function daysText(user, now) {
  const d = isUserActive(user, now) ? daysLeft(user, now) : 0;
  return d === Infinity ? '∞ (без срока)' : `${d} дн.`;
}

function statusText(config, user, now) {
  if (!user) {
    return { text: '🔑 У вас ещё нет подписки.\n\nОтправьте <b>/start</b> чтобы получить бесплатный триал.', replyMarkup: inlineKeyboard(config) };
  }
  const active = isUserActive(user, now);
  const text = `${bannerText(config)}\n\n` +
    `🆔 Токен: <code>${escapeHtml(user.token)}</code>\n` +
    `Статус: ${active ? '🟢 активна' : '🔴 не активна'}\n` +
    `План: ${escapeHtml(user.plan || '—')}\n` +
    `✅ Осталось: ${active ? daysText(user, now) : '0'}\n` +
    `Действует до: ${escapeHtml(expiresLabel(user))}`;
  return { text, replyMarkup: inlineKeyboard(config) };
}

function expiresLabel(user) {
  if (user.expires_at == null) return '∞ (без срока)';
  return new Date(user.expires_at).toISOString();
}

function helpReply(config) {
  const lines = [
    'Доступные команды:',
    '/start — получить ссылку и статус подписки',
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
export async function handleCommand({ text, chatId, config, getUsers = listUsers, setUsers = writeUsers, now = Date.now(), sender }) {
  const raw = String(text || '').trim();
  const parts = raw.split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  const args = parts.slice(1).join(' ');
  const admins = (config?.telegram?.admins || []).map(String);
  const admin = admins.includes(String(chatId || ''));
  const users = (await getUsers()).slice();
  const user = users.find((u) => String(u.telegram_id) === String(chatId));
  const nick = sender?.username || sender?.first_name || sender?.last_name || '';

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
          slug: slugFrom(nick) || shortId(makeToken()),
          active: true,
          plan: config?.telegram?.trialPlan || 'trial',
          expires_at: new Date(now + trialDays * DAY_MS).toISOString()
        };
        users.push(target);
        await setUsers(users);
        fresh = true;
      } else if (!target.slug) {
        // У старых пользователей проставляем ник при следующем /start.
        target.slug = slugFrom(nick) || shortId(target.token);
        await setUsers(users);
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

/**
 * Обработать inline-callback (кнопка). `value` — callback_data/url.
 * @returns {Promise<{text?: string, replyMarkup?: object} | null>} null = только ack
 */
export async function handleCallback({ data, chatId, config, getUsers = listUsers, setUsers = writeUsers, now = Date.now(), sender }) {
  if (data === 'get_link') {
    return handleCommand({ text: '/start', chatId, config, getUsers, setUsers, now, sender });
  }
  return null;
}