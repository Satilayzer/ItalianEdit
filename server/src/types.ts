/** Запрос менеджера из телеграм-группы: название товара, наша цена, дизайнер. */
export interface ManagerRequest {
  title: string;
  ourPrice: number;
  currency: string;
  designer: string;
}

/** Информация о товаре, собранная с сайта дизайнера. */
export interface ProductInfo {
  title: string;
  url: string;
  brand?: string;
  description?: string;
  images: string[];
  price?: number;
  currency?: string;
  availability?: string;
  source: "jsonld" | "opengraph";
}

export interface SearchHit {
  title: string;
  link: string;
  snippet?: string;
}
