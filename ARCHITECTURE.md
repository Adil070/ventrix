# Ventrix — Architecture, Folder Structure & Run Guide

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | Turborepo (npm workspaces) |
| Backend | Node.js 20 + Express 4 + TypeScript |
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript |
| Database | PostgreSQL 16 (via Prisma ORM 5) |
| Cache | Redis 7 (ioredis) |
| Queue | Bull (Redis-backed) |
| Real-time | Socket.IO 4 |
| Auth | JWT + bcryptjs + Google OAuth 2.0 + TOTP |
| Storage | AWS S3 / MinIO |
| Email | Nodemailer (SMTP) |
| PDF | PDFKit |
| UI | Tailwind CSS + Radix UI + Recharts |
| State | Zustand (global) + TanStack Query (server state) |
| Forms | React Hook Form + Zod |
| Containerization | Docker + Docker Compose |

---

## Repository Layout

```
ventrix/                           ← monorepo root
├── apps/
│   ├── api/                       ← Express backend
│   └── web/                       ← Next.js frontend
├── packages/                      ← (shared packages, future use)
├── docker-compose.yml             ← dev infrastructure
├── docker-compose.prod.yml        ← production infrastructure
├── turbo.json                     ← Turborepo pipeline config
├── package.json                   ← root workspace manifest
├── .env.example                   ← environment variable template
├── FEATURES.md                    ← feature reference
└── ARCHITECTURE.md                ← this file
```

---

## Backend — `apps/api/`

```
apps/api/
├── prisma/
│   ├── schema.prisma              ← single source of truth for DB schema
│   ├── seed.ts                    ← seeds demo org, users, products
│   └── migrations/                ← auto-generated SQL migrations
│       └── 20260531193328_init/
│           └── migration.sql
├── src/
│   ├── server.ts                  ← HTTP server bootstrap (port binding)
│   ├── app.ts                     ← Express app setup, middleware stack, route mounting
│   ├── config/
│   │   └── index.ts               ← typed env vars (dotenv → validated config object)
│   ├── infrastructure/
│   │   ├── database/index.ts      ← Prisma client singleton
│   │   ├── cache/index.ts         ← ioredis singleton
│   │   ├── email/index.ts         ← Nodemailer transporter + template helpers
│   │   ├── logger/index.ts        ← Pino structured logger
│   │   ├── queues/index.ts        ← Bull queue definitions (email, notification, report)
│   │   ├── socket/index.ts        ← Socket.IO server + room/event helpers
│   │   ├── storage/index.ts       ← S3/MinIO StorageService class
│   │   └── swagger/index.ts       ← Swagger spec + UI route
│   ├── modules/
│   │   ├── accounting/
│   │   │   ├── accounting.engine.ts   ← Trial Balance, P&L, Balance Sheet, Cash Flow
│   │   │   └── accounting.router.ts   ← REST routes
│   │   ├── analytics/
│   │   │   └── analytics.router.ts
│   │   ├── auth/
│   │   │   ├── auth.controller.ts     ← register, login, refresh, OAuth, 2FA, reset
│   │   │   ├── auth.dto.ts            ← Zod schemas for auth payloads
│   │   │   ├── auth.router.ts
│   │   │   └── auth.service.ts        ← token generation, password hashing
│   │   ├── banking/
│   │   │   └── banking.router.ts      ← bank accounts + transactions + reconciliation
│   │   ├── billing/
│   │   │   ├── invoice.dto.ts         ← Zod schemas
│   │   │   ├── invoice.router.ts      ← CRUD + PDF + email + payment
│   │   │   ├── invoice.service.ts     ← GST calc, stock deduction, journal entry
│   │   │   ├── quotation.router.ts    ← quotations + convert-to-invoice
│   │   │   └── sales-order.router.ts  ← sales orders + convert-to-invoice
│   │   ├── crm/
│   │   │   └── crm.router.ts          ← leads, pipeline, activities, tasks
│   │   ├── customers/
│   │   │   ├── customer.controller.ts
│   │   │   ├── customer.dto.ts
│   │   │   ├── customer.router.ts
│   │   │   └── customer.service.ts    ← ledger, outstanding computation
│   │   ├── dashboard/
│   │   │   └── dashboard.router.ts    ← aggregated KPI endpoint
│   │   ├── documents/
│   │   │   └── document.router.ts     ← file upload/download via S3
│   │   ├── employees/
│   │   │   └── employee.router.ts     ← employee CRUD + attendance + salary
│   │   ├── expenses/
│   │   │   └── expense.router.ts      ← expenses + categories
│   │   ├── gst/
│   │   │   ├── gst.engine.ts          ← GSTR-1, GSTR-3B, GSTIN validation
│   │   │   └── gst.router.ts          ← GST reports + HSN/SAC + tax rates
│   │   ├── inventory/
│   │   │   ├── inventory.controller.ts
│   │   │   ├── inventory.engine.ts    ← FIFO / weighted-avg valuation
│   │   │   ├── inventory.router.ts    ← adjustments, transfers
│   │   │   └── inventory.service.ts   ← stock entry logic
│   │   ├── manufacturing/
│   │   │   └── manufacturing.router.ts ← BOM + production orders
│   │   ├── notifications/
│   │   │   └── notification.router.ts
│   │   ├── organizations/
│   │   │   └── organization.router.ts ← org profile, branches, price lists, payment terms
│   │   ├── payments/
│   │   │   └── payment.service.ts     ← payment allocation, invoice reconciliation
│   │   ├── products/
│   │   │   └── product.service.ts     ← product CRUD, categories, brands, units
│   │   ├── purchases/
│   │   │   └── purchase.service.ts    ← purchase bill, stock increment, journal entry
│   │   ├── reports/
│   │   │   └── report.router.ts       ← all business reports
│   │   ├── subscriptions/
│   │   ├── suppliers/
│   │   │   └── supplier.service.ts    ← supplier CRUD + ledger
│   │   ├── users/
│   │   └── warehouse/
│   │       └── warehouse.router.ts    ← warehouse CRUD + per-warehouse stock view
│   └── shared/
│       ├── errors/
│       │   └── index.ts              ← AppError, NotFoundError, ValidationError …
│       ├── helpers/
│       │   └── response.helper.ts    ← successResponse, createdResponse, paginatedResponse
│       └── middleware/
│           ├── auth.middleware.ts    ← JWT verification, attaches req.userId / req.organizationId
│           ├── error-handler.ts      ← global Express error handler
│           ├── rate-limit.ts         ← per-route rate limiters
│           └── tenant.ts             ← organizationId extraction / validation
├── package.json
└── tsconfig.json
```

