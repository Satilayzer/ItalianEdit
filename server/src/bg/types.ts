/** Типы ответов BrandsGateway (Shopwoo REST API v1). Только поля, которые нам нужны. */

export interface BgImage {
  src: string;
  position?: number;
  alt?: string;
}

export interface BgNamed {
  id: number;
  name: string;
}

export interface BgMeta {
  id?: number;
  key: string;
  value: string;
}

export interface BgVariation {
  id: number;
  sku: string;
  regular_price?: number;
  sale_price?: number;
  in_stock?: boolean;
  stock_quantity?: number;
  stock_status?: string;
  barcode?: string;
  meta_data?: BgMeta[];
  attributes?: { id: number; name: string; option: string }[];
  image?: { src: string; alt?: string };
}

export interface BgProduct {
  id: number;
  sku: string;
  name: string;
  description?: string;
  regular_price?: number;
  sale_price?: number;
  in_stock?: boolean;
  stock_quantity?: number;
  stock_status?: string;
  barcode?: string;
  hs_code?: string;
  brand?: BgNamed | null;
  gender?: BgNamed | null;
  condition?: BgNamed | null;
  images?: BgImage[];
  meta_data?: BgMeta[];
  variations?: BgVariation[];
  created_at?: string;
  updated_at?: string;
}

export interface BgProductStatus {
  id: number;
  in_stock?: boolean;
  stock_status?: string;
  stock_quantity?: number;
}

/** Тело заказа для POST /api/v1/orders. */
export interface BgOrderRequest {
  order_id: number;
  line_items: { product_id: number; variation_id?: number; quantity: number }[];
  shipping: BgShipping[];
  coupon_lines?: { code: string }[];
}

export interface BgShipping {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface BgOrderResponse {
  id: number;
  status: string;
  total?: number;
  tracking_info?: unknown;
}
