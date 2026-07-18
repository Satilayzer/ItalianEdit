# Интеграция с BrandsGateway (REST API)

Дизайн серверной логики. Тариф: REST API/CSV (или Enterprise).
Документация API: https://nova.shopwoo.com/api/v1/docs (платформа Shopwoo, OpenAPI 3.0).

## Факты об API (проверено 2026-07-14)

- **Авторизация**: HTTP Basic (email + пароль + store name, выдаются после покупки тарифа).
- **Rate limit: 60 запросов/мин** — всё проектируем с учётом этого.
- **Товары**: `GET /api/v1/products?store_id=…` — пагинация до 100 шт./страницу; фильтры:
  `updated_at_min/max` (дельта-синк!), `stock_status`, `brand`, `category`, `search`, `sku`, `price_min/max`.
- **Поля товара**: `sku`, `name`, `description`, `regular_price`, `sale_price`,
  `stock_quantity`/`stock_status`/`in_stock`, `images[]`, `brand`, `gender`, `condition`,
  `dimensions`/`weight`, `barcode`, `hs_code`, `meta_data[]` (key/value),
  `variations[]` — размеры, у каждого свой sku/цена/остаток, `created_at`/`updated_at`.
- **Быстрая проверка**: `POST /api/v1/products/check-status` — до 1000 id за раз.
- **Заказы**: `POST /api/v1/orders` — `order_id` (наш номер), `line_items[{product_id, variation_id, quantity}]`,
  `shipping{…}` (**`state` обязателен** — BG вернёт ошибку без него).
  `GET /api/v1/orders/{id}` → `status`, `tracking_info`. Вебхуков нет → трекинг поллингом.
- **CSV**: `GET /api/v1/csv/status` + `GET /api/v1/csv/download` — полный каталог (обновляется ~каждые 4 ч).
- **Справочники**: `/brands`, `/categories`, `/groups`, `/genders`, `/conditions`, `/vendors`, `/stores`.

## Архитектура

Наш сервер (тот же Node.js-процесс, что бот и API) получает четыре новых модуля:

```
src/bg/
  client.ts     — HTTP-клиент: basic auth, rate limiter (≤50 rpm), ретраи с backoff, пагинатор
  sync.ts       — синхронизация каталога BG → наша БД → Shopify
  pricing.ts    — наценка: наша цена = f(оптовая цена, бренд/категория)
  orders.ts     — передача заказов в BG + поллинг трекинга
src/shopify/
  client.ts     — Shopify Admin API (GraphQL), custom app token
  products.ts   — создание/обновление товаров, теги складов, остатки
  webhooks.ts   — приём orders/paid (HMAC-проверка подписи)
src/db.ts       — PostgreSQL (pg): products, orders, sync_log
```

## Потоки данных

### 1. Первичный импорт каталога
CSV (`/csv/download`) → парсинг → фильтр по нашим правилам (бренды, категории,
цены, склад) → БД → создание товаров в Shopify пачками.
CSV берём потому, что весь каталог через API = 50 000/100 = 500 запросов ≈ 10 минут лимита.

### 2. Постоянная синхронизация (люкс-сток = единичные вещи, скорость критична)
- **Каждые ~5 мин**: `check-status` батчами по 1000 по всем нашим активным товарам
  (50 запросов при 50k товаров; для 1–5k товаров — 1–5 запросов). Продано у BG → сразу
  ставим остаток 0 в Shopify.
- **Каждые ~15 мин**: `GET /products?updated_at_min=<время последнего синка>` —
  подтягиваем изменения цен, фото, размеров.
- **Раз в сутки**: полная сверка по свежему CSV (ловим всё, что пропустили дельтами).

### 3. Правило «остаток = 1» (то самое «отдавать 1»)
В Shopify публикуем `min(stock_quantity, INVENTORY_CAP)`, по умолчанию `INVENTORY_CAP=1`:
- люкс-аутлет — это в основном уникальные вещи (1 шт. размера);
- продажа «по одной за раз» исключает овер-селл при гонке между нашим синком и другими
  дропшипперами того же стока;
- после подтверждения заказа BG остаток восстанавливаем из их данных.
Конфигурируется через env, если поставщик скажет иначе.

### 4. Ценообразование
```
наша_цена = округлить_красиво(цена_BG × наценка(бренд, категория))
```
- наценка — конфиг с дефолтом (например ×1.8) и переопределениями по брендам;
- обе цены храним в БД; сравнение «их розница vs наша» уже умеет телеграм-бот;
- если менеджер поменял цену руками в Shopify — ставим флаг `manual_price`
  и авто-репрайс этот товар не трогает;
- изменилась оптовая у BG → пересчитываем нашу и обновляем Shopify (кроме manual).
- **Уточнить у BG**: `regular_price`/`sale_price` — это оптовая (наша закупка) или
  рекомендованная розница? От этого зависит формула.

### 5. Склады EU/US
- Склад товара определяем при импорте: ожидаем в `meta_data` (ключ вида `location`) или
  в колонке CSV (в CSV 3.0 location хранится на родительском товаре). **Проверить точный
  ключ на реальных данных в первый день доступа.**
- В Shopify каждому товару: тег `warehouse:eu` / `warehouse:us` + metafield
  `custom.warehouse`.
- Витрина: переключатель «Европа / США» фильтрует по тегу (автоматические коллекции
  «В наличии в Европе» / «В наличии в США»); плюс Shopify Markets для валют/доставки.

