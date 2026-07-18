import type { ManagerRequest, ProductInfo } from "./types";

export interface Comparison {
  ourPrice: number;
  ourCurrency: string;
  brandPrice?: number;
  brandCurrency?: string;
  /** Процент выгоды: только если валюты совпадают и цена бренда выше нашей. */
  savingsPercent?: number;
}

export function compare(req: ManagerRequest, info: ProductInfo): Comparison {
  const result: Comparison = {
    ourPrice: req.ourPrice,
    ourCurrency: req.currency.toUpperCase(),
    brandPrice: info.price,
    brandCurrency: info.currency?.toUpperCase(),
  };
  if (
    info.price !== undefined &&
    result.brandCurrency === result.ourCurrency &&
    info.price > req.ourPrice
  ) {
    result.savingsPercent = Math.round((1 - req.ourPrice / info.price) * 100);
  }
  return result;
}
