# Ventrix — Complete Feature Reference

Ventrix is a multi-industry ERP SaaS platform delivering modular operational management for mid-to-large businesses. Every feature below is implemented end-to-end across the backend API and the Next.js frontend.

---

## 1. Authentication & Security

### How it works
- **JWT-based auth** with short-lived access tokens (15 min default) and long-lived refresh tokens (7 days).
- Refresh token rotation — new refresh token issued on every refresh request.
- **Google OAuth 2.0** (Passport.js) for social login.
- **bcryptjs** password hashing (cost factor 12).
- Two-Factor Authentication (TOTP) via `speakeasy` — users can enable 2FA and scan a QR code with any authenticator app.
- Rate limiting on all auth endpoints (express-rate-limit).
- Helmet.js security headers on all responses.

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, returns access + refresh token |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Revoke refresh token |
| GET | `/api/auth/google` | Initiate Google OAuth |
| POST | `/api/auth/2fa/enable` | Enable TOTP 2FA |
| POST | `/api/auth/2fa/verify` | Verify TOTP code |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Reset with token |

---

## 2. Multi-Tenant Organizations

### How it works
Every resource in the platform is scoped to an **Organization**. A user may belong to multiple organizations and switch between them. The `tenant` middleware reads `organizationId` from the JWT and attaches it to every request, so no query ever leaks data across organizations.

### What you can manage
- Organization profile: name, GSTIN, PAN, logo, address, financial year start.
- **Branches** — physical locations/offices under one organization.
- **Warehouses** — each branch can have multiple warehouses.
- **Invoice / Purchase prefixes** — customize numbering per org.
- **Price Lists** — define customer-specific or segment-specific pricing with discount rules.
- **Payment Terms** — Net 30, COD, Due on receipt, etc.
- **Units of Measurement** — custom units (kg, pcs, box, litre …).
- **Roles & Permissions** — owner / admin / manager / accountant / sales / viewer.

---

## 3. Dashboard

### How it works
Single API call aggregates data from invoices, purchases, expenses, products, and customers into one response. The frontend renders charts using **Recharts**.

### Widgets
- **Revenue vs Expenses** bar chart (current month & trend).
- **Profit & Loss** summary card.
- **Outstanding Receivables** — total amount due from customers.
- **Outstanding Payables** — total amount owed to suppliers.
- **Cash Flow** — net cash in/out.
- **Top 5 Customers** by revenue.
- **Top 5 Products** by quantity sold.
- **Low Stock Alert** — products below reorder point.
- **Recent Invoices** list.
- **Recent Purchases** list.
- **Expense breakdown** by category (pie chart).

---

## 4. Inventory Management

### How it works
Products carry `openingStock` as the live stock counter. Every **StockEntry** record (PURCHASE, SALE, ADJUSTMENT, TRANSFER, OPENING_STOCK, PRODUCTION) mutates this counter atomically inside a Prisma transaction. The inventory engine (`inventory.engine.ts`) handles FIFO/WEIGHTED_AVERAGE valuation.

### Features
- **Product catalog** — name, SKU, barcode, HSN/SAC code, category, brand, unit, images.
- **Stock tracking** toggle per product.
- **Batch & Lot tracking** — manufacturing date, expiry date, batch number.
- **Serial number tracking** — track individual units.
- **Product variants** — size, color, or any attribute.
- **Multi-warehouse stock** — stock moves between warehouses via Stock Transfers.
- **Reorder points** — system flags low-stock products.
- **Valuation methods** — FIFO or Weighted Average.
- **Stock adjustment** — write-off, damage, surplus entries.
- **Opening stock entry** on product creation.

### Endpoints (sample)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List products with filters |
| POST | `/api/products` | Create product |
| GET | `/api/products/:id/stock-history` | All stock movements for a product |
| GET | `/api/products/low-stock` | Products below reorder point |
| POST | `/api/inventory/adjustments` | Stock adjustment entry |
| GET | `/api/inventory/transfers` | List stock transfers |
| POST | `/api/inventory/transfers` | Create warehouse transfer |