### 6. Заказы
```
Покупатель оплатил → Shopify webhook orders/paid → наш сервер:
  1. HMAC-проверка подписи вебхука
  2. line items → bg product_id/variation_id (маппинг по SKU из нашей БД)
  3. Валидация адреса: state обязателен (для стран без штатов — код региона)
  4. POST /api/v1/orders (order_id = номер заказа Shopify → идемпотентность)
  5. Сохранили bg_order_id, статус "передан"
Поллинг GET /orders/{bg_order_id} раз в 30–60 мин:
  появился tracking_info → создаём Fulfillment в Shopify с трек-номером
  → Shopify сам шлёт покупателю письмо с трекингом
```
Ошибка передачи заказа → алерт в телеграм-группу менеджеров (бот уже есть) + ретраи.

### 7. Надёжность
- Rate limiter: token bucket 50 req/мин (запас от лимита 60).
- Ретраи с экспоненциальным backoff на 429/5xx.
- Идемпотентность заказов: уникальный `order_id` + проверка «уже передан» в нашей БД.
- `sync_log`: каждая синхронизация пишет что/сколько обновила — видно, если что-то встало.
- Алерты в ТГ: упал синк, не передался заказ, товар из заказа исчез у BG.

## Схема БД (PostgreSQL 18, локальная — уже подключена, см. server/src/db/schema.sql)

```sql
products (
  bg_id INTEGER PRIMARY KEY, sku TEXT, name TEXT, brand TEXT,
  wholesale_price REAL, sale_price REAL, our_price REAL, manual_price INTEGER DEFAULT 0,
  stock INTEGER, warehouse TEXT,            -- 'eu' | 'us'
  shopify_product_id TEXT, shopify_variant_map TEXT,  -- JSON: bg_variation_id → shopify_variant_id
  status TEXT, updated_at TEXT, synced_at TEXT
)
orders (
  shopify_order_id TEXT PRIMARY KEY, bg_order_id INTEGER,
  status TEXT,                              -- pending | sent | confirmed | shipped | error
  tracking TEXT, error TEXT, created_at TEXT, updated_at TEXT
)
sync_log ( id, started_at, kind, items_updated, ok, message )
```

## Вопросы к BrandsGateway при получении доступа

1. Точный ключ склада/локации в `meta_data` товара (и формат значений).
2. `regular_price`/`sale_price` — оптовая для нас или рекомендованная розница? Где вторая?
3. Повторный `POST /orders` с тем же `order_id` — ошибка или дубль? (идемпотентность)
4. Что внутри `tracking_info` и когда появляется? Есть ли статусы `cancelled`/`refunded`?
5. Возвраты: как оформляются через API?

## Порядок реализации

1. ✅ `bg/client.ts` (basic auth, rate limiter 50/мин, ретраи, пагинация), `bg/pricing.ts`,
   `bg/mapProduct.ts` (склад + наценка + cap остатка), `bg/sync.ts` (импорт + check-status),
   репозитории `db/products.ts`, `db/syncLog.ts`. Покрыто тестами (мок fetch) + прогнано на
   реальной PostgreSQL через `scripts/demoSync.ts`. Ждём креды BG для боевого прогона.
2. ✅ Вебхук заказов (`/webhooks/shopify/orders`, HMAC-подпись) + передача в BG
   (`bg/orders.ts`: идемпотентность, маппинг SKU→bg_id, несопоставленное → алерт на ручную
   обработку) + поллинг трекинга. Репозиторий `db/orders.ts`.
3. ✅ Планировщик (`scheduler.ts`): check-status каждые 5 мин, дельта-импорт 15 мин,
   трекинг 30 мин — включаются автоматически при появлении кред BG + БД.
4. ✅ Алерты в телеграм-группу (`alerts.ts`, chat_id — командой /chatid у бота, env ALERT_CHAT_ID).
5. ✅ Shopify подключён (Dev Dashboard, client credentials). Слой черновиков готов
   (`shopify/draftProduct.ts`).
6. ✅ Заливка каталога БД → Shopify (`shopify/products.ts` + job `shopify-push` раз в минуту,
   батч SHOPIFY_PUSH_BATCH=25): создание товара (ACTIVE, фото, описание, вендор,
   теги `warehouse:eu/us`), цена+SKU на варианте, остаток через inventorySetQuantities;
   обновление цены/остатка/статуса; снятые — ARCHIVED. Очередь: `shopify_synced_at < synced_at`
   в products, ошибки в `push_error`.
7. Осталось: создание Fulfillment с трек-номером при получении трекинга от BG;
   боевой прогон импорта и заказов на реальных кредах BG.

## Что уже написано (без доступов, на моках)

```
src/bg/
  types.ts        — типы ответов Shopwoo API
  rateLimiter.ts  — token bucket (инъекция часов → детерминированные тесты)
  client.ts       — HTTP-клиент: basic auth, ретраи с backoff, пагинатор, check-status, orders
  pricing.ts      — наценка (дефолт + по брендам) + красивое округление
  mapProduct.ts   — BG-товар → строка БД: склад eu/us, оптовая→наша цена, cap остатка
  sync.ts         — importCatalog (полный/дельта) + syncStockStatuses + chunk
  mockClient.ts   — тестовый каталог + мок клиента для демо/тестов
src/db/
  products.ts     — upsert (не трогает ручную цену), updateStock, activeProductIds, markInactive
  syncLog.ts      — журнал синхронизаций
scripts/demoSync.ts — демо импорта+сверки на реальной БД без BG
```

Проверить локально: `npx tsx scripts/demoSync.ts` (нужен DATABASE_URL).
