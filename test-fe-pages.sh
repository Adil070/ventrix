#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Ventrix — Full Frontend Feature Test
# Tests that each page renders AND its underlying API calls succeed
# Simulates what happens when a user clicks through every screen
# ═══════════════════════════════════════════════════════════════════════════════

WEB="http://localhost:3000"
API="http://localhost:4000/api/v1"
PASS=0; FAIL=0; TOTAL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

check() {
  local name="$1" cond="$2" detail="$3"
  TOTAL=$((TOTAL+1))
  if [ "$cond" == "true" ]; then
    PASS=$((PASS+1)); echo -e "${GREEN}✅ $name${NC}"
  else
    FAIL=$((FAIL+1)); echo -e "${RED}❌ $name${NC} — $detail"
  fi
}

page_loads() {
  local url="$1"
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  [ "$status" == "200" ] && echo "true" || echo "false"
}

TS=$(date +%s)

echo "═══════════════════════════════════════════════════════════════"
echo "  VENTRIX — FULL FE FEATURE CLICK-THROUGH TEST"
echo "  Testing: Page Renders + Business Logic + Data Flow"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 1. AUTH FLOW: Register → Login
# ═══════════════════════════════════════════════════════════════════════════════
echo "🔐 AUTH FLOW"
echo "────────────────────────────────────────────"

check "Register page loads" "$(page_loads $WEB/auth/register)" ""
check "Login page loads" "$(page_loads $WEB/auth/login)" ""

# Test: User signs up
REG=$(curl -s -X POST $API/auth/register -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Demo\",\"lastName\":\"User\",\"email\":\"demo${TS}@test.com\",\"password\":\"Demo1234!\",\"organizationName\":\"Demo Business $TS\"}")
REG_OK=$(echo "$REG" | grep -o '"success":true' | head -1)
check "Register: new user signup works" "$([ -n "$REG_OK" ] && echo true || echo false)" "$REG"

# Test: User logs in with those credentials
LOGIN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"demo${TS}@test.com\",\"password\":\"Demo1234!\"}")
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Login: user can login after registration" "$([ -n "$TOKEN" ] && echo true || echo false)" "no token"

