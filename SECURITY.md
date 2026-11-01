# Security Policy & OWASP API Top 10 Verification

This repository implements defense-in-depth security principles across authentication, authorization, transactional concurrency, and third-party webhook integrations.

---

## 1. Vulnerability Reporting Policy

We take security issues seriously. If you discover a security vulnerability in this project, please report it privately:

- **Security Contact**: `security@example.com` (or create a private GitHub Security Advisory)
- **Response Timeline**: Initial acknowledgment within 24 hours; patch and remediation advisory within 7 business days.
- **Scope**: Please do not publicly disclose vulnerabilities before a patch has been released.

---

## 2. OWASP API Security Top 10 (2023) Checklist

| Vulnerability | Description & Risk | Implementation Defense in Project |
| :--- | :--- | :--- |
| **API1:2023 Broken Object Level Authorization (BOLA)** | User modifies another user's cart or views another customer's orders by altering IDs in URLs. | • Carts are strictly bound to `req.user.userId` from verified JWTs (`GET /cart`, `POST /cart/items`).<br>• `GET /orders/:id` and `POST /orders/:id/cancel` verify that `order.userId === user.userId` or `user.role === ADMIN`, throwing `403 Forbidden` on mismatch.<br>• Verified by automated tests in `test/security.e2e-spec.ts`. |
| **API2:2023 Broken Authentication** | Credential stuffing, weak password storage, unrevocable tokens, or replay attacks. | • Passwords hashed with **Argon2id** (memory cost 64MB, time cost 3 iterations).<br>• Short-lived JWT access tokens (15-minute TTL).<br>• Refresh tokens hashed via **SHA-256** in database.<br>• **Token Family Rotation**: Revoked or replayed refresh tokens immediately invalidate all sibling tokens in that family. |
| **API3:2023 Broken Object Property Level Auth (Mass Assignment)** | Client injects sensitive fields (e.g. `role: ADMIN` or `totalPrice: 0`) in request payloads. | • Global `ValidationPipe` with `{ whitelist: true, forbidNonWhitelisted: true }`.<br>• Extraneous or non-whitelisted properties immediately trigger `400 Bad Request`.<br>• Unit & E2E tests verify privilege escalation attempts (`role: ADMIN` during registration) fail. |
| **API4:2023 Unrestricted Resource Consumption** | DoS via high-frequency requests or large payload sizes. | • Rate limiting with `@nestjs/throttler` (`ThrottlerGuard`, `X-RateLimit-*` response headers).<br>• Strict pagination limits (`limit <= 100`, `page >= 1`).<br>• Request body size limits enforced at the Express parser level. |
| **API5:2023 Broken Function Level Authorization (BFLA)** | Regular customers accessing administrative control plane endpoints. | • Global `RolesGuard` enforcing `@Roles(Role.ADMIN)`.<br>• All `/api/v1/admin/*` and catalog write operations (`POST /products`, `PATCH /products/:id`, `DELETE /products/:id`) return `403 Forbidden` when called with customer credentials.<br>• Verified in `test/security.e2e-spec.ts`. |
| **API6:2023 Unrestricted Access to Sensitive Flows** | Race conditions on checkout, double-spending stock, or duplicate charges. | • Atomic stock decrements via SQL row-level check: `WHERE id = $1 AND stock >= $2`.<br>• DB constraint `CHECK (stock >= 0)`.<br>• Idempotency key requirement on `POST /orders/checkout` preventing duplicate orders. |
| **API7:2023 Server-Side Request Forgery (SSRF)** | Exploitation of unvalidated external URLs supplied by clients. | • No user-supplied URLs are fetched by the server.<br>• Webhook integration only receives signed ingress payloads; it never initiates outbound requests to user-specified destinations. |
| **API8:2023 Security Misconfiguration** | Insecure HTTP headers, verbose error stack traces, open CORS. | • **Helmet** enabled (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, HSTS).<br>• CORS restricted to explicit origin allow-list (`CORS_ORIGIN`).<br>• Global `HttpExceptionFilter` sanitizes error responses to prevent internal stack traces from leaking in production. |
| **API9:2023 Improper Inventory Management** | Undocumented or shadow endpoints exposed to the public. | • Standardized prefix `api/v1` for all business endpoints.<br>• Complete Swagger / OpenAPI 3.0 documentation generated dynamically at `/docs`.<br>• Deprecated routes are retired rather than left unauthenticated. |
| **API10:2023 Unsafe Consumption of APIs** | Blind trust in external vendor webhooks or third-party responses. | • Stripe webhook payloads verified cryptographically using HMAC-SHA256 signature (`Stripe.webhooks.constructEvent`).<br>• Replay attacks rejected idempotently by tracking `lastWebhookEventId`. |

---

## 3. Cryptographic Standards

- **Password Hashing**: Argon2id (`argon2.argon2id`)
- **Refresh Token Storage**: SHA-256 hex digest (`node:crypto.createHash('sha256')`)
- **JWT Signatures**: HMAC-SHA256 (`HS256`) with minimum 32-character high-entropy secret
- **Webhook Signature Verification**: HMAC-SHA256 with Stripe webhook secret and tolerance window

---

## 4. Automated Security Verification

Automated security regression tests are located in [`test/security.e2e-spec.ts`](file:///d:/Projects/e-commerce-nestjs-v1/test/security.e2e-spec.ts):

```bash
# Run the complete security regression test suite
npx jest --config ./test/jest-e2e.json test/security.e2e-spec.ts
```

All 21 automated checks verify:
1. Cross-tenant order isolation (403 Forbidden).
2. Unauthenticated endpoint access (401 Unauthorized).
3. Privilege escalation and mass assignment rejection (400 Bad Request).
4. Administrative role isolation on all admin control plane routes (403 Forbidden).
5. Stripe webhook signature verification and forgery rejection (400 Bad Request).
