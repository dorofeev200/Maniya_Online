// Telegram Bot API client (zero-dep, длинный polling).
// Методы — изолированные, получают реализацию fetch снаружи для тестов.

const DEFAULT_FINISH = 120_000; // бездействие между опросами

export class TelegramBotClient {
  /**
   * @param {object} options
   * @param {string} options.botToken            токен от @BotFather
   * @param {string} options.apiBase             https://api.telegram.org
   * @param {number} options.pollTimeoutSeconds   Telegram long-polling timeout
   * @param {(method, params) => Promise<Response>} [options.fetchFn]  fetch-обёртка для тестов
   * @param {import('./orders.js')?...}
   */
  constructor({ botToken, apiBase = 'https://api.telegram.org', pollTimeoutSeconds = 60, fetchFn } = {}) {
    this.botToken = botToken || '';
    this.apiBase = String(apiBase || 'https://api.telegram.org').replace(/\/+$/, '');
    this.fetchImpl = fetchFn || (async (method, params) => {
      const url = new URL(`/bot${encodeURIComponent(this.botToken)}/${method}`, this.apiBase);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params)
      });
      return res;
    });
  }

  tokenOk() {
    return Boolean(this.botToken);
  }

  async api(method, params = {}) {
    const res = await this.fetchImpl(method, params);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok) {
      throw new Error(`telegram_${method}_failed: HTTP ${res.status} ${(json && json.description) || text.slice(0, 160)}`);
    }
    if (json && json.ok === true) return json.result;
    // ok:false (напр. «Conflict: terminated by other getUpdates» при 200).
    if (json && json.ok === false) return { error: json.description || 'telegram_error' };
    return json;
  }

  /** Один длинный опрос (timeout держит соединение на сервере). */
  async getUpdates({ offset = 0, timeout = this.pollSeconds() } = {}) {
    try {
      const result = await this.api('getUpdates', { offset, timeout });
      if (result && result.error) return { error: result.error };
      return Array.isArray(result) ? result : [];
    } catch (error) {
      return { error: error.message };
    }
  }

  pollSeconds() { return 60; }

  async sendMessage(chatId, text, extra = {}) {
    return this.api('sendMessage', { chat_id: chatId, text: String(text || ''), ...extra });
  }
}