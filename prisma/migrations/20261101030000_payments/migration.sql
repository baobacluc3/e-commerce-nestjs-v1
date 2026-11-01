-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_payment_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "last_webhook_event_id" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_last_webhook_event_id_key" ON "payments"("last_webhook_event_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom database constraints:
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount" >= 0);
