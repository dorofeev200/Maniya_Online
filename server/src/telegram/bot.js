// Логика команд бота + выдача подписок. Чистые вычисления (без fetch), чтобы тестировать
// без сети. `getUsers`/`setUsers` — интерфейс хранения (по умолчанию store.js users.json).
import crypto from 'node:crypto';
import { listUsers, writeUsers } from '../store.js';

export function makeToken(prefix = 'mo') {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Клавиатура для администратора: выдать подписку одним нажатием — вместо команды
 * /grant. Прикрепляется к уведомлению о новом пользователе и к квитанции.
 * callback_data: "grant_issue:<telegram_id>:<дней>".
 */
export function adminGrantMarkup(userId) {
  const MONTH_DAYS = 30;
  return {
    inline_keyboard: [[
      { text: '🟢 Выдать подписку (1 мес)', callback_data: `grant_issue:${userId}:${MONTH_DAYS}` }
    ]],
  };
}

/** Выдать/продлить: срок = max(now, текущий срок) + дней. Возвращает пользователя. */
function applyGrant(user, days, now) {
  const cur = user.expires_at ? new Date(user.expires_at).getTime() : 0;
  const base = cur > now ? cur : now;
  user.active = true;
  user.plan = 'full';
  user.expires_at = new Date(base + days * DAY_MS).toISOString();
  return user;
}

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
    else if (ch === '_' || ch === '-' || /\s/.test(ch)) out += '-';
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

/** Человекочитаемый ник пользователя для админ-списка: @slug или id N. */
export function nickLabel(user) {
  if (!user) return '—';
  if (user.slug) return `@${user.slug}`;
  return `id ${user.telegram_id || '—'}`;
}

/** Короткая дата истечения DD.MM.YY (UTC-календарь) для админ-списка; ∞ — бессрочно, — — невалид. */
export function formatExpiry(iso) {
  if (iso == null || iso === '') return '∞';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/**
 * Буква состояния подписки для админ-списка: P — активна (полная/бессрочно),
 * T — триал, X — неактивна (истекла или отключена).
 */
export function planLetter(user, now = Date.now()) {
  if (!user || !user.active) return 'X';
  if (user.expires_at != null && new Date(user.expires_at).getTime() <= now) return 'X';
  return String(user.plan || 'full').toLowerCase() === 'trial' ? 'T' : 'P';
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
  const base = config?.publicBaseUrl || '';

  // Уникальная ссылка пользователя — по его нику, БЕЗ общего префикса.
  if (slug) {
    const template = config?.telegram?.pluginUrlTemplate;
    if (template && template.includes('{slug}')) {
      return String(template)
        .replaceAll('{token}', tokenEnc)
        .replaceAll('{short}', short)
        .replaceAll('{slug}', slug)
        .replaceAll('{prefix}', prefixEnc);
    }
    return `${base}/${slug}_${short}.js`;
  }

  // Без ника — используем префикс (или шаблон).
  const template = config?.telegram?.pluginUrlTemplate;
  if (template) {
    return String(template)
      .replaceAll('{token}', tokenEnc)
      .replaceAll('{short}', short)
      .replaceAll('{prefix}', prefixEnc);
  }
  return `${base}/${prefix}_${short}.js`;
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

/** Inline-клавиатура: [🎬 Получить ссылку], [💳 Оплатить] (если заданы реквизиты),
 * [📩 Связь с админом] (если задан контакт). */
export function inlineKeyboard(config, { getLink = true } = {}) {
  const row = [];
  if (getLink) row.push({ text: '🎬 Получить ссылку', callback_data: 'get_link' });
  if (config?.telegram?.adminContact) row.push({ text: '📩 Связь с админом', url: config.telegram.adminContact });
  if (config?.telegram?.paymentDetails) row.push({ text: '💳 Оплатить', callback_data: 'pay' });
  return row.length ? { inline_keyboard: [row] } : null;
}

/** Клавиатура оплаты/receipt-flow: прикрепить и отправить. */
export function receiptInlineKeyboard() {
  return {
    inline_keyboard: [[
      { text: '📎 Прикрепить квитанцию', callback_data: 'attach_receipt' },
      { text: '📨 Отправить', callback_data: 'send_receipt' }
    ]]
  };
}

/** Ответ с реквизитами оплаты и шагами прикладывания квитанции. */
export function paymentReply(config) {
  const details = config?.telegram?.paymentDetails || 'Реквизиты не заданы (TELEGRAM_PAYMENT_DETAILS).';
  const text =
    '💳 <b>Оплата подписки Maniya Online</b>\n\n' +
    `Реквизиты для оплаты:\n${details}\n\n` +
    'Как продлить:\n' +
    '1) Переведите сумму по реквизитам (укажите срок).\n' +
    '2) Нажмите «📎 Прикрепить квитанцию».\n' +
    '3) Отправьте фото/скриншот перевода.\n' +
    '4) Нажмите «📨 Отправить» — админ подтвердит и продлит подписку.';
  return { text, replyMarkup: receiptInlineKeyboard() };
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
    lines.push('Выдача подписки — кнопкой «🟢 Выдать подписку» в уведомлении о новом пользователе (админ)');
    lines.push('/grant &lt;ник|id|токен&gt; &lt;дней&gt; — выдать/продлить на N дней (админ)');
    lines.push('/revoke &lt;ник|id|токен&gt; — отключить (админ)');
    lines.push('/list — список пользователей (админ)');
  }
  return { text: lines.join('\n') };
}

function findBySubject(users, subject) {
  const s = String(subject || '').trim().replace(/^@/, '');
  if (!s) return null;
  const lower = s.toLowerCase();
  const byToken = users.find((u) => u.token && u.token.toLowerCase() === lower);
  if (byToken) return byToken;
  const byId = users.find((u) => String(u.telegram_id) === s);
  if (byId) return byId;
  // По нику: slug, транслит, или слитая (без дефисов) форма — админ пишет ник
  // как в Telegram: кириллица, регистр, «ё»→«е», подчёркивания/дефисы/пробелы.
  const asSlug = slugFrom(s).toLowerCase();            // 'Иван Иванов' → 'ivan-ivanov'
  const clamped = asSlug.replace(/-/g, '');            // старые slugs слитные: 'ivanivanov'
  return users.find((u) => u.slug && (String(u.slug).toLowerCase() === asSlug ||
    String(u.slug).toLowerCase().replace(/-/g, '') === clamped ||
    String(u.slug).toLowerCase() === lower)) || null;
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
          slug: slugFrom(nick) || undefined,
          active: true,
          plan: config?.telegram?.trialPlan || 'trial',
          expires_at: new Date(now + trialDays * DAY_MS).toISOString()
        };
        users.push(target);
        await setUsers(users);
        fresh = true;
      } else if (!target.slug && nick) {
        // У старых пользователей проставляем ник при следующем /start.
        target.slug = slugFrom(nick) || undefined;
        await setUsers(users);
      }
      const reply = linkReply(config, target, fresh, now);
      if (fresh) {
        // Уведомим администраторов: появился запрос на подписку (триал выдан).
        // Команды /grant больше нет — выдача подписки кнопкой на этом же сообщении.
        const who = target.slug ? `@${target.slug}` : (slugFrom(nick) ? `@${slugFrom(nick)}` : `id ${chatId}`);
        reply.adminNote = {
          text: `🆕 Новый пользователь: ${who} (chat id ${chatId})\n` +
            `Триал: ${target.plan} до ${escapeHtml(expiresLabel(target))}\n` +
            `Выдайте платную подписку кнопкой ниже.`,
          replyMarkup: adminGrantMarkup(chatId)
        };
      }
      return reply;
    }
    case '/status':
      return statusText(config, user, now);
    case '/help':
    case '/commands':
      return helpReply(config);
    case '/list':
    case '/users': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      if (!users.length) return { text: 'Пока нет пользователей.' };
      const rows = users.map((u, i) =>
        `${i + 1}) ${nickLabel(u)} ${formatExpiry(u.expires_at)} ${planLetter(u, now)}\n   ${escapeHtml(u.token)}`
      );
      return { text: `Пользователей: ${users.length}\n` + rows.join('\n') };
    }
    case '/revoke':
    case '/expire':
    case '/suspend': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      const target = findBySubject(users, args);
      if (!target) return { text: 'Не найден пользователь. Указание: @ник / id / токен' };
      target.active = false;
      await setUsers(users);
      return { text: '⛔ Подписка отключена.' };
    }
    case '/grant':
    case '/extend': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      const tokens = args.trim().split(/\s+/);
      const days = Number(tokens[tokens.length - 1]);
      if (tokens.length < 2 || !/^\d+$/.test(tokens[tokens.length - 1]) || days <= 0) {
        return { text: 'Формат: /grant @ник &lt;дней&gt;, например: /grant @dorofeev200 30' };
      }
      const target = findBySubject(users, tokens.slice(0, -1).join(' '));
      if (!target) return { text: 'Не найден пользователь. Указание: @ник / id / токен' };
      applyGrant(target, days, now);
      await setUsers(users);
      const granted = statusText(config, target, now);
      granted.text = `✅ ${nickLabel(target)} → ${formatExpiry(target.expires_at)} ${planLetter(target, now)}\n\n` + granted.text;
      granted.text += `\n🔗 Ссылка плагина:\n<code>${escapeHtml(pluginUrl(config, target.token, target))}</code>`;
      return granted;
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
  const users = (await getUsers()).slice();
  const idx = users.findIndex((u) => String(u.telegram_id) === String(chatId));
  const user = idx >= 0 ? users[idx] : null;

  switch (data) {
    case 'get_link':
      return handleCommand({ text: '/start', chatId, config, getUsers, setUsers, now, sender });
    case 'pay': {
      if (user) { user.awaiting_receipt = true; await setUsers(users); }
      return paymentReply(config);
    }
    case 'attach_receipt': {
      if (!user) return { text: 'Отправьте /start, чтобы получить подписку, затем вновь откройте «Оплатить».' };
      user.awaiting_receipt = true;
      await setUsers(users);
      return {
        text: '📎 Пришлите квитанцию или скриншот перевода (фото или файл).\nЗатем нажмите «📨 Отправить».',
        replyMarkup: receiptInlineKeyboard()
      };
    }
    case 'send_receipt': {
      if (!user) return { text: 'Отправьте /start, чтобы получить подписку.' };
      const fileId = user.receipt_file_id;
      if (!fileId) {
        return {
          text: 'Сначала прикрепите квитанцию: нажмите «📎 Прикрепить квитанцию» и отправьте фото/файл перевода.',
          replyMarkup: receiptInlineKeyboard()
        };
      }
      const who = user.slug ? `@${user.slug}` : `id ${chatId}`;
      const caption = `💳 Квитанция от ${who} (chat id ${chatId})\n\nВыдача/продление подписки — кнопкой ниже.`;
      user.awaiting_receipt = false;
      user.receipt_file_id = '';
      user.receipt_caption = '';
      await setUsers(users);
      return {
        text: '✅ Квитанция отправлена администратору.\nАдмин подтвердит оплату и продлит подписку.',
        adminNotePhoto: { fileId, caption, replyMarkup: adminGrantMarkup(chatId) }
      };
    }
    default: {
      // Кнопка выдачи подписки для админа: grant_issue:<telegram_id>:<дней>.
      const m = data.match(/^grant_issue:(\d+):(\d+)$/);
      if (!m) return null;
      const isAdmin = (config?.telegram?.admins || []).some((a) => String(a) === String(chatId));
      if (!isAdmin) return { text: 'Команда только для админ‑чата.' };
      const target = users.find((u) => String(u.telegram_id) === m[1]);
      if (!target) return { text: 'Пользователь не найден. Список: /list' };
      applyGrant(target, Number(m[2]), now);
      await setUsers(users);
      const granted = statusText(config, target, now);
      granted.text += `\n\n🔗 Ссылка плагина:\n<code>${escapeHtml(pluginUrl(config, target.token, target))}</code>`;
      return granted;
    }
  }
}