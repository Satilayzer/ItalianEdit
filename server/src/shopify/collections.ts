import type { ShopifyClient } from "./client";

interface Rule {
  column: string;
  relation: string;
  condition: string;
}

function isSingleTagRule(rules: Rule[], tag: string): boolean {
  return (
    rules.length === 1 &&
    rules[0].column === "TAG" &&
    rules[0].relation === "EQUALS" &&
    rules[0].condition === tag
  );
}

/**
 * Гарантирует автоколлекцию (smart collection), собирающую товары по одному тегу.
 * Нет — создаёт; есть, но правило указывает на другой тег — приводит к нужному
 * (иначе после смены формата тегов коллекция осталась бы пустой).
 */
export async function ensureSmartCollection(
  client: ShopifyClient,
  title: string,
  tag: string
): Promise<{ id: string; created: boolean; updated: boolean }> {
  const found = await client.graphql<{
    collections: {
      nodes: { id: string; title: string; ruleSet: { rules: Rule[] } | null }[];
    };
  }>(
    `query FindCollection($q: String!) {
      collections(first: 10, query: $q) {
        nodes { id title ruleSet { rules { column relation condition } } }
      }
    }`,
    { q: `title:'${title.replace(/'/g, "\\'")}'` }
  );
  const existing = found.collections.nodes.find(
    (c) => c.title.toLowerCase() === title.toLowerCase()
  );

  const ruleSet = {
    appliedDisjunctively: false,
    rules: [{ column: "TAG", relation: "EQUALS", condition: tag }],
  };

  if (existing) {
    if (isSingleTagRule(existing.ruleSet?.rules ?? [], tag)) {
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
