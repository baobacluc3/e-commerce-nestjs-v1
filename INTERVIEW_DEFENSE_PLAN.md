# Interview Defense Plan — E-Commerce NestJS API

A 7-day prep plan. Each day has a goal, what to study in the code, and a "done when" test you can check yourself against.

> [!CAUTION]
> **Fix these before the interview.** I checked the code against `INTERVIEW_PREP.md` and `README.md`, and they disagree in 3 places. If the interviewer opens your repo, these are the first things they'll catch.
>
> | # | Your docs say | The code actually does | What to do |
> |---|---|---|---|
> | 1 | Reusing a revoked refresh token **revokes the whole family** | [auth.service.ts](src/auth/auth.service.ts) only rejects the token. The comment says *"Revoking the whole family on reuse comes in Phase 9"* | Build it (about 10 lines: `updateMany where familyId`), **or** stop claiming it |
> | 2 | Unpaid orders expire after **15 minutes** | `DEFAULT_ORDER_EXPIRY_DELAY_MS = 30 min` in [queue.constants.ts](src/queues/queue.constants.ts) | Pick one number and use it in every doc |
> | 3 | Expiry runs through `POST /orders/expire-unpaid` | Expiry runs as a **BullMQ delayed job, with a 1-minute `setInterval` sweep as a fallback** ([orders.service.ts](src/orders/orders.service.ts)) | Update the doc. The real design is the better story anyway |

---

## Day 1 — Pitch & big picture

**Goal:** Explain the whole project in 60 seconds, then in 3 minutes, without notes.

**60-second pitch (use this structure):**
1. **What:** An e-commerce REST API built with NestJS 11, Prisma, PostgreSQL, Redis/BullMQ, and Stripe. It's live on Render with Swagger docs.
2. **Hard problem:** Stopping overselling, double charges, and price tampering when many users check out at once.
3. **How:** One atomic checkout transaction, conditional stock updates, idempotency keys, signed webhooks, and delayed jobs that expire unpaid orders.
4. **Proof:** Unit tests, E2E tests that fire checkouts in parallel, OWASP security tests, CI on GitHub Actions, and a Docker build.

**Know the modules:** `auth`, `users`, `products`, `cart`, `inventory`, `orders`, `payments`, `queues`, `admin`, `health`, `config`, `prisma`.

**Data model (draw it on paper):** `User` → `Cart` → `CartItem` → `Product` → `Category`. Then `User` → `Order` → `OrderItem` (snapshot), `Order` → `Payment`, `Product` → `StockMovement`, and `User` → `RefreshToken`.

✅ **Done when:** You can draw the module diagram and the ER diagram from memory, and give the pitch in under 60 seconds.

---

## Day 2 — Checkout, the core of your defense

**Study:** [`OrdersService.checkout`](src/orders/orders.service.ts). Be able to explain every step:

| Step | Line(s) | Why it matters |
|---|---|---|
| Check the idempotency key before **and** inside the transaction | 109–136 | A double-click returns the same order |
| Sort cart items by `productId` | 149–152 | Every transaction locks rows in the same order, so **no deadlocks**. Interviewers love this point |
| `UPDATE ... WHERE stock >= qty AND is_active RETURNING` | 166–173 | Stock check and stock write happen in one atomic step, so there's no gap for a race |
| 0 rows returned → work out the cause (404 / 400 / 409) | 175–194 | Error messages tell the client exactly what went wrong |
| Price comes from the DB row, not the client | 197–199 | The client can't tamper with prices |
| Snapshot name/SKU/price into `OrderItem` | 222–229 | Past invoices never change |
| Write a `StockMovement` audit row | 237–249 | Every stock change is traceable |
| Catch `P2002` on the unique idempotency index | 264–282 | Handles two identical requests arriving in parallel |

✅ **Done when:** You can explain the TOCTOU race and why `SELECT` then `UPDATE` in app code is broken, and explain why sorting prevents deadlocks.

---

## Day 3 — Payments & background jobs

**Study:** [`PaymentsService.handleWebhook`](src/payments/payments.service.ts), [`order-expiration.queue.ts`](src/queues/order-expiration.queue.ts), and [`expireOrder`](src/orders/orders.service.ts).

Key points:
- The webhook signature is verified (HMAC) before anything else runs.
- Dedup works through the unique `lastWebhookEventId`. Once a payment is `SUCCEEDED`, later events are ignored.
- `order.updateMany where status = PENDING` is a **conditional state transition**, so it can never overwrite a newer status.
- BullMQ: a delayed job, exponential backoff, a DLQ, stalled-job detection, and a DB sweep as a fallback if Redis is down.
- The `PaymentProvider` interface lets you swap Stripe for another provider (dependency inversion).