---

## 5. Billing (Invoices, Quotations, Sales Orders)

### How it works
All three documents share the same line-item logic (tax calculation, discount, rounding). An invoice creation triggers inventory decrement and a Journal Entry (double-entry accounting) inside a single transaction.

### Invoices
- GST-compliant: CGST + SGST (intra-state) or IGST (inter-state) auto-calculated per line item.
- Tax-inclusive / exclusive toggle.
- Discounts at item level (%) and order level (flat or %).
- Shipping charges, round-off.
- Credit/debit notes for returns.
- Payment tracking — partial payments update `paidAmount` and `balanceAmount`.
- PDF generation (PDFKit) with company logo, QR code, and GST breakup.
- E-mail invoice to customer.
- Status flow: DRAFT → SENT → PARTIALLY_PAID → PAID / OVERDUE / CANCELLED.

### Quotations
- Send quotations to customers; they can be converted to invoices in one click.
- Validity date, terms & conditions.
- Status: DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED.

### Sales Orders
- Confirm a sale before invoicing.
- Fulfilment tracking (`fulfilledQty` per line).
- Convert to invoice when goods are dispatched.

### Endpoints (sample)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invoices` | List invoices |
| POST | `/api/invoices` | Create invoice |
| GET | `/api/invoices/:id/pdf` | Download PDF |
| POST | `/api/invoices/:id/send-email` | Email invoice |
| POST | `/api/invoices/:id/payment` | Record payment |
| POST | `/api/quotations/:id/convert` | Convert quotation → invoice |
| POST | `/api/sales-orders/:id/convert` | Convert SO → invoice |

---

## 6. Purchases

### How it works
Mirrors the billing flow for the supply side. Creating a purchase bill:
1. Validates supplier and line items.
2. Increments `openingStock` for each product.
3. Creates a `StockEntry` of type PURCHASE.
4. Updates `paidAmount` and `balanceAmount` on the purchase.
5. Records a Journal Entry (Inventory Dr, Accounts Payable Cr).

### Features
- Supplier bills with full GST breakup.
- Purchase orders (draft) → Goods Receipt → Bill.
- Reverse-charge mechanism toggle.
- Partial payment recording.
- Return orders / debit notes.
- Supplier ledger — chronological statement with running balance.

---

## 7. Payments

### How it works
A payment can be linked to one or more invoices/purchases via allocations. The `PaymentService.recordPayment()` runs inside a transaction: it creates the Payment record and updates `paidAmount` / `balanceAmount` on each linked document.

### Features
- Modes: Cash, Card, UPI, Bank Transfer, Cheque.
- Multi-allocation — one payment split across multiple invoices.
- Advance payments (unallocated).
- Auto-reconcile when `balanceAmount` reaches zero.

---

## 8. Customers & Suppliers

### How it works
Both modules follow the same pattern (CRUD + ledger + statement). Every customer/supplier has full contact details, GSTIN, PAN, credit limit, credit days, opening balance, and billing address.

### Customer Features
- Customer ledger — all invoices, payments, credit notes with running balance.
- Outstanding balance computed from live invoice data.
- Credit limit enforcement (configurable).
- Customer groups / tags.
- Referred-by tracking.

### Supplier Features
- Supplier ledger — all purchases and payments.
- Outstanding payable computed from live purchase data.

---

## 9. GST (Goods & Services Tax)

### How it works
The `GSTEngine` (`gst.engine.ts`) handles all GST computation and report generation. It determines CGST/SGST vs IGST based on the customer's state vs organization's state.

### Features
- **GSTIN validation** — checksum + format.
- **GSTR-1** — outward supplies report (B2B, B2C large, B2CS, CDNR, exports).
- **GSTR-2** — inward supplies (purchase register) per period.
- **GSTR-3B** — monthly summary return with net tax payable.
- **HSN/SAC code master** — with default GST rate.
- **Tax Rate master** — create custom tax slabs.
- **GST Summary** dashboard — output tax, input tax, net GST payable.
- Reverse charge tracking.

