-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_id" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_is_active_idx" ON "products"("is_active");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");
CREATE INDEX "stock_movements_user_id_idx" ON "stock_movements"("user_id");
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom database constraints:
-- Database rule stock >= 0 (cannot oversell or reach negative inventory)
ALTER TABLE "products" ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);

-- Product price must be non-negative
ALTER TABLE "products" ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0);

-- Stock movement quantity must be non-negative
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_non_negative" CHECK ("quantity" >= 0);
