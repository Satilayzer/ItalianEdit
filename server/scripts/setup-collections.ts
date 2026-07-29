/**
 * Приводит автоколлекции магазина к нужным правилам:
 *   npx tsx scripts/setup-collections.ts
 *
 * Скрипт идемпотентен: совпадающие правила не трогает, разошедшиеся исправляет,
 * отсутствующие коллекции создаёт.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { ensureSmartCollection } from "../src/shopify/collections";
import { TG_COLLECTION_TAG } from "../src/shopify/draftProduct";
import { warehouseTag } from "../src/shopify/warehouse";
import { genderTags } from "../src/shopify/gender";

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

// Служебные коллекции. Теги берём из тех же функций, что тегируют товары, —
// чтобы витрина и товары не рассинхронились по формату (EU/US, Women/Men).
const service: { title: string; tags: string[] }[] = [
  { title: "Italian Edit", tags: [TG_COLLECTION_TAG] },
  { title: "Ships from Europe", tags: [warehouseTag("eu")] },
  { title: "Ships from USA", tags: [warehouseTag("us")] },
  { title: "Women", tags: [genderTags("women")[0]] },
  { title: "Men", tags: [genderTags("men")[0]] },
];

/**
 * Категорийные коллекции ловят ДВА формата тегов: приложения BrandsGateway
 * («Sweaters - Clothing») и легаси-формат бота («category:sweaters»).
 * Без первого коллекция пустует при импорте BG, без второго — теряет товары бота.
 *
 * Теги BG выписаны с фактических товаров магазина. Помеченные (?) —
 * предположение по образцу соседей: таких товаров в каталоге ещё не было,
 * проверить будет можно только на живом импорте. Ошибка тут безвредна —
 * коллекция и так пуста, а угаданный верно тег заработает сам.
 */
const categories: { title: string; tags: string[] }[] = [
  { title: "Bags", tags: ["Bags", "category:bags"] },
  { title: "Shoes", tags: ["Shoes", "category:shoes"] },
  { title: "Clothing", tags: ["Clothing", "category:clothing"] },
  { title: "Accessories", tags: ["Accessories", "category:accessories"] },
  { title: "Dresses", tags: ["Dresses - Clothing", "category:dresses"] },
  { title: "Tops", tags: ["Shirts - Clothing", "category:tops"] },
  { title: "Jeans", tags: ["Jeans Denim - Clothing", "category:jeans"] },
  { title: "Sweaters", tags: ["Sweaters - Clothing", "category:sweaters"] },
  { title: "Jackets & Blazers", tags: ["Jackets - Clothing", "category:jackets"] },
  { title: "Pants", tags: ["Pants - Clothing", "category:pants"] },
  { title: "Skirts", tags: ["Skirts - Clothing", "category:skirts"] },
  // Была пуста, хотя товар с тегом BG в каталоге есть: правило ловило только бота.
  { title: "Jewelry", tags: ["Jewellery - Accessories", "category:jewelry"] },
  { title: "Shorts", tags: ["Shorts - Clothing" /* ? */, "category:shorts"] },
  { title: "Swimsuits & Cover-Ups", tags: ["Swimwear - Clothing" /* ? */, "category:swimwear"] },
  { title: "Lingerie", tags: ["Lingerie - Clothing" /* ? */, "category:lingerie"] },
  { title: "Pajamas & Robes", tags: ["Sleepwear - Clothing" /* ? */, "category:pajamas"] },
  { title: "Matching Sets", tags: ["Matching Sets - Clothing" /* ? */, "category:matching-sets"] },
  // Kids у BG — это, скорее всего, отдельное измерение (пол/возраст), а не
  // категория. Пока тега не видели — не выдумываем, оставляем только бота.
  { title: "Kids", tags: ["category:kids"] },
];

for (const c of [...service, ...categories]) {
  const res = await ensureSmartCollection(client, c.title, c.tags);
  const state = res.created
    ? "создана"
    : res.updated
      ? "правило исправлено"
      : "уже актуальна";
  console.log(`Коллекция «${c.title}» (${res.id}) — ${c.tags.join(" | ")}: ${state}`);
}
