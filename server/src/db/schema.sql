-- Каталог: товары BrandsGateway и их отражение в Shopify
CREATE TABLE IF NOT EXISTS products (
  bg_id               BIGINT PRIMARY KEY,
  sku                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  brand               TEXT,
  wholesale_price     NUMERIC(12,2),
  sale_price          NUMERIC(12,2),
  our_price           NUMERIC(12,2),
  manual_price        BOOLEAN NOT NULL DEFAULT FALSE,
  stock               INTEGER NOT NULL DEFAULT 0,
  warehouse           TEXT CHECK (warehouse IN ('eu', 'us')),
  shopify_product_id  TEXT,
  shopify_variant_map JSONB,
  status              TEXT NOT NULL DEFAULT 'active',
  bg_updated_at       TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ
);

-- Новые колонки (ALTER — чтобы применились и к уже созданной таблице)
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_synced_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS push_error TEXT;

CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products (warehouse);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);

-- Заказы: путь заказа Shopify → BrandsGateway
CREATE TABLE IF NOT EXISTS orders (
  shopify_order_id  TEXT PRIMARY KEY,
  bg_order_id       BIGINT,
  status            TEXT NOT NULL DEFAULT 'pending',
  tracking          JSONB,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- Журнал синхронизаций: видно, если что-то встало
CREATE TABLE IF NOT EXISTS sync_log (
  id            BIGSERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT NOT NULL,
  items_updated INTEGER NOT NULL DEFAULT 0,
  ok            BOOLEAN NOT NULL DEFAULT TRUE,
  message       TEXT
);