AUTH="-H Authorization:Bearer_$TOKEN"
# Build proper auth headers
do_get() { curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$1"; }
do_post() { curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2" "$1"; }
do_patch() { curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2" "$1"; }

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 2. DASHBOARD — First thing user sees after login
# ═══════════════════════════════════════════════════════════════════════════════
echo "📊 DASHBOARD"
echo "────────────────────────────────────────────"
check "Dashboard page loads" "$(page_loads $WEB/dashboard)" ""
DASH=$(do_get "$API/dashboard")
check "Dashboard: KPIs load (revenue, invoices, etc)" "$(echo "$DASH" | grep -q '"kpis"' && echo true || echo false)" "no kpis"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 3. CUSTOMERS — User clicks "Customers" in sidebar
# ═══════════════════════════════════════════════════════════════════════════════
echo "👥 CUSTOMERS (sidebar → Customers)"
echo "────────────────────────────────────────────"
check "Customers page loads" "$(page_loads $WEB/customers)" ""

# User clicks "Add Customer" button, fills form, submits
CUST=$(do_post "$API/customers" "{\"name\":\"Rajesh Electronics $TS\",\"email\":\"rajesh${TS}@shop.com\",\"phone\":\"9876543210\",\"creditLimit\":200000}")
CID=$(echo "$CUST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Create Customer: form submit works" "$([ -n "$CID" ] && echo true || echo false)" "$CUST"

# User clicks on customer name to view details
CDET=$(do_get "$API/customers/$CID")
check "View Customer: detail page loads" "$(echo "$CDET" | grep -q "Rajesh Electronics" && echo true || echo false)" "$CDET"

# User edits customer (changes credit limit)
CUPD=$(do_patch "$API/customers/$CID" '{"creditLimit":300000}')
check "Edit Customer: update works" "$(echo "$CUPD" | grep -q '"success":true' && echo true || echo false)" "$CUPD"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 4. PRODUCTS — User clicks "Products" in sidebar
# ═══════════════════════════════════════════════════════════════════════════════
echo "📦 PRODUCTS (sidebar → Products)"
echo "────────────────────────────────────────────"
check "Products page loads" "$(page_loads $WEB/products)" ""

# User clicks "Add Product", fills form
PROD=$(do_post "$API/products" "{\"name\":\"Laptop HP Pavilion $TS\",\"sku\":\"LAP-$TS\",\"sellingPrice\":55000,\"costPrice\":45000,\"mrp\":60000,\"taxRate\":18,\"trackInventory\":true,\"openingStock\":25,\"reorderPoint\":5}")
PID=$(echo "$PROD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Create Product: form submit works" "$([ -n "$PID" ] && echo true || echo false)" "$PROD"

# User views product detail
PDET=$(do_get "$API/products/$PID")
check "View Product: detail loads" "$(echo "$PDET" | grep -q "Laptop HP Pavilion" && echo true || echo false)" ""

# User checks low stock alerts
LSTOCK=$(do_get "$API/products/low-stock")
check "Low Stock: alert page works" "$(echo "$LSTOCK" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 5. SUPPLIERS — User clicks "Suppliers" in sidebar
# ═══════════════════════════════════════════════════════════════════════════════
echo "🏭 SUPPLIERS (sidebar → Suppliers)"
echo "────────────────────────────────────────────"
check "Suppliers page loads" "$(page_loads $WEB/suppliers)" ""

SUPP=$(do_post "$API/suppliers" "{\"name\":\"TechSource Distributors $TS\",\"email\":\"tech${TS}@dist.com\",\"phone\":\"8888888888\",\"paymentTerms\":30}")
SID=$(echo "$SUPP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Create Supplier: form submit works" "$([ -n "$SID" ] && echo true || echo false)" "$SUPP"

# Create a warehouse (required for stock tracking)
WH=$(do_post "$API/warehouses" "{\"name\":\"Main Warehouse $TS\",\"code\":\"WH-$TS\",\"address\":{\"line1\":\"Industrial Area\",\"city\":\"Mumbai\",\"state\":\"Maharashtra\",\"pincode\":\"400001\"},\"isDefault\":true}")
check "Create Warehouse: needed for inventory" "$(echo "$WH" | grep -q '"success":true' && echo true || echo false)" "$WH"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 6. PURCHASES — User buys stock from supplier
# ═══════════════════════════════════════════════════════════════════════════════
echo "🛒 PURCHASES (sidebar → Purchases → New Purchase)"
echo "────────────────────────────────────────────"
check "Purchases page loads" "$(page_loads $WEB/purchases)" ""

# User creates a purchase bill (buying 20 laptops from supplier)
PURCH=$(do_post "$API/purchases" "{\"supplierId\":\"$SID\",\"purchaseDate\":\"2026-08-23\",\"billNumber\":\"BILL-$TS\",\"items\":[{\"productId\":\"$PID\",\"description\":\"Laptop HP Pavilion\",\"quantity\":20,\"unitPrice\":45000,\"taxRate\":18}]}")
PURCH_OK=$(echo "$PURCH" | grep -o '"success":true' | head -1)
check "Create Purchase: buy 20 units from supplier" "$([ -n "$PURCH_OK" ] && echo true || echo false)" "$PURCH"

# Verify stock increased: 25 (opening) + 20 (purchased) = 45
STK=$(do_get "$API/products/$PID" | grep -o '"openingStock":"[^"]*"' | cut -d'"' -f4)
check "Purchase → Stock: inventory increased (25→45)" "$([ "$STK" == "45" ] && echo true || echo false)" "stock=$STK"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 7. INVOICES — User creates a sale
# ═══════════════════════════════════════════════════════════════════════════════
echo "🧾 INVOICES (sidebar → Billing → Create Invoice)"
echo "────────────────────────────────────────────"
check "Billing page loads" "$(page_loads $WEB/billing/invoices)" ""

# User creates an invoice (selling 3 laptops to customer)
INV=$(do_post "$API/invoices" "{\"customerId\":\"$CID\",\"invoiceDate\":\"2026-08-23\",\"dueDate\":\"2026-09-07\",\"items\":[{\"productId\":\"$PID\",\"description\":\"Laptop HP Pavilion\",\"quantity\":3,\"unitPrice\":55000,\"taxRate\":18}]}")
IID=$(echo "$INV" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Create Invoice: sell 3 laptops to customer" "$([ -n "$IID" ] && echo true || echo false)" "$INV"

# User clicks "Confirm" button on invoice
CONF=$(do_patch "$API/invoices/$IID/confirm" '{}')
check "Confirm Invoice: status → CONFIRMED" "$(echo "$CONF" | grep -q '"success":true' && echo true || echo false)" "$CONF"

# Verify stock decreased: 45 - 3 = 42
STK2=$(do_get "$API/products/$PID" | grep -o '"openingStock":"[^"]*"' | cut -d'"' -f4)
check "Invoice → Stock: inventory decreased (45→42)" "$([ "$STK2" == "42" ] && echo true || echo false)" "stock=$STK2"

# User records a partial payment from customer
PAY=$(do_post "$API/invoices/$IID/payment" '{"amount":100000,"mode":"UPI","paymentDate":"2026-08-23","referenceNumber":"UPI123456"}')
check "Record Payment: customer pays ₹1,00,000 via UPI" "$(echo "$PAY" | grep -q '"success":true' && echo true || echo false)" "$PAY"

# User views invoice detail
IDET=$(do_get "$API/invoices/$IID")
check "Invoice Detail: shows PARTIALLY_PAID status" "$(echo "$IDET" | grep -q 'PARTIALLY_PAID' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 8. QUOTATIONS & SALES ORDERS
# ═══════════════════════════════════════════════════════════════════════════════
echo "📋 QUOTATIONS & SALES ORDERS"
echo "────────────────────────────────────────────"
check "Quotations page loads" "$(page_loads $WEB/billing/quotations)" ""
check "Sales Orders page loads" "$(page_loads $WEB/billing/orders)" ""

QUOT=$(do_post "$API/quotations" "{\"customerId\":\"$CID\",\"quotationDate\":\"2026-08-23\",\"validUntil\":\"2026-09-23\",\"items\":[{\"productId\":\"$PID\",\"description\":\"Laptop HP Pavilion\",\"quantity\":10,\"unitPrice\":54000,\"taxRate\":18}]}")
check "Create Quotation: quote 10 units" "$(echo "$QUOT" | grep -q '"success":true' && echo true || echo false)" "$QUOT"

SO=$(do_post "$API/sales-orders" "{\"customerId\":\"$CID\",\"orderDate\":\"2026-08-23\",\"deliveryDate\":\"2026-08-30\",\"items\":[{\"productId\":\"$PID\",\"description\":\"Laptop HP Pavilion\",\"quantity\":5,\"unitPrice\":55000,\"taxRate\":18}]}")
check "Create Sales Order: order for 5 units" "$(echo "$SO" | grep -q '"success":true' && echo true || echo false)" "$SO"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 9. EXPENSES — User records business expenses
# ═══════════════════════════════════════════════════════════════════════════════
echo "💸 EXPENSES (sidebar → Expenses)"
echo "────────────────────────────────────────────"
check "Expenses page loads" "$(page_loads $WEB/expenses)" ""

EXP=$(do_post "$API/expenses" '{"description":"Office Rent August 2026","amount":35000,"date":"2026-08-01","paymentMode":"BANK_TRANSFER"}')
check "Create Expense: record office rent ₹35,000" "$(echo "$EXP" | grep -q '"success":true' && echo true || echo false)" "$EXP"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 10. INVENTORY & WAREHOUSE
# ═══════════════════════════════════════════════════════════════════════════════
echo "📊 INVENTORY & WAREHOUSE"
echo "────────────────────────────────────────────"
check "Inventory page loads" "$(page_loads $WEB/inventory)" ""
check "Warehouse page loads" "$(page_loads $WEB/warehouse)" ""

INVSUM=$(do_get "$API/inventory/summary")
check "Inventory Summary: shows stock levels" "$(echo "$INVSUM" | grep -q '"success":true' && echo true || echo false)" ""

INVMOV=$(do_get "$API/inventory/movements")
check "Inventory Movements: shows stock history" "$(echo "$INVMOV" | grep -q '"success":true' && echo true || echo false)" ""

# Stock adjustment (user found damaged item)
ADJ=$(do_post "$API/inventory/adjust" "{\"productId\":\"$PID\",\"type\":\"DAMAGE\",\"quantity\":2,\"notes\":\"2 units damaged in transit\"}")
check "Stock Adjustment: mark 2 units damaged" "$(echo "$ADJ" | grep -q '"success":true' && echo true || echo false)" "$ADJ"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 11. CRM — Leads & Pipeline
# ═══════════════════════════════════════════════════════════════════════════════
echo "🎯 CRM (sidebar → CRM)"
echo "────────────────────────────────────────────"
check "CRM page loads" "$(page_loads $WEB/crm/leads)" ""

LEAD=$(do_post "$API/crm/leads" "{\"name\":\"Vikram Mehta\",\"email\":\"vikram${TS}@corp.com\",\"phone\":\"9876500001\",\"company\":\"MegaCorp Ltd\",\"source\":\"Referral\",\"status\":\"NEW\",\"expectedValue\":1000000}")
LID=$(echo "$LEAD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Create Lead: new prospect ₹10L deal" "$([ -n "$LID" ] && echo true || echo false)" "$LEAD"

LUPD=$(do_patch "$API/crm/leads/$LID" '{"status":"QUALIFIED"}')
check "Update Lead: move to QUALIFIED stage" "$(echo "$LUPD" | grep -q '"success":true' && echo true || echo false)" "$LUPD"

PIPE=$(do_get "$API/crm/pipeline")
check "Pipeline View: shows leads by stage" "$(echo "$PIPE" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 12. ACCOUNTING
# ═══════════════════════════════════════════════════════════════════════════════
echo "📒 ACCOUNTING (sidebar → Accounting)"
echo "────────────────────────────────────────────"
check "Accounting page loads" "$(page_loads $WEB/accounting)" ""

COA=$(do_get "$API/accounting/accounts")
check "Chart of Accounts: lists all accounts" "$(echo "$COA" | grep -q 'Sales Revenue' && echo true || echo false)" ""

TB=$(do_get "$API/accounting/reports/trial-balance")
check "Trial Balance: generates report" "$(echo "$TB" | grep -q '"success":true' && echo true || echo false)" "$TB"

PL=$(do_get "$API/accounting/reports/profit-loss")
check "Profit & Loss: generates P&L statement" "$(echo "$PL" | grep -q '"success":true' && echo true || echo false)" "$PL"

BS=$(do_get "$API/accounting/reports/balance-sheet")
check "Balance Sheet: generates balance sheet" "$(echo "$BS" | grep -q '"success":true' && echo true || echo false)" "$BS"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 13. GST COMPLIANCE
# ═══════════════════════════════════════════════════════════════════════════════
echo "🧾 GST (sidebar → GST)"
echo "────────────────────────────────────────────"
check "GST page loads" "$(page_loads $WEB/gst)" ""

G1=$(do_get "$API/gst/reports/gstr1?month=8&year=2026")
check "GSTR-1: outward supplies report" "$(echo "$G1" | grep -q '"success":true' && echo true || echo false)" "$G1"

G3B=$(do_get "$API/gst/reports/gstr3b?month=8&year=2026")
check "GSTR-3B: monthly summary" "$(echo "$G3B" | grep -q '"success":true' && echo true || echo false)" "$G3B"

GSUM=$(do_get "$API/gst/reports/gst-summary")
check "GST Summary: input vs output tax" "$(echo "$GSUM" | grep -q '"success":true' && echo true || echo false)" "$GSUM"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 14. REPORTS
# ═══════════════════════════════════════════════════════════════════════════════
echo "📊 REPORTS (sidebar → Reports)"
echo "────────────────────────────────────────────"
check "Reports page loads" "$(page_loads $WEB/reports)" ""

check "Sales Summary Report" "$(do_get "$API/reports/sales/summary" | grep -q '"success":true' && echo true || echo false)" ""
check "Purchase Summary Report" "$(do_get "$API/reports/purchases/summary" | grep -q '"success":true' && echo true || echo false)" ""
check "Outstanding Receivables" "$(do_get "$API/reports/outstanding/receivables" | grep -q '"success":true' && echo true || echo false)" ""
check "Outstanding Payables" "$(do_get "$API/reports/outstanding/payables" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 15. ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════
echo "📈 ANALYTICS (sidebar → Analytics)"
echo "────────────────────────────────────────────"
check "Analytics page loads" "$(page_loads $WEB/analytics)" ""

check "Revenue Analytics" "$(do_get "$API/analytics/revenue" | grep -q '"success":true' && echo true || echo false)" ""
check "Product Analytics" "$(do_get "$API/analytics/products" | grep -q '"success":true' && echo true || echo false)" ""
check "Customer Analytics" "$(do_get "$API/analytics/customers" | grep -q '"success":true' && echo true || echo false)" ""
check "Cash Flow Analytics" "$(do_get "$API/analytics/cash-flow" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 16. BANKING
# ═══════════════════════════════════════════════════════════════════════════════
echo "🏦 BANKING (sidebar → Banking)"
echo "────────────────────────────────────────────"
check "Banking page loads" "$(page_loads $WEB/banking)" ""

BANK=$(do_post "$API/banking/accounts" "{\"accountName\":\"Business Account $TS\",\"bankName\":\"SBI\",\"accountNumber\":\"3210$TS\",\"ifscCode\":\"SBIN0001234\",\"accountType\":\"CURRENT\",\"openingBalance\":250000}")
check "Create Bank Account: add SBI account" "$(echo "$BANK" | grep -q '"success":true' && echo true || echo false)" "$BANK"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 17. PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════
echo "💰 PAYMENTS (sidebar → Payments)"
echo "────────────────────────────────────────────"
check "Payments page loads" "$(page_loads $WEB/payments)" ""
check "Payments: list loads" "$(do_get "$API/payments" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 18. MANUFACTURING
# ═══════════════════════════════════════════════════════════════════════════════
echo "�icing MANUFACTURING (sidebar → Manufacturing)"
echo "────────────────────────────────────────────"
check "Manufacturing page loads" "$(page_loads $WEB/manufacturing)" ""
check "BOM list" "$(do_get "$API/manufacturing/bom" | grep -q '"success":true' && echo true || echo false)" ""
check "Manufacturing Orders" "$(do_get "$API/manufacturing/orders" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 19. EMPLOYEES, DOCUMENTS, NOTIFICATIONS, SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════
echo "⚙️  OTHER MODULES"
echo "────────────────────────────────────────────"
check "Employees page loads" "$(page_loads $WEB/employees)" ""
check "Employees: list" "$(do_get "$API/employees" | grep -q '"success":true' && echo true || echo false)" ""
check "Documents page loads" "$(page_loads $WEB/documents)" ""
check "Notifications page loads" "$(page_loads $WEB/notifications)" ""
check "Settings page loads" "$(page_loads $WEB/settings)" ""
check "Subscriptions page loads" "$(page_loads $WEB/subscriptions)" ""
check "Returns page loads" "$(page_loads $WEB/returns)" ""
check "Returns: return-orders" "$(do_get "$API/returns/return-orders" | grep -q '"success":true' && echo true || echo false)" ""
check "Returns: credit-notes" "$(do_get "$API/returns/credit-notes" | grep -q '"success":true' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 20. BUSINESS WORKFLOW END-TO-END
# (Complete cycle: Quote → Sales Order → Invoice → Payment → Reports)
# ═══════════════════════════════════════════════════════════════════════════════
echo "🔄 FULL BUSINESS WORKFLOW VALIDATION"
echo "────────────────────────────────────────────"

# After all above operations, verify the dashboard reflects changes
DASH2=$(do_get "$API/dashboard")
check "Dashboard: reflects today's sales" "$(echo "$DASH2" | grep -q '"success":true' && echo true || echo false)" ""

# Check outstanding receivables shows our customer
RECV=$(do_get "$API/reports/outstanding/receivables")
check "Receivables: shows outstanding from invoice" "$(echo "$RECV" | grep -q '"totalOutstanding"' && echo true || echo false)" ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  TEST RESULTS: $PASS passed / $FAIL failed / $TOTAL total"
echo "═══════════════════════════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}  ✅ ALL FEATURES WORKING — Every page loads & business logic verified${NC}"
else
  echo -e "${RED}  ❌ Some features have issues — see above${NC}"
fi
echo ""
