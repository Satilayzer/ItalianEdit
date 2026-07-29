import type { ShopifyClient } from "./client";

interface Rule {
  column: string;
  relation: string;
  condition: string;
}

interface RuleSet {
  appliedDisjunctively: boolean;
  rules: Rule[];
}

/**
 * Совпадает ли текущее правило коллекции с желаемым набором тегов.
 * Порядок правил Shopify не гарантирует, поэтому сравниваем множествами.
 */
function sameRuleSet(existing: RuleSet | null, wanted: RuleSet): boolean {
  if (!existing) return false;
  if (existing.appliedDisjunctively !== wanted.appliedDisjunctively) return false;
  if (existing.rules.length !== wanted.rules.length) return false;

  const key = (r: Rule) => `${r.column}|${r.relation}|${r.condition}`;
  const have = new Set(existing.rules.map(key));
  return wanted.rules.every((r) => have.has(key(r)));
}

/**
 * Гарантирует автоколлекцию (smart collection), собирающую товары по тегам.
 * Нет — создаёт; есть, но правило другое — приводит к нужному (иначе после
 * смены формата тегов коллекция осталась бы пустой).
 *
 * Тегов может быть несколько: категорийные коллекции ловят И формат приложения
 * BrandsGateway («Jewellery - Accessories»), И легаси-формат бота
 * («category:jewelry»). Несколько тегов объединяются через ИЛИ
 * (appliedDisjunctively) — товару достаточно одного.
 */
export async function ensureSmartCollection(
  client: ShopifyClient,
  title: string,
  tags: string | string[]
): Promise<{ id: string; created: boolean; updated: boolean }> {
  const tagList = (Array.isArray(tags) ? tags : [tags]).filter((t) => t.trim() !== "");
  if (tagList.length === 0) {
    throw new Error(`ensureSmartCollection «${title}»: не передано ни одного тега`);
  }

  const found = await client.graphql<{
    collections: {
      nodes: { id: string; title: string; ruleSet: RuleSet | null }[];
    };
  }>(
    `query FindCollection($q: String!) {
      collections(first: 10, query: $q) {
        nodes {
          id
          title
          ruleSet { appliedDisjunctively rules { column relation condition } }
        }
      }
    }`,
    { q: `title:'${title.replace(/'/g, "\\'")}'` }
  );
  const existing = found.collections.nodes.find(
    (c) => c.title.toLowerCase() === title.toLowerCase()
  );

  const ruleSet: RuleSet = {
    // Один тег — условие одно, дизъюнкция ничего не меняет, но Shopify
    // хранит флаг как есть, поэтому держим его предсказуемым.
    appliedDisjunctively: tagList.length > 1,
    rules: tagList.map((tag) => ({
      column: "TAG",
      relation: "EQUALS",
      condition: tag,
    })),
  };

  if (existing) {
    if (sameRuleSet(existing.ruleSet, ruleSet)) {
      return { id: existing.id, created: false, updated: false };
    }
    const updated = await client.graphql<{
      collectionUpdate: {
        collection: { id: string } | null;
        userErrors: { field?: string[]; message: string }[];
      };
    }>(
      `mutation UpdateSmartCollection($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection { id }
          userErrors { field message }
        }
      }`,
      { input: { id: existing.id, ruleSet } }
    );
    const uerrs = updated.collectionUpdate.userErrors;
    if (uerrs.length > 0) {
      throw new Error(
        `Shopify collectionUpdate «${title}»: ${uerrs.map((e) => e.message).join("; ")}`
      );
    }
    return { id: existing.id, created: false, updated: true };
  }

  const created = await client.graphql<{
    collectionCreate: {
      collection: { id: string } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `mutation CreateSmartCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id }
        userErrors { field message }
      }
    }`,
    { input: { title, ruleSet } }
  );
  const errors = created.collectionCreate.userErrors;
  if (errors.length > 0 || !created.collectionCreate.collection) {
    throw new Error(
      `Shopify collectionCreate «${title}»: ${errors.map((e) => e.message).join("; ") || "нет коллекции в ответе"}`
    );
  }
  return { id: created.collectionCreate.collection.id, created: true, updated: false };
}
