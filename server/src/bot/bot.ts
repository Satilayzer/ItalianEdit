import { Bot, Context } from "grammy";
import type { Config } from "../config";
import type { ManagerRequest, ProductInfo } from "../types";
import { parseManagerMessage, looksLikeRequest } from "./parse";
import { formatCard, HELP_TEXT, esc } from "./format";
import { findProduct } from "../search/findProduct";
import { ShopifyClient } from "../shopify/client";
import { buildDraftInput, createDraftProduct } from "../shopify/draftProduct";

export interface BotDeps {
  /** Единый клиент Shopify (создаётся один раз — держит кэш 24-часового токена). */
  shopify?: ShopifyClient;
}

/**
 * Создаёт черновик товара в Shopify из найденных данных.
 * Возвращает строку-статус для карточки в Телеграме.
 */
async function tryCreateDraft(
  config: Config,
  client: ShopifyClient | undefined,
  req: ManagerRequest,
  info: ProductInfo
): Promise<string> {
  if (!client) {
    return "📝 Shopify не подключён — черновик не создан (нужны ключи Shopify в .env).";
  }
  try {
    const input = buildDraftInput(req, info, config.defaultCurrency);
    const draft = await createDraftProduct(client, input);
    const compareNote =
      input.compareAtPrice === undefined && info.price
        ? "\n⚠️ Цена бренда в другой валюте — зачёркнутую цену не поставил, проверьте в черновике."
        : "";
    return `📝 <a href="${draft.adminUrl}">Черновик создан в Shopify</a> — проверьте и опубликуйте.${compareNote}`;
  } catch (err) {
    console.error("Ошибка создания черновика в Shopify:", err);
    return "⚠️ Не удалось создать черновик в Shopify — детали в логах сервера.";
  }
}

async function handleRequest(
  ctx: Context,
  text: string,
  config: Config,
  deps: BotDeps
) {
  const req = parseManagerMessage(text, config.defaultCurrency);
  if (!req) {
    await ctx.reply("Не понял формат. " + HELP_TEXT, { parse_mode: "HTML" });
    return;
  }

  const progress = await ctx.reply(
    `🔎 Ищу «${req.title}» от ${req.designer} на сайте бренда…`,
    { reply_parameters: { message_id: ctx.msg!.message_id } }
  );

  try {
    const result = await findProduct(req, config);
    if (!result.info) {
      const message =
        result.failure === "unknown-designer"
          ? `❌ Не смог определить официальный сайт дизайнера «${esc(req.designer)}». ` +
            "Проверьте написание бренда (латиницей, как пишет сам бренд) и попробуйте ещё раз."
          : `❌ Не нашёл «${esc(req.title)}» на официальном сайте ` +
            `${esc(result.domain ?? req.designer)}. ` +
            "Проверьте точное название с сайта бренда — ищу я только на официальных сайтах.";
      await ctx.api.editMessageText(progress.chat.id, progress.message_id, message, {
        parse_mode: "HTML",
      });
      return;
    }
    const info = result.info;

    const draftStatus = await tryCreateDraft(config, deps.shopify, req, info);
    const caption = formatCard(req, info) + "\n\n" + draftStatus;
    if (info.images.length > 0) {
      try {
        await ctx.replyWithPhoto(info.images[0], {
          caption,
          parse_mode: "HTML",
          reply_parameters: { message_id: ctx.msg!.message_id },
        });
        await ctx.api.deleteMessage(progress.chat.id, progress.message_id);
        return;
      } catch {
        // Телеграм не смог скачать фото — отправим текстом ниже
      }
    }
    await ctx.api.editMessageText(progress.chat.id, progress.message_id, caption, {
      parse_mode: "HTML",
      link_preview_options: { url: info.url },
    });
  } catch (err) {
    console.error("Ошибка при поиске товара:", err);
    await ctx.api.editMessageText(
      progress.chat.id,
      progress.message_id,
      "⚠️ Что-то пошло не так при поиске. Попробуйте ещё раз чуть позже."
    );
  }
}

export function createBot(config: Config, deps: BotDeps = {}): Bot {
  const bot = new Bot(config.botToken);

  bot.command(["start", "help"], (ctx) =>
    ctx.reply("Привет! Я ищу товары на сайтах брендов и сравниваю цены.\n\n" + HELP_TEXT, {
      parse_mode: "HTML",
    })
  );

  bot.command("check", (ctx) => handleRequest(ctx, ctx.msg.text, config, deps));

  // Узнать chat_id группы — нужен для ALERT_CHAT_ID в .env
  bot.command("chatid", (ctx) =>
    ctx.reply(`chat_id этого чата: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" })
  );

  // Обычные сообщения в группе: реагируем только на похожие на наш формат
  // (нужен выключенный privacy mode у бота — /setprivacy в @BotFather).
  bot.on("message:text", (ctx) => {
    if (looksLikeRequest(ctx.msg.text)) {
      return handleRequest(ctx, ctx.msg.text, config, deps);
    }
  });

  bot.catch((err) => console.error("Ошибка бота:", err));
  return bot;
}
