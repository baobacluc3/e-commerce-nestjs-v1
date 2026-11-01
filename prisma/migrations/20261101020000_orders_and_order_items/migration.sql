-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "total_price" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_sku" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom database constraints:
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_price_non_negative" CHECK ("total_price" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_price_non_negative" CHECK ("unit_price" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_subtotal_non_negative" CHECK ("subtotal" >= 0);