---

## Frontend — `apps/web/`

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx             ← root layout, providers, theme
│   │   ├── page.tsx               ← landing / redirect
│   │   ├── globals.css            ← Tailwind base styles
│   │   ├── providers.tsx          ← QueryClientProvider + ThemeProvider
│   │   ├── (app)/                 ← authenticated app shell (sidebar + header)
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/
│   │   │   ├── invoices/
│   │   │   ├── purchases/
│   │   │   ├── products/
│   │   │   ├── customers/
│   │   │   ├── suppliers/
│   │   │   ├── expenses/
│   │   │   ├── accounting/
│   │   │   ├── reports/
│   │   │   ├── gst/
│   │   │   ├── crm/
│   │   │   ├── employees/
│   │   │   ├── manufacturing/
│   │   │   ├── warehouse/
│   │   │   └── settings/
│   │   └── auth/
│   │       ├── login/
│   │       └── register/
│   ├── components/
│   │   ├── ui/                    ← Radix UI primitives (Button, Dialog, Select …)
│   │   ├── forms/                 ← React Hook Form wrappers
│   │   ├── charts/                ← Recharts wrappers (AreaChart, BarChart, PieChart)
│   │   ├── layout/                ← Sidebar, Header, Breadcrumb
│   │   └── shared/                ← DataTable, FileUpload, Pagination, EmptyState
│   ├── hooks/                     ← custom React hooks (useDebounce, useLocalStorage …)
│   ├── lib/
│   │   ├── api.ts                 ← Axios instance with interceptors + token refresh
│   │   └── utils.ts               ← cn(), formatCurrency(), formatDate() …
│   ├── store/
│   │   ├── auth.store.ts          ← Zustand: user, organization, tokens
│   │   └── ui.store.ts            ← Zustand: sidebar state, theme
│   └── types/                     ← shared TypeScript interfaces
├── next.config.js
├── tailwind.config.ts
└── tsconfig.json
```

---

## Database Schema Overview

All tables live in a single PostgreSQL database. Key relationships:

```
Organization
  ├── Branches
  ├── Warehouses
  ├── Users (via OrganizationMember)
  ├── Customers → Invoices → InvoiceItems
  │                       → Payments
  ├── Suppliers → Purchases → PurchaseItems
  │                        → Payments
  ├── Products → StockEntries (per warehouse)
  │           → BatchLots
  │           → ProductVariants
  ├── Accounts (Chart of Accounts)
  │   └── JournalEntries → JournalEntryLines
  ├── BillOfMaterials → BOMComponents
  │   └── ProductionOrders → MaterialIssues
  ├── Leads → LeadActivities
  │         → Tasks
  ├── Expenses → ExpenseCategory
  ├── BankAccounts → BankTransactions
  ├── Employees → EmployeeAttendance
  │            → SalaryRecords
  ├── Documents
  ├── Notifications
  └── Subscriptions
```

---

## Request Lifecycle

```
Client Request
  │
  ▼
helmet() + cors() + compression() + morgan()    ← global middleware
  │
  ▼
express-rate-limit                              ← rate limiting
  │
  ▼
