/**
 * Алерты в телеграм-группу менеджеров напрямую через Bot API
 * (без завязки на grammY — просто HTTP, легко тестировать).
 * chat_id группы можно узнать командой /chatid у нашего бота.
 */
export function makeAlerter(
  botToken: string,
  chatId: string | undefined,
  fetchFn: typeof fetch = fetch
): (text: string) => Promise<void> {
  return async (text: string) => {
    if (!chatId) {
      console.warn("ALERT (ALERT_CHAT_ID не задан):", text);
      return;
    }
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error("Не удалось отправить алерт в ТГ:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Не удалось отправить алерт в ТГ:", err);
    }
  };
}
