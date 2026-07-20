/** Запрос менеджера из телеграм-группы: название, вариация (цвет/модель), дизайнер, наша цена. */
export interface ManagerRequest {
  title: string;
  /** Вариация товара: расцветка/материал («beige and ebony Supreme», «Navy»). */
  variation?: string;
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
  /** Цвет/вариация со страницы товара (JSON-LD color) — для сверки с запросом менеджера. */
  color?: string;
  /** Доп. секции со страницы бренда (Product Details, Materials & Care) — идут в описание Shopify. */
  sections?: { heading: string; text: string }[];
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
