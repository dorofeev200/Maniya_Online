// Длинный polling: получает апдейты, диспатчит текстовые сообщения в handleCommand,
// шлёт ответ. Запускается из index.js при TELEGRAM_ENABLED + botToken.
import { logger } from '../logger.js';
import { TelegramBotClient } from './BotClient.js';
import { handleCommand } from './bot.js';

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

  async function processUpdate(update) {
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
    if (reply && reply.text) {
      try {
        await client.sendMessage(chatId, reply.text, { parse_mode: 'HTML' });
      } catch (error) {
        logger.error('telegram_send_failed', { chatId, error: error.message });
      }
    }
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