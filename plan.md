**Plan:** 13 phases, about **10-12 weeks** at 2-3 hours a day, 5 days a week. You can **start applying after Phase 6 (around week 6-7)**. Phases 7-12 make you stand out. Keep building Part B while interviews start.

**What employers look for in a junior:** clean NestJS structure, auth and roles, good SQL design with migrations, transactions, validation and error handling, tests, Docker, CI, a live deployment, and a clear README. Each phase below builds one of these.

**Priority:** P0 = must have · P1 = strong signal · P2 = postpone

## **Part A: Core (apply-ready v1)**

**Phase 0 · Foundation** (P0 · 2-3 days)

- Build: Nest project (strict TypeScript), Prisma + Postgres in Docker Compose, env validation, validation pipe, error format, logging, Swagger, health check, Jest.
- Done when: one command starts everything and the first e2e test passes.

**Phase 1 · Auth & Users** (P0 · 5-7 days)

- Build: register, login, JWT access token + rotating refresh token (stored hashed), password hashing, /users/me, auth guard.
- Done when: e2e tests cover wrong password, expired token and duplicate email, and no password hash ever appears in a response.

**Phase 2 · Categories, Products, Roles** (P0 · 4-5 days)

- Build: CRUD, price as integer cents, pagination/filter/sort/search, ADMIN vs CUSTOMER roles guard, seed script, first CI run (lint, build, tests).
- Done when: anyone can browse, only ADMIN can write, and page size has a maximum.

**Phase 3 · Inventory** (P0 · 2-3 days)

- Build: stock per product, atomic decrement, database rule stock >= 0, stock movement log (P1).
- Done when: a test sending parallel requests for the last item sells it only once.

**Phase 4 · Cart** (P0 · 3 days)

- Build: one cart per user, add/update/remove, totals calculated on the server, stock and active-product checks.
- Done when: inactive or out-of-stock items can't be added and the client can't fake prices.

**Phase 5 · Orders & Checkout** (P0 · 5-6 days)

- Build: checkout in one DB transaction (order, price snapshot, stock decrement, clear cart), status flow, cancel + restock, expiry job for unpaid orders, idempotency key (makes a repeated request safe), temporary mock-pay endpoint.
- Done when: checkout is all-or-nothing, users can't read each other's orders, and a double click creates one order.

**Phase 6 · Docker, Deploy, README** (P0 · 3-4 days) ← **apply from here**

- Build: multi-stage Dockerfile, Compose, deploy to a hosting platform with managed Postgres, quick security wins (helmet, CORS allow-list, login rate limit), README with database diagram and live Swagger link.
- Done when: the public URL works and a stranger can run the project locally in 3 commands.

## **Part B: Stand-out**

**Phase 7 · Payments** (P1, high value · 4-5 days)

- Build: Stripe test mode behind a provider interface (replaces mock-pay), signed webhook, idempotent event handling, paid/failed flows.
- Done when: a test payment marks the order PAID, replaying a webhook changes nothing, and a bad signature is rejected.

**Phase 8 · Admin API** (P1 · 2-3 days)

- Build: order list with filters, valid status transitions only, stock adjustments.
- Done when: every admin route returns 403 for a customer token (tested).

**Phase 9 · Security Hardening** (P0 · 2-3 days)

- Build: review your code against the OWASP API Top 10: access to other users' data, mass assignment (e.g. a client sending role: ADMIN), rate limits, refresh-token reuse, secrets, npm audit.
- Done when: a SECURITY.md checklist is complete and every protected route has 401/403 tests.

**Phase 10 · Testing Completion** (P0 · 3-4 days)

- Build: fill gaps with service unit tests, a full-flow e2e test (register → checkout → pay → ship), a concurrency test and a coverage report. You write tests in every phase; this phase only closes gaps.
- Done when: all tests pass on a clean clone and business logic is about 70%+ covered.

**Phase 11 · CI/CD** (P1 · 2 days)

- Build: extend the Phase 2 pipeline with Docker build, caching, branch protection and auto-deploy from main.
- Done when: a red pipeline blocks merging and merging to main deploys.

**Phase 12 · Polish & Interview Prep** (P0 · 3 days)

- Build: final README, architecture diagram, decisions and trade-offs, demo GIF, CV bullets, mock interview.
- Done when: you can explain any file and walk through checkout in 3 minutes.

**Milestones:** auth done ~week 2 · orders done ~week 5-6 · apply-ready ~week 6-7 · full project ~week 10-12.

## **Why this order differs from your list**

- Inventory comes before Cart and Orders, because checkout needs stock logic.
- Roles start in Phase 2, because admin-only product writes need them. Full admin tools come in Phase 8.
- Docker and the first deploy come right after Orders. You get a live link early and avoid last-minute deployment surprises. CI/CD comes later to automate it.

## **Architecture in one glance**

Modular monolith: one NestJS module per feature (auth, users, products, categories, inventory, cart, orders, payments, admin) plus shared config, Prisma and common modules. About 10 tables: User, RefreshToken, Category, Product, StockMovement, Cart, CartItem, Order, OrderItem, Payment.

Stack: NestJS, TypeScript, PostgreSQL, Prisma, class-validator, Passport JWT, Swagger, pino, Jest + Supertest, Docker, GitHub Actions, Stripe.

## **Postpone (P2)**

Redis cache, queues and emails, image upload, product variants (size/color), coupons, reviews, Google login, 2FA, full-text search, GraphQL, microservices, Kubernetes. After Phase 12, add at most one: a Redis cache for products or a queue job for order emails.

## **How each phase works**

1. **Design:** architecture, DB design, edge cases, security risks,…
2. **Explain:** plain English, covering why it exists, how it works, and how the parts connect.
