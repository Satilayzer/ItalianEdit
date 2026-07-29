/**
 * Публикация правовых страниц магазина из src/shopify/policies.ts.
 *
 *   npx tsx scripts/setup-policies.ts            # показать, что будет опубликовано
 *   npx tsx scripts/setup-policies.ts --export   # выгрузить HTML в docs/policies/
 *   npx tsx scripts/setup-policies.ts --apply    # опубликовать через API
 *
 * Для --apply приложению нужен скоуп `write_legal_policies`; без него Shopify
 * отвечает отказом. Пока скоупа нет — выгрузите файлы через --export и вставьте
 * их в админке: Settings → Policies.
 *
 * Тексты живут в репозитории: это обещания покупателю, их правки должны быть
 * видны в истории. Скрипт идемпотентен — публикует то, что лежит в policies.ts,
 * поэтому источник правды один, а не «где-то в админке».
 *
 * Privacy Policy скрипт НЕ трогает: там стоит официальный шаблон Shopify
 * с подстановками и блоками под GDPR/CCPA, он полнее самописного.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { POLICIES, TERMS, CONTACT } from "../src/shopify/policies";

const apply = process.argv.includes("--apply");
const exportOnly = process.argv.includes("--export");

if (exportOnly) {
  // Запасной путь, пока у приложения нет скоупа write_legal_policies:
  // файлы вставляются в админку вручную, текст остаётся тем же самым.
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "policies");
  mkdirSync(outDir, { recursive: true });
  for (const p of POLICIES) {
    const file = join(outDir, `${p.type.toLowerCase().replace(/_/g, "-")}.html`);
    writeFileSync(file, `${p.body.trim()}\n`, "utf8");
    console.log(`${p.title} → ${file}`);
  }
  console.log("\nВставить: Shopify admin → Settings → Policies.");
  process.exit(0);
}

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

const UPDATE = /* GraphQL */ `
  mutation SetPolicy($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy { type url }
      userErrors { field message }
    }
  }
`;

if (!apply) {
  console.log("Условия, зашитые в тексты (правятся в src/shopify/policies.ts):\n");
  for (const [key, value] of Object.entries(TERMS)) console.log(`  ${key}: ${value}`);
  console.log("\nКонтакты:\n");
  for (const [key, value] of Object.entries(CONTACT)) console.log(`  ${key}: ${value}`);
  console.log("\nБудут опубликованы:\n");
  for (const p of POLICIES) {
    const words = p.body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    console.log(`  · ${p.title} (${p.type}) — ${words} слов`);
  }
  console.log("\nPrivacy Policy не трогаем: там официальный шаблон Shopify.");
  console.log("\nОпубликовать: npx tsx scripts/setup-policies.ts --apply");
  process.exit(0);
}

for (const p of POLICIES) {
  const res = await client.graphql<{
    shopPolicyUpdate: {
      shopPolicy: { type: string; url: string } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(UPDATE, { shopPolicy: { type: p.type, body: p.body } });

  const errors = res.shopPolicyUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    console.error(`✗ ${p.title}: ${errors.map((e) => e.message).join("; ")}`);
    continue;
  }
  console.log(`✓ ${p.title} — ${res.shopPolicyUpdate.shopPolicy?.url ?? "опубликована"}`);
}
