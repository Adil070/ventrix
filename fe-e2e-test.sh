#!/bin/bash
# Frontend End-to-End Test - mirrors exactly what each FE screen calls
API="http://localhost:4000/api/v1"
PASS=0; FAIL=0
RESULTS=""

log() { echo -e "$1"; }
check() {
  local name="$1" cond="$2" detail="$3"
  if [ "$cond" == "true" ]; then PASS=$((PASS+1)); echo "✅ $name"; 
  else FAIL=$((FAIL+1)); echo "❌ $name -- $detail"; RESULTS="$RESULTS\n❌ $name: $detail"; fi
}

echo "========================================"
echo "  FRONTEND E2E TEST (API mirror)"
echo "========================================"

# ---- AUTH: Login (login/page.tsx) ----
LOGIN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"owner@demotrade.local","password":"Owner@123"}')
TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken')
ORG=$(echo "$LOGIN" | jq -r '.data.organization.id // .data.user.organizations[0].organizationId')
check "Auth: Login" "$([ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo true || echo false)" "no token: $LOGIN"

AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-Organization-ID: $ORG")
H="-H Content-Type:application/json"

# ---- DASHBOARD (dashboard/page.tsx -> api.dashboard.getSummary) ----
D=$(curl -s "${AUTH[@]}" $API/dashboard)
check "Dashboard: getSummary" "$([ "$(echo "$D" | jq -r '.success')" == "true" ] && echo true || echo false)" "$D"
KPIS=$(echo "$D" | jq -r '.data.kpis // empty')
check "Dashboard: has kpis" "$([ -n "$KPIS" ] && echo true || echo false)" "no kpis in dashboard"

# ---- CUSTOMERS (customers/page.tsx) ----
C=$(curl -s "${AUTH[@]}" "$API/customers?search=&page=1&limit=20")
check "Customers: list" "$([ "$(echo "$C" | jq -r '.success')" == "true" ] && echo true || echo false)" "$C"
# FE sends: name, email, mobile, gstin, pan, customerType, creditLimit, creditDays, openingBalance, billingAddress
TS=$(date +%s)
CC=$(curl -s -X POST "${AUTH[@]}" $H $API/customers -d "{\"name\":\"FE Test Cust $TS\",\"email\":\"fe$TS@t.com\",\"mobile\":\"9876500000\",\"customerType\":\"RETAIL\",\"creditLimit\":50000,\"creditDays\":30,\"openingBalance\":0}")
CID=$(echo "$CC" | jq -r '.data.id // .data.customer.id')
check "Customers: create (FE payload)" "$([ -n "$CID" ] && [ "$CID" != "null" ] && echo true || echo false)" "$CC"

# ---- PRODUCTS (products/page.tsx) ----
P=$(curl -s "${AUTH[@]}" "$API/products?search=&limit=50")
check "Products: list" "$([ "$(echo "$P" | jq -r '.success')" == "true" ] && echo true || echo false)" "$P"
# FE sends: name, sku, type, sellingPrice, purchasePrice, mrp, taxRate, trackInventory, openingStock, reorderLevel, hsnCode
PC=$(curl -s -X POST "${AUTH[@]}" $H $API/products -d "{\"name\":\"FE Test Prod $TS\",\"sku\":\"FE-$TS\",\"type\":\"PRODUCT\",\"sellingPrice\":1000,\"purchasePrice\":700,\"mrp\":1200,\"taxRate\":18,\"trackInventory\":true,\"openingStock\":50,\"reorderLevel\":10}")
PID=$(echo "$PC" | jq -r '.data.id // .data.product.id')
check "Products: create (FE payload)" "$([ -n "$PID" ] && [ "$PID" != "null" ] && echo true || echo false)" "$PC"
check "Products: categories" "$([ "$(curl -s "${AUTH[@]}" $API/products/categories | jq -r '.success')" == "true" ] && echo true || echo false)" "categories failed"
check "Products: units" "$([ "$(curl -s "${AUTH[@]}" $API/products/units | jq -r '.success')" == "true" ] && echo true || echo false)" "units failed"
check "Products: low-stock" "$([ "$(curl -s "${AUTH[@]}" $API/products/low-stock | jq -r '.success')" == "true" ] && echo true || echo false)" "low-stock failed"

# ---- SUPPLIERS (suppliers/page.tsx) ----
S=$(curl -s "${AUTH[@]}" "$API/suppliers?search=&page=1&limit=20")
check "Suppliers: list" "$([ "$(echo "$S" | jq -r '.success')" == "true" ] && echo true || echo false)" "$S"
# FE sends: name, email, mobile, gstin, pan, openingBalance, creditDays
SC=$(curl -s -X POST "${AUTH[@]}" $H $API/suppliers -d "{\"name\":\"FE Test Supp $TS\",\"email\":\"sfe$TS@t.com\",\"mobile\":\"9876511111\",\"openingBalance\":0,\"creditDays\":30}")
SID=$(echo "$SC" | jq -r '.data.id // .data.supplier.id')
check "Suppliers: create (FE payload)" "$([ -n "$SID" ] && [ "$SID" != "null" ] && echo true || echo false)" "$SC"

