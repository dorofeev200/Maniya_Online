// Логика команд бота + выдача подписок. Чистые вычисления (без fetch), чтобы тестировать
// без сети. `getUsers`/`setUsers` — интерфейс хранения (по умолчанию store.js users.json).
import crypto from 'node:crypto';
import { listUsers, writeUsers } from '../store.js';

export function makeToken(prefix = 'mo') {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Дата "ДД.ММ.ГГ" / "ДД.ММ.ГГГГ" (разделители . / -) → ISO-конца указанного дня
 * (23:59:59.999 по местному времени). null при мусоре/несуществующей дате
 * (32.13.2026, 31.02.2026). Двухзначный год: <70 → 20xx, иначе 19xx.
 */
export function parseDateArg(value) {
  const s = String(value || '').trim();
  const match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (String(match[3]).length === 2) year = year < 70 ? 2000 + year : 1900 + year;
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) return null;
  return end.toISOString();
}

/** План из короткого токена админа: "P"/"p"/"plugin" = полный (плагин), иначе — как написано. */
export function normalizePlan(token) {
  const t = String(token || '').trim();
  if (!t) return 'full';
  const lower = t.toLowerCase();
  if (lower === 'p' || lower === 'plugin') return 'full';
  return t;
}

/**
 * Разобрать хвост /grant: "<дата|дни> [план]".
 *   "/grant 5"            → +5 дней от now, план full
 *   "/grant 08.08.26"     → конец 08.08.2026, план full
 *   "/grant 08.08.26 P"   → конец 08.08.2026, план full (P = плагин)
 * Без даты → бессрочно (null), как раньше.
 */
export function parseGrantArgs(args = [], now = Date.now()) {
  const [dateArg, planArg] = args;
  let expires_at = null;
  if (dateArg) {
    const byDate = parseDateArg(dateArg);
    if (byDate) {
      expires_at = byDate;
    } else if (/^\d+$/.test(dateArg)) {
      // Дни — только целое число; невалидная дата (31.02.2026) НЕ читается как «31 дней».
      const days = Number.parseInt(dateArg, 10);
      if (Number.isFinite(days) && days > 0) expires_at = new Date(now + days * DAY_MS).toISOString();
    }
  }
  const plan = planArg ? normalizePlan(planArg) : 'full';
  return { expires_at, plan };
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
    lines.push('/grant &lt;@ник|id|токен&gt; ДД.ММ.ГГ [P] — выдать/продлить до даты (админ)');
    lines.push('  P = плагин; вариант "/grant @ник 30" — на 30 дней');
    lines.push('/revoke &lt;ник|id|токен&gt; — отключить (админ)');
    lines.push('/list — список пользователей (админ)');
    lines.push('Новый пользователь пишет /start → админ получит уведомление и выдаст /grant @ник 08.08.26 P');
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
  const asSlug = slugFrom(s).toLowerCase();
  const clamped = lower.replace(/-/g, '');
  return users.find((u) => u.slug && (String(u.slug).toLowerCase() === asSlug ||
    String(u.slug).toLowerCase().replace(/-/g, '') === clamped ||
    String(u.slug).toLowerCase() === lower)) || null;
}

/**
 * Разбор хвоста /grant: "<субъект> [дата|дни] [план]".
 * План — последний токен, если это не дата и не число; срок — токен перед ним.
 * Субъект (начинается с @) может быть с пробелами: всё, что осталось до срока.
 */
export function splitGrantArgs(args) {
  const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
  let plan = null;
  let expiry = null;
  const last = tokens[tokens.length - 1];
  if (last && /^[a-zA-Z]{1,12}$/.test(last)) {
    plan = last;
    tokens.pop();
  }
  const prev = tokens[tokens.length - 1];
  if (prev && (parseDateArg(prev) || /^\d+$/.test(prev))) {
    expiry = prev;
    tokens.pop();
  }
  return { subject: tokens.join(' '), expiry, plan };
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
        const who = target.slug ? `@${target.slug}` : (slugFrom(nick) ? `@${slugFrom(nick)}` : `id ${chatId}`);
        const grantVia = target.slug ? `@${target.slug}` : (slugFrom(nick) ? `@${slugFrom(nick)}` : String(chatId));
        reply.adminNote =
          `🆕 Новый пользователь: ${who} (chat id ${chatId})\n` +
          `Триал: ${target.plan} до ${escapeHtml(expiresLabel(target))}\n` +
          `Продлить: /grant ${grantVia} 08.08.26 P`;
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
        `${i + 1}) ${u.slug ? '@' + u.slug : '—'} | id ${u.telegram_id} | ` +
        `${u.active ? (isUserActive(u, now) ? '🟢 активна' : '🔴 истекла') : '⛔ отключена'} | ` +
        `${daysText(u, now)} | ${escapeHtml(u.plan || '—')}\n   ${escapeHtml(u.token)}`
      );
      return { text: `Пользователей: ${users.length}\n` + rows.join('\n') };
    }
    case '/grant':
    case '/subscribe':
    case '/extend':
    case '/give': {
      if (!admin) return { text: 'Команда только для админ‑чата.' };
      const { subject, expiry, plan } = splitGrantArgs(args);
      const target = findBySubject(users, subject);
      if (!target) {
        return {
          text: `Не найден пользователь для «${escapeHtml(subject)}».\n` +
            `Точный @ник смотри в <b>/list</b>, или используй id/токен.\n` +
            `Пример: /grant @vasya 08.08.26 P`
        };
      }
      const { expires_at, plan: defaultPlan } = parseGrantArgs([expiry], now);
      target.expires_at = expires_at;
      target.plan = plan ? normalizePlan(plan) : defaultPlan;
      target.active = true;
      await setUsers(users);
      const granted = statusText(config, target, now);
      granted.text += `\n\n🔗 Ссылка плагина:\n<code>${escapeHtml(pluginUrl(config, target.token, target))}</code>`;
      return granted;
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
      const caption = `💳 Квитанция от ${who} (chat id ${chatId})\n\nПродлить подписку: /grant ${chatId} 08.08.26 P`;
      user.awaiting_receipt = false;
      user.receipt_file_id = '';
      user.receipt_caption = '';
      await setUsers(users);
      return {
        text: '✅ Квитанция отправлена администратору.\nАдмин подтвердит оплату и продлит подписку.',
        adminNotePhoto: { fileId, caption }
      };
    }
    default:
      return null;
  }
}