---

## 10. Accounting (Double-Entry)

### How it works
Every financial event (invoice, payment, expense, purchase) auto-creates a **Journal Entry** with balanced debit/credit lines via `AccountingEngine`. The Chart of Accounts follows standard Indian accounting hierarchy.

### Chart of Accounts
Pre-seeded accounts:
- **Assets** — Cash, Bank, Accounts Receivable, Inventory, Fixed Assets.
- **Liabilities** — Accounts Payable, GST Payable, Loans.
- **Equity** — Owner's Capital, Retained Earnings.
- **Revenue** — Sales, Other Income.
- **Expenses** — COGS, Operating Expenses.

### Features
- Manual Journal Entries with multi-line debit/credit.
- General Ledger — per-account transaction history.
- **Trial Balance** — debit/credit totals per account.
- **Profit & Loss Statement** — revenue minus expenses for any period.
- **Balance Sheet** — assets = liabilities + equity snapshot.
- **Cash Flow Statement** — operating, investing, financing.
- Account-level drill-down.

---

## 11. Banking

### How it works
Bank accounts are linked to the Chart of Accounts. Transactions are imported or manually entered and then **reconciled** against bank statements.

### Features
- Multiple bank accounts (savings, current, OD).
- IFSC code, branch name, default account flag.
- Manual transaction entry (debit/credit).
- Bank reconciliation — mark transactions as reconciled.
- Unreconciled transactions report.
- Bank account balance tracking (`currentBalance`, `openingBalance`).

---

## 12. Expenses

### How it works
Expenses are categorized, approved, and tracked against the P&L. Files (receipts) are uploaded to S3.

### Features
- Expense categories (global master).
- Recurring expense support (`isRecurring` flag).
- Approval workflow (PENDING → APPROVED → REJECTED).
- Receipt upload to S3.
- GST on expenses (taxable expenses).
- Expense reports by category / period.
- Payment mode tracking.

---

## 13. CRM (Customer Relationship Management)

### How it works
Leads flow through a configurable pipeline. Tasks can be assigned to team members. All activities are logged against the lead.

### Features
- **Lead management** — capture leads with source, stage, expected value.
- **Lead pipeline** — visualize by status (NEW → CONTACTED → QUALIFIED → PROPOSAL → WON/LOST).
- **Activities log** — calls, emails, meetings, notes per lead.
- **Task management** — assign tasks to users with due dates and priorities.
- **Pipeline analytics** — total pipeline value per stage.
- Lead → Customer conversion.

---

## 14. Reports

### How it works
All reports hit aggregation queries (Prisma `groupBy`, `aggregate`) for performance. Complex reports use raw SQL via `prisma.$queryRaw`.

### Available Reports
| Report | Description |
|--------|-------------|
| Sales Summary | Revenue, tax, discount totals + top products/customers |
| Purchase Summary | Spend totals + top suppliers |
| Outstanding Receivables | Customers with unpaid invoices |
| Outstanding Payables | Suppliers with unpaid bills |
| Expense Summary | Spend by category |
| Inventory Aging | Days since last sale per product |
| Fast-Moving Products | Top sold products in last N days |
| GSTR-1 | GST outward supply return |
| GSTR-2 | GST inward supply register |
| GSTR-3B | GST monthly summary return |
| GST Summary | Output vs input tax, net payable |
| Trial Balance | Per-account debit/credit totals |
| P&L Statement | Revenue minus expenses |
| Balance Sheet | Assets, liabilities, equity |
| Cash Flow | Operating / investing / financing |

---

## 15. Employees & Payroll

### How it works
Employee records link to a User account (optional). Attendance is tracked daily. Salary records are computed monthly.

### Features
- Employee profiles — designation, department, salary type (monthly/daily/hourly).
- Bank details (JSON), address.
- **Attendance tracking** — daily PRESENT/ABSENT/HALF_DAY/LEAVE entries via upsert.
- **Salary records** — basic + allowances − deductions = net salary.
- Paid/unpaid salary flag with payment date.