# ---- WAREHOUSE (warehouse/page.tsx -> api.warehouse.list = /warehouses) ----
W=$(curl -s "${AUTH[@]}" $API/warehouses)
check "Warehouse: list" "$([ "$(echo "$W" | jq -r '.success')" == "true" ] && echo true || echo false)" "$W"

# ---- INVENTORY (inventory/page.tsx) ----
check "Inventory: summary" "$([ "$(curl -s "${AUTH[@]}" $API/inventory/summary | jq -r '.success')" == "true" ] && echo true || echo false)" "inv summary failed"
check "Inventory: movements" "$([ "$(curl -s "${AUTH[@]}" $API/inventory/movements | jq -r '.success')" == "true" ] && echo true || echo false)" "inv movements failed"

# ---- PURCHASES (purchases/new/page.tsx) ----
PU=$(curl -s "${AUTH[@]}" "$API/purchases?search=&page=1&limit=20")
check "Purchases: list" "$([ "$(echo "$PU" | jq -r '.success')" == "true" ] && echo true || echo false)" "$PU"
# FE sends: supplierId, purchaseDate, billNumber, paymentMode, items[{productId,quantity,unitPrice,taxRate,discount}], amountPaid
PUC=$(curl -s -X POST "${AUTH[@]}" $H $API/purchases -d "{\"supplierId\":\"$SID\",\"purchaseDate\":\"$(date -I)\",\"billNumber\":\"BILL-$TS\",\"paymentMode\":\"CREDIT\",\"items\":[{\"productId\":\"$PID\",\"quantity\":20,\"unitPrice\":700,\"taxRate\":18,\"discount\":0}],\"amountPaid\":0}")
PUID=$(echo "$PUC" | jq -r '.data.id // .data.purchase.id')
check "Purchases: create (FE payload)" "$([ -n "$PUID" ] && [ "$PUID" != "null" ] && echo true || echo false)" "$PUC"
# verify stock increased to 70
STK=$(curl -s "${AUTH[@]}" $API/products/$PID | jq -r '.data.openingStock // .data.product.openingStock // .data.currentStock')
check "Purchases: stock increased (50->70)" "$([ "$STK" == "70" ] && echo true || echo false)" "stock=$STK expected 70"

# ---- INVOICES (billing/invoices/new/page.tsx) ----
I=$(curl -s "${AUTH[@]}" "$API/invoices?search=&page=1&limit=20")
check "Invoices: list" "$([ "$(echo "$I" | jq -r '.success')" == "true" ] && echo true || echo false)" "$I"
# FE sends: customerId, invoiceDate, dueDate, invoiceType, paymentMode, items[{productId,quantity,unitPrice,taxRate,discount,discountType}], notes, amountPaid
IC=$(curl -s -X POST "${AUTH[@]}" $H $API/invoices -d "{\"customerId\":\"$CID\",\"invoiceDate\":\"$(date -I)\",\"dueDate\":\"$(date -I)\",\"items\":[{\"productId\":\"$PID\",\"description\":\"FE Test Prod\",\"quantity\":5,\"unitPrice\":1000,\"taxRate\":18,\"discountValue\":0}]}")
IID=$(echo "$IC" | jq -r '.data.id // .data.invoice.id')
check "Invoices: create (FE payload)" "$([ -n "$IID" ] && [ "$IID" != "null" ] && echo true || echo false)" "$IC"
# FE detail page: confirm (PATCH)
ICONF=$(curl -s -X PATCH "${AUTH[@]}" $API/invoices/$IID/confirm)
check "Invoices: confirm (PATCH)" "$([ "$(echo "$ICONF" | jq -r '.success')" == "true" ] && echo true || echo false)" "$ICONF"
# verify stock decreased 70->65
STK2=$(curl -s "${AUTH[@]}" $API/products/$PID | jq -r '.data.openingStock // .data.product.openingStock // .data.currentStock')
check "Invoices: stock deducted (70->65)" "$([ "$STK2" == "65" ] && echo true || echo false)" "stock=$STK2 expected 65"
# FE: record payment
IPAY=$(curl -s -X POST "${AUTH[@]}" $H $API/invoices/$IID/payment -d "{\"amount\":1000,\"mode\":\"CASH\",\"paymentDate\":\"$(date -I)\"}")
check "Invoices: record payment" "$([ "$(echo "$IPAY" | jq -r '.success')" == "true" ] && echo true || echo false)" "$IPAY"
# FE: get single invoice (detail page)
check "Invoices: get detail" "$([ "$(curl -s "${AUTH[@]}" $API/invoices/$IID | jq -r '.success')" == "true" ] && echo true || echo false)" "get detail failed"