> [!WARNING]
> **Known gap: be ready for this question.** If the expiry job cancels an order and Stripe's `succeeded` webhook arrives **after** that, the code marks the Payment `SUCCEEDED`. But `updateMany` matches 0 rows, so the order stays `CANCELLED` and **the customer has been charged with no refund.**
> **Honest answer:** "I know about this edge case. The fix is a compensating action: when a success webhook arrives for an order that's no longer `PENDING`, issue a Stripe refund automatically, or try to re-reserve the stock. I'd also cancel the PaymentIntent on Stripe when the order expires." Even better, implement it before the interview.

✅ **Done when:** You can trace one order through PENDING → PAID → SHIPPED and through PENDING → CANCELLED (expired), including what happens to stock in each case.

---

## Day 4 — Security

**Study:** `auth/` (guards, strategy, token service, password service), `app.setup.ts`, and `SECURITY.md`.

| Topic | Be ready to explain |
|---|---|
| Argon2id vs bcrypt | Argon2id is memory-hard, which makes GPU cracking expensive |
| Access vs refresh tokens | Access tokens are short-lived JWTs. Refresh tokens are stored as a SHA-256 hash and rotated on every use |
| `JwtAuthGuard` + `@Public()` + `RolesGuard` + `@Roles()` | Guards are global and every route is protected unless you opt out (deny by default) |
| `ValidationPipe({ whitelist, forbidNonWhitelisted })` | Blocks mass assignment, e.g. a client sending `role: ADMIN` |
| Ownership checks in `findOne(orderId, actor)` | Stops BOLA/IDOR (OWASP API #1) |
| Helmet, CORS, Throttler, env validation | Defense in depth |

✅ **Done when:** You can explain how refresh rotation works **as it's currently implemented**, and what family revocation would add (see the Caution box at the top).

---

## Day 5 — Testing, DevOps, trade-offs

- **Tests:** Run `npm test -- --coverage` and `npm run test:e2e` yourself, and **quote the real numbers**, not the ones in the doc.
- **CI:** Know each step in `.github/workflows/ci.yml`.
- **Docker:** A multi-stage build running as a non-root user, plus `docker-compose` for Postgres and Redis.

**Trade-off answers to rehearse:**
- Why a modular monolith instead of microservices? One DB transaction covers all of checkout, there's less operational overhead, and it can be split later along module boundaries.
- Why conditional SQL instead of Redis locks? No extra infrastructure, and the lock is released exactly when the transaction commits.
- Why store money as integer cents? Floats can't represent amounts like 0.1 exactly (IEEE 754 rounding).
- Why Prisma plus raw SQL? Prisma gives you types for most queries. Raw SQL is only used where you need atomic `UPDATE ... RETURNING`.

✅ **Done when:** You can give a 3-sentence answer to "why X instead of Y?" for each item above.

---

## Day 6 — Weaknesses & "what would you improve?"

Interviewers respect candidates who know where their own system falls short. Prepare these:
1. A hot SKU under a flash sale means every checkout waits on the same row lock. Fix: Redis reservations or a queue in front of checkout.
2. The refund gap for webhooks that arrive after cancellation (Day 3).
3. Refresh-token family revocation isn't built yet (unless you build it).
4. No event bus or outbox pattern, so side effects like emails aren't guaranteed to be delivered.
5. Observability: add metrics and tracing (Prometheus/OpenTelemetry).

✅ **Done when:** You can name 3 weaknesses and a concrete fix for each, without sounding defensive.

---

## Day 7 — Mock interviews

| Round | Format | Questions |
|---|---|---|
| 1 | Easy (15 min) | NestJS flow, DTOs, schema relations, JWT, checkout steps |
| 2 | Deep dive (25 min) | Concurrency, deadlocks, idempotency, webhook races, BullMQ crashes |
| 3 | Live demo (5 min) | Swagger: log in as customer → add to cart → checkout → pay → log in as admin → ship |

> [!TIP]
> Open the live demo before every interview. Render's free tier goes to sleep and takes about 30–60 seconds to wake up.

---

## Interview-day cheat sheet

- **Answer structure:** Problem → my solution → why (trade-off) → how I tested it.
- **If you don't know:** "I haven't built that yet. Here's how I'd approach it…"
- **Lines worth memorizing:** `stock >= qty` conditional update · sorted lock order · `P2002` idempotency fallback · `updateMany where status = PENDING` · BullMQ plus a fallback sweep.
