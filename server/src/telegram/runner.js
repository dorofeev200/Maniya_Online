// Длинный polling: получает апдейты, диспатчит текстовые сообщения в handleCommand,
// inline-кнопки — в handleCallback, шлёт ответ. Запускается из index.js при TELEGRAM_ENABLED + botToken.
import { logger } from '../logger.js';
import { TelegramBotClient } from './BotClient.js';
import { handleCommand, handleCallback, receiptInlineKeyboard } from './bot.js';
import { listUsers, writeUsers } from '../store.js';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Имя/ник отправителя из telegram-user ({username, first_name, last_name}). */
function pickSenderName(from) {
  if (!from) return undefined;
  return {
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name
  };
}

export function createTelegramRunner(config, deps = {}) {
  const client = deps.client || new TelegramBotClient({
    botToken: config.telegram.botToken,
    apiBase: config.telegram.apiBase,
    pollTimeoutSeconds: config.telegram.pollTimeoutSeconds,
    fetchFn: deps.fetchFn
  });

  let offset = 0;
  let stopped = false;

  async function send(chatId, reply) {
    if (!reply || !reply.text) return;
    const extra = { parse_mode: 'HTML' };
    if (reply.replyMarkup) extra.reply_markup = reply.replyMarkup;
    try {
      await client.sendMessage(chatId, reply.text, extra);
    } catch (error) {
      logger.error('telegram_send_failed', { chatId, error: error.message });
    }
  }

  // Разослать администраторам: текстовое adminNote и/или фото квитанции adminNotePhoto.
  // adminNotePhoto.replyMarkup — кнопка выдачи подписки (вместо /grant).
  async function notifyAdmins(reply, chatId) {
    const admins = Array.isArray(config.telegram.admins) ? config.telegram.admins : [];
    for (const adminId of admins) {
      if (String(adminId) === String(chatId)) continue;
      if (reply.adminNotePhoto) {
        const photoMarkup = reply.adminNotePhoto.replyMarkup
          ? { reply_markup: reply.adminNotePhoto.replyMarkup } : {};
        try {
          await client.sendPhoto(adminId, reply.adminNotePhoto.fileId, reply.adminNotePhoto.caption, photoMarkup);
        } catch (error) {
          logger.error('telegram_admin_photo_failed', { admin: adminId, error: error.message });
          try { await send(adminId, { text: (reply.adminNotePhoto.caption || '') }); } catch (e) {}
        }
      } else if (reply.adminNote) {
        // adminNote — { text, replyMarkup } (кнопка выдачи) или строка совместимости.
        await send(adminId, typeof reply.adminNote === 'string' ? { text: reply.adminNote } : reply.adminNote);
      }
    }
  }

  async function processUpdate(update) {
    // Inline-кнопка
    if (update.callback_query && update.callback_query.data) {
      const cb = update.callback_query;
      const chatId = cb.from?.id ?? cb.message?.chat?.id;
      const sender = cb.from ? pickSenderName(cb.from) : undefined;
      try {
        await client.api('answerCallbackQuery', { callback_query_id: cb.id });
      } catch (error) {
        logger.warn('telegram_answer_callback_failed', { error: error.message });
      }
      if (chatId === undefined) return;
      try {
        const reply = await handleCallback({
          data: cb.data,
          chatId,
          config,
          getUsers: deps.getUsers,
          setUsers: deps.setUsers,
          now: deps.now,
          sender
        });
        await send(chatId, reply);
        await notifyAdmins(reply, chatId);
      } catch (error) {
        logger.error('telegram_callback_failed', { chatId, error: error.message });
      }
      return;
    }

    // Сообщение (текст или фото/файл — квитанция при оплате).
    const inMessage = update.message || update.edited_message || update.channel_post;
    if (!inMessage) return;
    const chatId = inMessage.chat?.id;
    if (chatId === undefined) return;

    const sender = inMessage.from ? pickSenderName(inMessage.from) : undefined;

    // Фото/документ: если пользователь в режиме оплаты (нажал «Прикрепить квитанцию»)
    // — сохраняем file_id и предлагаем «Отправить».
    if (inMessage.photo || inMessage.document) {
      const users = (await (deps.getUsers || listUsers)()).slice();
      const u = users.find((x) => String(x.telegram_id) === String(chatId));
      const fileId = inMessage.photo
        ? inMessage.photo[inMessage.photo.length - 1].file_id
        : (inMessage.document && inMessage.document.file_id);
      if (u && u.awaiting_receipt && fileId) {
        u.receipt_file_id = fileId;
        u.receipt_caption = inMessage.caption || '';
        await (deps.setUsers || writeUsers)(users);
        await send(chatId, {
          text: '📎 Квитанция прикреплена. Нажмите «📨 Отправить», чтобы передать её админу.',
          replyMarkup: receiptInlineKeyboard()
        });
      }
      return;
    }

    const text = inMessage.text || inMessage.caption;
    if (!text) return;

    let reply;
    try {
      reply = await handleCommand({
        text,
        chatId,
        config,
        getUsers: deps.getUsers,
        setUsers: deps.setUsers,
        now: deps.now,
        sender
      });
    } catch (error) {
      logger.error('telegram_command_failed', { chatId, error: error.message });
      reply = { text: `Ошибка: ${error.message}. Справка: /help` };
    }
    await send(chatId, reply);

    // Новый пользователь / квитанция → уведомляем админов.
    await notifyAdmins(reply, chatId);
  }

  async function pollOnce() {
    const result = await client.getUpdates({ offset, timeout: config.telegram.pollTimeoutSeconds ?? 60 });
    if (result && result.error) {
      logger.warn('telegram_getupdates_error', { error: result.error });
      return false;
    }
    if (!Array.isArray(result)) return false;
    for (const update of result) {
      const next = Number(update.update_id) + 1;
      if (next > offset) offset = next;
      await processUpdate(update);
    }
    return true;
  }

  const STEP = 1500;

  async function loop() {
    logger.info('telegram_polling_started', { admins: config.telegram.admins });
    try {
      while (!stopped) {
        try { await pollOnce(); }
        catch (error) { logger.error('telegram_poll_once_error', { error: error.message }); await sleep(STEP); }
      }
    } finally {
      logger.info('telegram_polling_stopped');
    }
  }

  let promise = null;
  return {
    start() {
      if (!promise) promise = loop();
      return this;
    },
    stop() { stopped = true; return this; },
    pollOnce,
    get offset() { return offset; }
  };
}