# ---- PAYMENTS (payments/page.tsx) ----
PM=$(curl -s "${AUTH[@]}" "$API/payments?search=&page=1&limit=20")
check "Payments: list" "$([ "$(echo "$PM" | jq -r '.success')" == "true" ] && echo true || echo false)" "$PM"

# ---- EXPENSES (expenses/page.tsx) ----
E=$(curl -s "${AUTH[@]}" "$API/expenses?page=1&limit=20")
check "Expenses: list" "$([ "$(echo "$E" | jq -r '.success')" == "true" ] && echo true || echo false)" "$E"
check "Expenses: categories" "$([ "$(curl -s "${AUTH[@]}" $API/expenses/categories/list | jq -r '.success')" == "true" ] && echo true || echo false)" "exp cat failed"
EC=$(curl -s -X POST "${AUTH[@]}" $H $API/expenses -d "{\"description\":\"FE Test Exp $TS\",\"amount\":500,\"date\":\"$(date -I)\",\"paymentMode\":\"CASH\",\"taxable\":false,\"gstRate\":0}")
check "Expenses: create (FE payload)" "$([ "$(echo "$EC" | jq -r '.success')" == "true" ] && echo true || echo false)" "$EC"

# ---- ACCOUNTING (accounting/page.tsx) ----
check "Accounting: accounts" "$([ "$(curl -s "${AUTH[@]}" $API/accounting/accounts | jq -r '.success')" == "true" ] && echo true || echo false)" "accounts failed"
check "Accounting: journal" "$([ "$(curl -s "${AUTH[@]}" $API/accounting/journal | jq -r '.success')" == "true" ] && echo true || echo false)" "journal failed"
check "Accounting: trial-balance" "$([ "$(curl -s "${AUTH[@]}" $API/accounting/reports/trial-balance | jq -r '.success')" == "true" ] && echo true || echo false)" "TB failed"
check "Accounting: profit-loss" "$([ "$(curl -s "${AUTH[@]}" $API/accounting/reports/profit-loss | jq -r '.success')" == "true" ] && echo true || echo false)" "PL failed"
check "Accounting: balance-sheet" "$([ "$(curl -s "${AUTH[@]}" $API/accounting/reports/balance-sheet | jq -r '.success')" == "true" ] && echo true || echo false)" "BS failed"

# ---- GST (gst/page.tsx) ----
M=$(date +%-m); Y=$(date +%Y)
check "GST: summary" "$([ "$(curl -s "${AUTH[@]}" "$API/gst/reports/gst-summary?month=$M&year=$Y" | jq -r '.success')" == "true" ] && echo true || echo false)" "gst summary failed"
check "GST: gstr1" "$([ "$(curl -s "${AUTH[@]}" "$API/gst/reports/gstr1?month=$M&year=$Y" | jq -r '.success')" == "true" ] && echo true || echo false)" "gstr1 failed"
check "GST: gstr3b" "$([ "$(curl -s "${AUTH[@]}" "$API/gst/reports/gstr3b?month=$M&year=$Y" | jq -r '.success')" == "true" ] && echo true || echo false)" "gstr3b failed"
check "GST: hsn" "$([ "$(curl -s "${AUTH[@]}" $API/gst/hsn | jq -r '.success')" == "true" ] && echo true || echo false)" "hsn failed"

# ---- REPORTS (reports/page.tsx) ----
check "Reports: sales/summary" "$([ "$(curl -s "${AUTH[@]}" $API/reports/sales/summary | jq -r '.success')" == "true" ] && echo true || echo false)" "sales summary failed"
check "Reports: purchases/summary" "$([ "$(curl -s "${AUTH[@]}" $API/reports/purchases/summary | jq -r '.success')" == "true" ] && echo true || echo false)" "purch summary failed"
check "Reports: outstanding/receivables" "$([ "$(curl -s "${AUTH[@]}" $API/reports/outstanding/receivables | jq -r '.success')" == "true" ] && echo true || echo false)" "recv failed"
check "Reports: outstanding/payables" "$([ "$(curl -s "${AUTH[@]}" $API/reports/outstanding/payables | jq -r '.success')" == "true" ] && echo true || echo false)" "pay failed"
check "Reports: expenses/summary" "$([ "$(curl -s "${AUTH[@]}" $API/reports/expenses/summary | jq -r '.success')" == "true" ] && echo true || echo false)" "exp summary failed"
check "Reports: inventory/aging" "$([ "$(curl -s "${AUTH[@]}" $API/reports/inventory/aging | jq -r '.success')" == "true" ] && echo true || echo false)" "inv aging failed"

