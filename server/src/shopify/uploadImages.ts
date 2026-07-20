import type { ShopifyClient } from "./client";
import { BROWSER_HEADERS } from "../scrape/fetchPage";

/** Просим у CDN обычные форматы — многие (например Gucci) иначе отдают AVIF, который Shopify не примет. */
const IMAGE_ACCEPT = "image/jpeg,image/png;q=0.9,image/webp;q=0.8,*/*;q=0.5";
const ALLOWED_MIME = /^image\/(jpeg|png|webp|gif|heic)$/;
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Кандидаты URL по убыванию качества. Для Gucci CDN сначала пробуем
 * крупную версию 2400×2400 вместо превью (…_0_0_490x490 → …_0_0_2400x2400).
 */
export function imageUrlCandidates(url: string): string[] {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("media.gucci.com")) {
      const upgraded = url.replace(/_0_0_\d{2,4}x\d{2,4}\//, "_0_0_2400x2400/");
      if (upgraded !== url) return [upgraded, url];
    }
  } catch {
    // битый URL — вернём как есть, отвалится на скачивании
  }
  return [url];
}

export interface DownloadedImage {
  bytes: ArrayBuffer;
  mimeType: string;
  filename: string;
}

/** Скачивает фото (первый работающий кандидат) в формате, который примет Shopify. */
export async function downloadImage(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<DownloadedImage | null> {
  for (const candidate of imageUrlCandidates(url)) {
    try {
      const res = await fetchFn(candidate, {
        headers: { ...BROWSER_HEADERS, Accept: IMAGE_ACCEPT },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) continue;
      const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!ALLOWED_MIME.test(mimeType)) continue;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue;

      const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
      const base =
        new URL(candidate).pathname
          .split("/")
          .pop()
          ?.replace(/[^\w.-]/g, "")
          .replace(/\.[a-z0-9]+$/i, "")
          .slice(-60) || "image";
      return { bytes, mimeType, filename: `${base}.${ext}` };
    } catch {
      continue;
    }
  }
  return null;
}

const STAGED_UPLOADS = /* GraphQL */ `
  mutation StageImage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA = /* GraphQL */ `
  mutation AttachMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id }
      mediaUserErrors { field message }
    }
  }
`;

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

export interface UploadStats {
  uploaded: number;
  failed: number;
}

/**
 * Надёжная загрузка фото товара: скачиваем сами → staged upload в хранилище
 * Shopify → прикрепляем к товару. Shopify не ходит на сайт бренда вообще,
 * поэтому блокировки брендовых CDN (Gucci и др.) не мешают.
 * Ошибка одного фото не роняет остальные.
 */
export async function uploadProductImages(
  client: ShopifyClient,
  productId: string,
  imageUrls: string[],
  fetchFn: typeof fetch = fetch
): Promise<UploadStats> {
  const resourceUrls: string[] = [];
  let failed = 0;

  for (const url of imageUrls) {
    const image = await downloadImage(url, fetchFn);
    if (!image) {
      failed++;
      continue;
    }
    try {
      const staged = await client.graphql<{
        stagedUploadsCreate: {
          stagedTargets: StagedTarget[];
          userErrors: { message: string }[];
        };
      }>(STAGED_UPLOADS, {
        input: [
          {
            resource: "IMAGE",
            filename: image.filename,
            mimeType: image.mimeType,
            httpMethod: "POST",
            fileSize: String(image.bytes.byteLength),
          },
        ],
      });
      const target = staged.stagedUploadsCreate.stagedTargets[0];
      if (!target || staged.stagedUploadsCreate.userErrors.length > 0) {
        failed++;
        continue;
      }

      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append("file", new Blob([image.bytes], { type: image.mimeType }), image.filename);
      const up = await fetchFn(target.url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!up.ok) {
        failed++;
        continue;
      }
      resourceUrls.push(target.resourceUrl);
    } catch (err) {
      console.error("Ошибка загрузки фото в Shopify:", err);
      failed++;
    }
  }

  if (resourceUrls.length > 0) {
    const attached = await client.graphql<{
      productCreateMedia: { mediaUserErrors: { message: string }[] };
    }>(CREATE_MEDIA, {
      productId,
      media: resourceUrls.map((u) => ({
        originalSource: u,
        mediaContentType: "IMAGE",
      })),
    });
    const errs = attached.productCreateMedia.mediaUserErrors;
    if (errs.length > 0) {
      console.error("productCreateMedia:", errs.map((e) => e.message).join("; "));
    }
  }

  return { uploaded: resourceUrls.length, failed };
}
