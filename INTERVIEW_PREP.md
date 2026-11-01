# Technical Interview Defense Guide & System Walkthrough

This document prepares you to explain, defend, and walk through the engineering decisions of this E-Commerce API during backend engineering interviews.

---

## 1. The 3-Minute System Walkthrough

> *"Could you walk us through the architecture of this project and how checkout works?"*

### **Suggested 3-Minute Answer:**

> "This is a production-grade e-commerce REST API built with NestJS, Prisma, and PostgreSQL. It is structured as a modular monolith designed around financial consistency, atomic concurrency, and strict zero-trust security.
>
> When a customer checks out, the biggest challenge in e-commerce is preventing overselling under high concurrency while ensuring idempotency and data integrity. Here is how I solved that:
>
> 1. **Server-Side Pricing**: The client cart contains only product IDs and requested quantities. The server calculates all totals and line-item prices dynamically from active database records. A client cannot manipulate prices.
> 2. **Single Transaction Boundary**: When the client posts to `/api/v1/orders/checkout`, the entire operation runs inside a PostgreSQL `$transaction`. 
> 3. **Row-Level Atomic Decrement**: Instead of naive read-modify-write loops or heavy distributed locks, I used PostgreSQL conditional updates: `UPDATE "Product" SET stock = stock - $quantity WHERE id = $id AND stock >= $quantity AND is_active = true`. If two users race to buy the very last item, the database row-level lock serializes them—exactly one update succeeds, and the other returns zero affected rows, triggering a 409 Conflict. This is backed by a database-level constraint: `CHECK (stock >= 0)`.
> 4. **Frozen Historical Snapshots**: The order copies the product's name, SKU, and unit price as integer cents directly into `OrderItem`. If the store later changes prices or renames items, historical invoices remain immutable.
> 5. **Idempotency Key**: The checkout accepts an `Idempotency-Key` header. If the customer double-clicks or experiences network jitter, repeated requests return the already-created order without double-charging or double-decrementing stock.
> 6. **Two-Phase Payment & Webhook Resilience**: Payments are processed asynchronously via Stripe. A `PaymentIntent` is created in `PENDING` status. The order only transitions to `PAID` once Stripe's cryptographically signed webhook (`payment_intent.succeeded`) is verified using HMAC-SHA256. Replaying the webhook is strictly idempotent because we track the `lastWebhookEventId` in the database.
>
> On the security side, we implement Argon2id password hashing, rotating refresh token families with automatic reuse revocation, global rate limiting, and an automated OWASP API Top 10 regression test suite."

---

## 2. Top 8 Engineering Interview Questions & Answers

### **Q1: What happens if two users try to buy the last item in stock at the exact same millisecond?**
* **The Problem**: A naive ORM read (`product.stock`) followed by write (`stock - 1`) causes a Classic Race Condition (Time-Of-Check to Time-Of-Use / TOCTOU), resulting in negative stock.
* **Our Solution**:
  ```sql
  UPDATE "Product"
  SET stock = stock - $qty, "updatedAt" = NOW()
  WHERE id = $id AND stock >= $qty AND is_active = true;
  ```
  PostgreSQL acquires an exclusive row lock on the product row. The first transaction decrements `1 -> 0`. The second transaction evaluates `WHERE stock >= 1` against the newly updated value `0`, matching 0 rows. Our service checks `affectedRows === 0` and immediately rolls back with `409 Conflict: Insufficient stock`.
* **Safety Net**: Database constraint `CHECK (stock >= 0)` guarantees negative stock is physically impossible even if application code had a bug.

---

### **Q2: Why use atomic SQL conditional updates instead of a Redis distributed lock (Redlock)?**
* **Trade-Off Analysis**:
  - **Distributed Locks (Redis / Redlock)**:
    - Adds network hops, additional latency, and an external point of failure.
    - Prone to lock expiration issues (e.g. GC pauses or long network calls exceeding lock TTL, leading to split-brain updates).
    - Requires distributed consensus algorithms.
  - **PostgreSQL Row-Level Locks**:
    - Zero additional infrastructure; leverages PostgreSQL's built-in MVCC and write-ahead log.
    - Lock release is atomic with transaction commit or rollback.
    - Highest possible throughput for single-database transactional workloads.

---

### **Q3: What happens if Stripe's webhook arrives before the frontend receives the PaymentIntent response?**
* **The Problem**: Due to network latency, Stripe might process a payment and fire a webhook before the customer's browser finishes receiving the HTTP response from `/payments/orders/:id/intent`.
* **Our Solution**:
  - The webhook handler does not rely on frontend state.
  - It reads the `orderId` directly from Stripe's trusted `metadata.orderId` inside the cryptographically signed event.
  - It runs in an atomic transaction: checks if `Payment` row already exists. If not, it creates it in `SUCCEEDED` status and marks the `Order` as `PAID`.
  - When the customer's client subsequently queries `GET /api/v1/orders/:id`, it already sees status `PAID`. The system is fully asynchronous and event-driven.