# ---- ANALYTICS (analytics/page.tsx) ----
check "Analytics: revenue" "$([ "$(curl -s "${AUTH[@]}" $API/analytics/revenue | jq -r '.success')" == "true" ] && echo true || echo false)" "analytics revenue failed"
check "Analytics: products" "$([ "$(curl -s "${AUTH[@]}" $API/analytics/products | jq -r '.success')" == "true" ] && echo true || echo false)" "analytics products failed"
check "Analytics: customers" "$([ "$(curl -s "${AUTH[@]}" $API/analytics/customers | jq -r '.success')" == "true" ] && echo true || echo false)" "analytics customers failed"
check "Analytics: cash-flow" "$([ "$(curl -s "${AUTH[@]}" $API/analytics/cash-flow | jq -r '.success')" == "true" ] && echo true || echo false)" "analytics cashflow failed"

# ---- QUOTATIONS (billing/quotations/page.tsx) ----
check "Quotations: list" "$([ "$(curl -s "${AUTH[@]}" $API/quotations | jq -r '.success')" == "true" ] && echo true || echo false)" "quotations list failed"

# ---- SALES ORDERS (billing/orders/page.tsx) ----
check "SalesOrders: list" "$([ "$(curl -s "${AUTH[@]}" $API/sales-orders | jq -r '.success')" == "true" ] && echo true || echo false)" "SO list failed"

# ---- CRM (crm/leads + crm/tasks) ----
check "CRM: leads" "$([ "$(curl -s "${AUTH[@]}" $API/crm/leads | jq -r '.success')" == "true" ] && echo true || echo false)" "leads failed"
check "CRM: pipeline" "$([ "$(curl -s "${AUTH[@]}" $API/crm/pipeline | jq -r '.success')" == "true" ] && echo true || echo false)" "pipeline failed"
check "CRM: tasks" "$([ "$(curl -s "${AUTH[@]}" $API/crm/tasks | jq -r '.success')" == "true" ] && echo true || echo false)" "tasks failed"

# ---- MANUFACTURING (manufacturing/page.tsx) ----
check "Manufacturing: bom" "$([ "$(curl -s "${AUTH[@]}" $API/manufacturing/bom | jq -r '.success')" == "true" ] && echo true || echo false)" "bom failed"
check "Manufacturing: orders" "$([ "$(curl -s "${AUTH[@]}" $API/manufacturing/orders | jq -r '.success')" == "true" ] && echo true || echo false)" "mfg orders failed"

# ---- EMPLOYEES (employees/page.tsx) ----
check "Employees: list" "$([ "$(curl -s "${AUTH[@]}" $API/employees | jq -r '.success')" == "true" ] && echo true || echo false)" "employees failed"

# ---- BANKING (banking/page.tsx) ----
check "Banking: accounts" "$([ "$(curl -s "${AUTH[@]}" $API/banking/accounts | jq -r '.success')" == "true" ] && echo true || echo false)" "banking failed"

# ---- DOCUMENTS (documents/page.tsx) ----
check "Documents: list" "$([ "$(curl -s "${AUTH[@]}" "$API/documents?search=" | jq -r '.success')" == "true" ] && echo true || echo false)" "documents failed"

# ---- NOTIFICATIONS (notifications/page.tsx) ----
check "Notifications: list" "$([ "$(curl -s "${AUTH[@]}" $API/notifications | jq -r '.success // .success')" == "true" ] && echo true || echo false)" "notifications failed"

# ---- SETTINGS (settings/page.tsx) ----
check "Settings: organization" "$([ "$(curl -s "${AUTH[@]}" $API/organizations | jq -r '.success')" == "true" ] && echo true || echo false)" "org get failed"
check "Settings: org members" "$([ "$(curl -s "${AUTH[@]}" $API/users/organization/members | jq -r '.success')" == "true" ] && echo true || echo false)" "members failed"

# ---- SUBSCRIPTION (subscriptions/page.tsx) ----
check "Subscription: get" "$([ "$(curl -s "${AUTH[@]}" $API/subscriptions | jq -r '.success')" == "true" ] && echo true || echo false)" "subscription failed"

# ---- RETURNS (returns/page.tsx - NEW) ----
check "Returns: return-orders list" "$([ "$(curl -s "${AUTH[@]}" $API/returns/return-orders | jq -r '.success')" == "true" ] && echo true || echo false)" "returns list failed"
check "Returns: credit-notes list" "$([ "$(curl -s "${AUTH[@]}" $API/returns/credit-notes | jq -r '.success')" == "true" ] && echo true || echo false)" "CN list failed"

echo ""
echo "========================================"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "========================================"
echo -e "$RESULTS"