---

## 16. Manufacturing / Bill of Materials

### How it works
A **Bill of Material (BOM)** defines what raw materials are needed to produce a finished product. When a Production Order is completed, the system atomically deducts raw material stock and increments finished goods stock.

### Features
- BOM creation with components (raw materials + quantities + scrap %).
- **Production Orders** — planned quantity, scheduled dates, status flow (DRAFT → IN_PROGRESS → COMPLETED).
- Complete production — auto-adjusts stock for all BOM components and the finished product.
- Material issues tracking per production order.
- Production cost calculation.

---

## 17. Documents

### How it works
Files are uploaded via multipart form-data, stored on S3 (or MinIO in dev), and a metadata record is created in the `Document` table. The file URL is returned for direct access.

### Features
- Upload any file type (max 25 MB).
- Linked to invoices or purchases.
- Document types: INVOICE, PURCHASE_ORDER, CONTRACT, ATTACHMENT, etc.
- Download via stored URL.
- Soft delete (record deleted, S3 key still accessible for audit).

---

## 18. Notifications

### How it works
Notifications are stored in the DB and pushed to connected clients via **Socket.IO**. The frontend shows a real-time notification bell.

### Features
- In-app notifications (invoice overdue, low stock, payment received).
- Mark as read / mark all as read.
- Real-time delivery via WebSocket.
- Email notifications via Nodemailer (SMTP).
- Queue-based delivery (Bull + Redis) to avoid blocking request threads.

---

## 19. Subscriptions & Billing Plans

### How it works
Organizations subscribe to a plan (FREE / STARTER / PROFESSIONAL / ENTERPRISE). The subscription module tracks plan limits (number of invoices, products, users) and blocks operations when limits are exceeded.

### Features
- Plan master with feature flags and limits.
- Subscription activation, renewal, cancellation.
- Trial period support.
- Stripe-compatible payment gateway hooks (webhook handler ready).

---

## 20. Analytics

### How it works
The analytics module provides time-series and ranking data used by the dashboard charts. All queries use efficient `groupBy` aggregations.

### Metrics
- Revenue over time (daily/weekly/monthly).
- Invoice count and average order value trend.
- Top products by revenue.
- Top customers by revenue.
- Stock level overview (products with stock > 0).
- Expense trends by category.

---

## 21. Warehouse Management

### How it works
Every `StockEntry` is tagged with a `warehouseId`. Stock is tracked per warehouse. Transfers move stock between warehouses via a two-leg transaction (OUT from source, IN to destination).

### Features
- Multiple warehouses per organization.
- Warehouse locations (row, rack, bin).
- Per-warehouse stock view.
- Stock transfers with full audit trail.
- Default warehouse setting.

---

## Real-Time Features (WebSocket)

- **Socket.IO** server attached to the Express HTTP server.
- Clients authenticate via JWT on socket handshake.
- Rooms scoped per organization (`org:{id}`).
- Events: `notification:new`, `invoice:created`, `stock:low`, `payment:received`.

---

## Background Jobs (Bull + Redis)

| Queue | Jobs |
|-------|------|
| `email` | Send invoice email, password reset, welcome email |
| `notification` | Push in-app notifications |
| `report` | Generate heavy reports asynchronously |
| `invoice` | Auto-mark overdue invoices |

---

## File Storage (S3 / MinIO)

- `uploadBuffer()` — upload file buffer with auto-generated key.
- `getSignedDownloadUrl()` — time-limited download URLs.
- `deleteFile()` — permanent deletion.
- `getPublicUrl()` — direct public URL (for logos, product images).
- Folder structure: `{orgId}/invoices/`, `{orgId}/documents/`, `{orgId}/logos/`, etc.

---

## API Documentation (Swagger)

- Auto-generated Swagger UI available at `http://localhost:8000/api/docs`.
- All endpoints documented with request/response schemas.
