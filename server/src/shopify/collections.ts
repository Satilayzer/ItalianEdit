import type { ShopifyClient } from "./client";

/**
 * Гарантирует наличие автоколлекции (smart collection), собирающей товары по тегу.
 * Уже существует с таким названием → возвращает её id, ничего не меняя.
 */
export async function ensureSmartCollection(
  client: ShopifyClient,
  title: string,
  tag: string
): Promise<{ id: string; created: boolean }> {
  const found = await client.graphql<{
    collections: { nodes: { id: string; title: string }[] };
  }>(
    `query FindCollection($q: String!) {
      collections(first: 10, query: $q) { nodes { id title } }
    }`,
    { q: `title:'${title.replace(/'/g, "\\'")}'` }
  );
  const existing = found.collections.nodes.find(
    (c) => c.title.toLowerCase() === title.toLowerCase()
  );
  if (existing) return { id: existing.id, created: false };

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
    {
      input: {
        title,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [{ column: "TAG", relation: "EQUALS", condition: tag }],
        },
      },
    }
  );
  const errors = created.collectionCreate.userErrors;
  if (errors.length > 0 || !created.collectionCreate.collection) {
    throw new Error(
      `Shopify collectionCreate «${title}»: ${errors.map((e) => e.message).join("; ") || "нет коллекции в ответе"}`
    );
  }
  return { id: created.collectionCreate.collection.id, created: true };
}
