import type { ShopifyClient } from "./client";
import type { ManagerRequest, ProductInfo } from "../types";

/** Данные для черновика товара в Shopify. */
export interface DraftInput {
  title: string;
  descriptionHtml?: string;
  vendor: string;
  tags: string[];
  imageUrls: string[];
  /** Наша цена (из Телеграма) — цена товара. */
  price: number;
  /** Цена с сайта бренда — зачёркнутая «до скидки». Только если валюта совпадает с нашей. */
  compareAtPrice?: number;
}

export interface DraftResult {
  productId: string;
  adminUrl: string;
}

const MAX_IMAGES = 8;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Секции со страницы бренда → HTML для описания Shopify (списки построчно). */
export function sectionsToHtml(
  sections?: { heading: string; text: string }[]
): string {
  if (!sections || sections.length === 0) return "";
  return sections
    .map((s) => {
      const lines = s.text.split("\n").map((l) => escapeHtml(l.trim())).filter(Boolean);
      const body =
        lines.length > 1
          ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`
          : `<p>${lines[0] ?? ""}</p>`;
      return `<h4>${escapeHtml(s.heading)}</h4>${body}`;
    })
    .join("");
}

/** Тег, по которому автоколлекция «Italian Edit» собирает товары из ТГ-группы. */
export const TG_COLLECTION_TAG = "italian-edit";
/** Тег для машинной обработки: доставка ручная, из Италии (не через BrandsGateway). */
export const TG_DELIVERY_TAG = "delivery:manual-italy";
/** Пометка покупателю в описании товара. */
export const DELIVERY_NOTE_HTML =
  "<p><em>Shipped directly from Italy \u{1F1EE}\u{1F1F9}</em></p>";

/**
 * Собирает DraftInput из запроса менеджера и данных с сайта бренда.
 * compareAtPrice ставим только при совпадении валют — в Shopify обе цены
 * в валюте магазина, и «скидка» из чужой валюты вводила бы покупателя в заблуждение.
 */
export function buildDraftInput(
  req: ManagerRequest,
  info: ProductInfo,
  storeCurrency: string
): DraftInput {
  const sameCurrency =
    info.currency !== undefined &&
    info.currency.toUpperCase() === storeCurrency.toUpperCase() &&
    req.currency.toUpperCase() === storeCurrency.toUpperCase();

  const description = info.description
    ? `<p>${escapeHtml(info.description)}</p>`
    : "";

  return {
    // Вариация в названии: у каждой расцветки — свой товар в магазине
    title: req.variation ? `${info.title} — ${req.variation}` : info.title,
    descriptionHtml: description + sectionsToHtml(info.sections) + DELIVERY_NOTE_HTML,
    vendor: info.brand ?? req.designer,
    tags: [
      "tg-bot",
      TG_COLLECTION_TAG,
      TG_DELIVERY_TAG,
      `designer:${(info.brand ?? req.designer).toLowerCase()}`,
    ],
    imageUrls: info.images.slice(0, MAX_IMAGES),
    price: req.ourPrice,
    compareAtPrice:
      sameCurrency && info.price && info.price > req.ourPrice ? info.price : undefined,
  };
}

const CREATE_PRODUCT = /* GraphQL */ `
  mutation CreateDraftProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 1) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANT_PRICE = /* GraphQL */ `
  mutation SetDraftPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

interface CreateProductData {
  productCreate: {
    product: { id: string; variants: { nodes: { id: string }[] } } | null;
    userErrors: { field?: string[]; message: string }[];
  };
}

interface UpdateVariantData {
  productVariantsBulkUpdate: {
    userErrors: { field?: string[]; message: string }[];
  };
}

/**
 * Создаёт ЧЕРНОВИК товара (status DRAFT — на витрине не виден, пока менеджер
 * не опубликует): название/описание, наша цена, цена бренда — как compare-at.
 * Фото НЕ прикрепляются здесь — их грузит uploadProductImages (скачиваем сами,
 * т.к. CDN брендов блокируют серверы Shopify).
 */
export async function createDraftProduct(
  client: ShopifyClient,
  input: DraftInput
): Promise<DraftResult> {
  const created = await client.graphql<CreateProductData>(CREATE_PRODUCT, {
    product: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      vendor: input.vendor,
      tags: input.tags,
      status: "DRAFT",
    },
  });

  const errors = created.productCreate.userErrors;
  if (errors.length > 0 || !created.productCreate.product) {
    throw new Error(
      `Shopify productCreate: ${errors.map((e) => e.message).join("; ") || "нет товара в ответе"}`
    );
  }

  const product = created.productCreate.product;
  const variantId = product.variants.nodes[0]?.id;
  if (variantId) {
    const updated = await client.graphql<UpdateVariantData>(UPDATE_VARIANT_PRICE, {
      productId: product.id,
      variants: [
        {
          id: variantId,
          price: input.price.toFixed(2),
          ...(input.compareAtPrice !== undefined
            ? { compareAtPrice: input.compareAtPrice.toFixed(2) }
            : {}),
        },
      ],
    });
    const verrs = updated.productVariantsBulkUpdate.userErrors;
    if (verrs.length > 0) {
      throw new Error(`Shopify variant update: ${verrs.map((e) => e.message).join("; ")}`);
    }
  }

  const numericId = product.id.split("/").pop();
  return {
    productId: product.id,
    adminUrl: `https://${client.shop}/admin/products/${numericId}`,
  };
}
