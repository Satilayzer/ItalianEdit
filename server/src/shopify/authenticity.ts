/**
 * Тексты об аутентичности товаров — страница и три коротких блока на витрине.
 *
 * Живут в репозитории по той же причине, что и `policies.ts`: это утверждения
 * перед покупателем, за которые магазин отвечает. «Мы не продаём реплики» —
 * не маркетинговая фраза, а заявление, к которому могут предъявить претензию,
 * поэтому правки должны проходить через историю, а не через поле в админке.
 *
 * Тексты даны заказчиком и приведены ДОСЛОВНО. Не переписывать в порядке
 * улучшения формулировок: слова подбирались под юридический смысл
 * («verified network», «trusted commercial channels»), и вольный пересказ
 * меняет объём обещания.
 *
 * Страницу публикует scripts/setup-authenticity.ts. Блоки на витрине —
 * правки темы, она в этот репозиторий не входит (см. README).
 */

import { CONTACT } from "./policies";

/** Хендл страницы: /pages/authenticity */
export const AUTHENTICITY_HANDLE = "authenticity";
export const AUTHENTICITY_TITLE = "Authenticity & Sourcing";

/**
 * Полный текст страницы.
 *
 * Оформление НЕ такое, как у правовых страниц: `assets/policy.css` в теме
 * цепляется за `.shopify-policy__container`, а этот селектор есть только
 * на /policies/*. Обычная страница рендерится шаблоном темы, поэтому если
 * нужен единый вид — это отдельная правка темы, а не текста.
 */
export const AUTHENTICITY_PAGE = `
  <p>Italian Edit works with a verified network of luxury fashion suppliers,
  distributors, and authorized resale partners. Every item offered through our
  platform is sourced from trusted commercial channels and checked against
  supplier inventory before purchase.</p>

  <p>We do not sell replicas, unauthorized copies, or imitation products. Our
  focus is to build complete, personal looks from authentic designer pieces with
  real availability, real sizes, and transparent fulfillment.</p>

  <h2>Questions About a Piece</h2>
  <p>If you would like more detail about the sourcing of a specific item, write to
  <a href="mailto:${CONTACT.email}">${CONTACT.email}</a> and we will answer before
  you order.</p>
`.trim();

/**
 * Короткий блок для главной — в рамке под баннером.
 * Заголовок идёт отдельной строкой, поэтому вынесен из текста.
 */
export const AUTHENTICITY_HOME = {
  heading: "Authentic designer pieces. Verified supply. Real availability.",
  body:
    "Every Italian Edit look is built from authentic products sourced through " +
    "trusted luxury fashion suppliers, distributors, and resale partners. " +
    "We do not sell replicas, unauthorized copies, or imitation products.",
} as const;

/**
 * Блок на странице товара.
 *
 * ВАЖНО. «connected to live supplier inventory» верно только для товаров
 * BrandsGateway: их остатки держит приложение BG. Товары бота заводятся вручную
 * с сайтов брендов и ни к какому живому стоку не подключены — на них это
 * утверждение ложно. С 1 августа 2026 товары бота сняты с витрины (DRAFT),
 * поэтому блок можно выводить без условия. Вернут канал бота в работу —
 * блок надо будет ограничить по тегу `tg-bot`.
 */
export const AUTHENTICITY_PRODUCT = {
  heading: "Verified supplier inventory",
  body:
    "This item is connected to live supplier inventory. Size, price, and " +
    "availability are confirmed before checkout.",
} as const;

/**
 * Заметка перед оплатой.
 *
 * Заказчик просил её на чекауте, но у магазина тариф Shopify (не Plus), а там
 * шаги чекаута не кастомизируются. Ближайшее место, которое мы контролируем, —
 * корзина: последний экран перед переходом к оплате. Текст оставлен дословным,
 * чтобы при переходе на Plus его можно было перенести без правок.
 */
export const AUTHENTICITY_CHECKOUT = {
  heading: "Authenticity note",
  body:
    "Italian Edit sources designer products through verified luxury fashion " +
    "suppliers and resale partners. We do not sell replicas or imitation products.",
} as const;