---

### **Q4: How do you defend against webhook replay attacks or duplicate Stripe events?**
* **Our Solution**:
  1. **Signature Verification**: Every incoming webhook payload is verified with Stripe's HMAC-SHA256 signature and a timestamp tolerance window to reject expired or forged payloads.
  2. **Database Deduplication**: The `Payment` record stores `lastWebhookEventId`.
     ```typescript
     if (existingPayment?.lastWebhookEventId === event.id) {
       return { received: true, duplicate: true };
     }
     ```
  3. Replayed webhooks return `200 OK` with `{ duplicate: true }` without updating timestamps, mutating stock, or altering order statuses.

---

### **Q5: How does your Refresh Token Family Rotation work, and why is it superior to stateless JWTs?**
* **The Problem**: Pure stateless JWTs cannot be revoked if stolen until they expire. Standard refresh tokens allow an attacker to generate new access tokens indefinitely if exfiltrated.
* **Our Solution (Token Family Rotation)**:
  - Each refresh token belongs to a `familyId`.
  - Stored in the database as a **SHA-256 hash** (`tokenHash`)—if the database is leaked, raw tokens cannot be recovered.
  - When a refresh token is used:
    1. It is marked as `revokedAt = NOW()`.
    2. A new refresh token with the same `familyId` is generated.
  - **Replay Detection**: If an attacker attempts to use an already-revoked refresh token, our service detects `revokedAt !== null`, recognizes an active breach, and **immediately revokes all tokens belonging to that `familyId`**. The legitimate user is logged out, and the attacker is completely neutralized.

---

### **Q6: Why did you choose Argon2id over bcrypt for password hashing?**
* **Our Solution**:
  - **bcrypt** is CPU-hard but not memory-hard, making it susceptible to mass cracking via specialized GPU/FPGA clusters.
  - **Argon2id** (winner of the Password Hashing Competition) combines memory-hardness (preventing GPU cracking) with time-hardness (preventing CPU brute-forcing) and side-channel resistance.
  - Configured with `type: argon2.argon2id`, memory cost 64MB, and 3 iterations for production-level resistance.

---

### **Q7: What happens if a customer checks out but abandons payment? Does inventory stay locked forever?**
* **Our Solution**:
  - Every order created at checkout receives an expiration timestamp: `expiresAt = NOW() + 15 minutes`.
  - We implemented an automated worker endpoint: `POST /api/v1/orders/expire-unpaid`.
  - The job queries all orders where `status = PENDING AND expiresAt < NOW()`.
  - For each expired order, it runs an atomic transaction:
    1. Sets `status = CANCELLED` and `cancelledAt = NOW()`.
    2. Restocks every item atomically (`stock = stock + quantity`).
    3. Logs a `StockMovement` audit record with `type: IN` and `reason: Unpaid order expired`.
  - Abandoned inventory is automatically released back to other shoppers.

---

### **Q8: How do you prevent Mass Assignment vulnerabilities in NestJS?**
* **The Problem**: A malicious client sends extra fields in JSON bodies (e.g. `{ "email": "...", "password": "...", "role": "ADMIN" }`) to escalate privileges.
* **Our Solution**:
  - Global `ValidationPipe` configured with:
    ```typescript
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
    ```
  - `whitelist: true` strips non-decorated properties.
  - `forbidNonWhitelisted: true` immediately throws a `400 Bad Request` if an unauthorized field is sent.
  - Verified by automated regression tests in `test/security.e2e-spec.ts`.

---

## 3. Measurable Resume / CV Bullet Points

Copy and paste these impact-oriented bullet points into your CV / LinkedIn:

- **E-Commerce Backend & Concurrency Engine (NestJS, TypeScript, Prisma, PostgreSQL)**
  - Engineered a high-concurrency modular monolith e-commerce API supporting atomic checkouts, server-side dynamic cart pricing, and real-time inventory management.
  - Eliminated overselling race conditions at the database layer using PostgreSQL conditional row updates (`stock >= quantity`) and `CHECK` constraints, verified by automated parallel checkout test suites.
  - Architected zero-trust authentication using Argon2id, short-lived JWTs, and SHA-256 hashed refresh token families with automatic replay breach revocation.
  - Integrated Stripe test-mode payments with cryptographic HMAC-SHA256 webhook signature verification and idempotent event deduplication.
  - Hardened API against OWASP API Top 10 vulnerabilities, achieving 75%+ statement coverage with 92 unit tests and 23 E2E security and lifecycle integration tests.
  - Configured production CI/CD pipeline via GitHub Actions with linting, automated testing, security vulnerability auditing (`npm audit`), and multi-stage non-root Docker builds.
