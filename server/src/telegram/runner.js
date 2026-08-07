// Длинный polling: получает апдейты, диспатчит текстовые сообщения в handleCommand,
// inline-кнопки — в handleCallback, шлёт ответ. Запускается из index.js при TELEGRAM_ENABLED + botToken.
import { logger } from '../logger.js';
import { TelegramBotClient } from './BotClient.js';
import { handleCommand, handleCallback } from './bot.js';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

  async function processUpdate(update) {
    // Inline-кнопка
    if (update.callback_query && update.callback_query.data) {
      const cb = update.callback_query;
      const chatId = cb.from?.id ?? cb.message?.chat?.id;
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
          now: deps.now
        });
        await send(chatId, reply);
      } catch (error) {
        logger.error('telegram_callback_failed', { chatId, error: error.message });
      }
      return;
    }

    // Текстовое сообщение
    const inMessage = update.message || update.edited_message || update.channel_post;
    if (!inMessage) return;
    const chatId = inMessage.chat?.id;
    const text = inMessage.text || inMessage.caption;
    if (chatId === undefined || !text) return;

    let reply;
    try {
      reply = await handleCommand({
        text,
        chatId,
        config,
        getUsers: deps.getUsers,
        setUsers: deps.setUsers,
        now: deps.now
      });
    } catch (error) {
      logger.error('telegram_command_failed', { chatId, error: error.message });
      reply = { text: `Ошибка: ${error.message}. Справка: /help` };
    }
    await send(chatId, reply);
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