Route Handler
  │
  ├── authMiddleware                            ← verify JWT → req.userId
  │
  ├── tenantMiddleware                          ← resolve req.organizationId
  │
  ├── Zod schema validation                     ← parse & validate req.body
  │
  ├── Service / Router logic
  │     ├── prisma.$transaction()               ← atomic DB operations
  │     ├── redis.get/set                       ← cache layer
  │     └── queue.add()                         ← async jobs (email, notifications)
  │
  └── successResponse / paginatedResponse       ← uniform JSON envelope
        │
        ▼
      errorHandler middleware                   ← catches AppError, ZodError, PrismaError
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `development` / `production` | `development` |
| `API_PORT` | Backend port | `8000` |
| `DATABASE_URL` | PostgreSQL connection string | see example |
| `REDIS_URL` | Redis connection string | see example |
| `JWT_SECRET` | Min 32-char secret for access tokens | — |
| `JWT_REFRESH_SECRET` | Min 32-char secret for refresh tokens | — |
| `JWT_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `SMTP_HOST` | SMTP server host | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `S3_ENDPOINT` | S3 / MinIO endpoint | — |
| `S3_REGION` | AWS region | `ap-south-1` |
| `S3_BUCKET` | Bucket name | — |
| `S3_ACCESS_KEY` | Access key | — |
| `S3_SECRET_KEY` | Secret key | — |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO | `false` |

---

## How to Run

### Option A — Docker (recommended for full stack)

```bash
# Start all infrastructure (PostgreSQL, Redis, MinIO)
npm run docker:dev

# Install dependencies
npm install

# Run DB migrations and seed demo data
npm run db:migrate
npm run db:seed

# Start dev servers (API on :8000, Web on :3000)
npm run dev
```

### Option B — Manual (without Docker)

**Prerequisites:** PostgreSQL 16+, Redis 7+, Node.js 20+

```bash
# 1. Install all dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env
# Edit .env with your database/redis credentials

# 3. Generate Prisma client
npm run db:generate

# 4. Run migrations
npm run db:migrate

# 5. Seed demo data
npm run db:seed

# 6. Start development
npm run dev
```

### Prisma Studio (visual DB browser)

```bash
npm run db:studio
# Opens at http://localhost:5555
```

### Production Build

```bash
npm run build
npm run start
```

---

## Individual App Commands

```bash
# Backend only
cd apps/api
npm run dev          # tsx watch (hot reload)
npm run build        # tsc → dist/
npm run start        # node dist/server.js
npm run type-check   # tsc --noEmit (zero errors required)
npm run db:migrate   # prisma migrate dev
npm run db:seed      # tsx prisma/seed.ts
npm run db:studio    # prisma studio

# Frontend only
cd apps/web
npm run dev          # next dev (port 3000)
npm run build        # next build
npm run start        # next start
npm run type-check   # tsc --noEmit
```

---

## API Base URLs

| Service | Dev URL |
|---------|---------|
| REST API | `http://localhost:8000/api` |
| Swagger UI | `http://localhost:8000/api/docs` |
| WebSocket | `ws://localhost:8000` |
| Frontend | `http://localhost:3000` |
| Prisma Studio | `http://localhost:5555` |

---

## Key Architectural Decisions

### 1. Single Prisma transaction for financial events
Every operation that touches money and inventory (create invoice, record payment, receive purchase) wraps all DB writes in `prisma.$transaction()`. This prevents partial-write bugs where, e.g., stock is decremented but the invoice fails to save.

### 2. Organization-scoped middleware
The `tenantMiddleware` reads `organizationId` from the verified JWT and attaches it to `req.organizationId`. Every Prisma query in every router/service uses this value in its `where` clause, making cross-tenant data leakage structurally impossible.

### 3. Uniform response envelope
All API responses use one of three helpers:
```json
{ "success": true, "message": "...", "data": { ... } }
{ "success": true, "message": "...", "data": [...], "pagination": { ... } }
{ "success": false, "message": "...", "code": "..." }
```

### 4. Background jobs for async work
Email sending, PDF generation for bulk reports, and notification dispatch are offloaded to Bull queues backed by Redis. This keeps HTTP response times fast.

### 5. Frontend API layer
`apps/web/src/lib/api.ts` is an Axios instance that:
- Attaches the `Authorization: Bearer <token>` header on every request.
- Intercepts 401 responses, silently refreshes the access token, and retries the original request.
- Exposes typed service functions used by TanStack Query hooks.

---

## Production Deployment (Docker Compose)

```bash
# Build production images and start all services
npm run docker:prod

# Services started:
#   postgres   → internal port 5432
#   redis      → internal port 6379
#   minio      → internal port 9000 / console 9001
#   api        → exposed on 8000
#   web        → exposed on 3000
#   nginx      → reverse proxy on 80 / 443
```

The production compose file adds:
- Nginx reverse proxy with SSL termination.
- Named volumes for data persistence.
- `restart: always` policies.
- Resource limits (CPU/memory).
- Health checks for all services.
