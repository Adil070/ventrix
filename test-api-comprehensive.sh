#!/bin/bash

# Ventrix - Comprehensive API Testing Script
# This script tests every API endpoint with real business workflows

set +e

API_URL="http://localhost:4000/api/v1"
HEALTH_URL="http://localhost:4000/health"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Log files
LOG_FILE="api-test-results.log"
ERROR_LOG="api-test-errors.log"

echo "🚀 Ventrix - Comprehensive API Testing" > $LOG_FILE
echo "Started at: $(date)" >> $LOG_FILE
echo "========================================" >> $LOG_FILE
echo "" >> $LOG_FILE

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local token=$4
    local test_name=$5
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -e "${YELLOW}Testing: $test_name${NC}"
    echo "TEST #$TOTAL_TESTS: $test_name" >> $LOG_FILE
    echo "  Method: $method" >> $LOG_FILE
    echo "  Endpoint: $endpoint" >> $LOG_FILE
    
    if [ -z "$token" ]; then
        response=$(curl -s -X $method "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" \
            -w "\n%{http_code}")
    else
        response=$(curl -s -X $method "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data" \
            -w "\n%{http_code}")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    echo "  HTTP Code: $http_code" >> $LOG_FILE
    echo "  Response: $body" >> $LOG_FILE
    
    if [[ $http_code -ge 200 && $http_code -lt 300 ]]; then
        echo -e "${GREEN}✓ PASSED${NC} - $test_name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        echo "  Status: PASSED" >> $LOG_FILE
    else
        echo -e "${RED}✗ FAILED${NC} - $test_name (HTTP $http_code)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        echo "  Status: FAILED" >> $LOG_FILE
        echo "FAILED: $test_name - HTTP $http_code" >> $ERROR_LOG
        echo "Response: $body" >> $ERROR_LOG
        echo "---" >> $ERROR_LOG
    fi
    
    echo "" >> $LOG_FILE
    echo "$body"
}

echo "========================================="
echo "   Ventrix API - Full Test Suite"
echo "========================================="
echo ""

# Unique suffix for this test run
RUN_ID=$(date +%s)

# 1. Health Check
echo "📊 HEALTH CHECK"
echo "---"
HEALTH_RESPONSE=$(curl -s http://localhost:4000/health)
echo "$HEALTH_RESPONSE"
echo -e "${GREEN}✓ PASSED${NC} - Health Check"
TOTAL_TESTS=$((TOTAL_TESTS + 1))
PASSED_TESTS=$((PASSED_TESTS + 1))
echo ""

# 2. Authentication
echo "🔐 AUTHENTICATION TESTS"
echo "---"

# Login
LOGIN_RESPONSE=$(test_endpoint "POST" "/auth/login" '{
  "email": "owner@demotrade.local",
  "password": "Owner@123"
}' "" "Login with valid credentials")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"refreshToken":"[^"]*"' | head -1 | cut -d'"' -f4)
ORG_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"organizationId":"[^"]*"' | head -1 | cut -d'"' -f4)
USER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "Token obtained: ${TOKEN:0:50}..."
echo ""

# Invalid login (expected to fail with 401)
TOTAL_TESTS=$((TOTAL_TESTS + 1))
INVALID_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@demotrade.local","password":"WrongPassword"}')
if [ "$INVALID_RESP" = "401" ]; then
  echo -e "${GREEN}✓ PASSED${NC} - Login with invalid password (correctly rejected)"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo -e "${RED}✗ FAILED${NC} - Login with invalid password (expected 401, got $INVALID_RESP)"
  FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Refresh token
test_endpoint "POST" "/auth/refresh-token" "{
  \"refreshToken\": \"$REFRESH_TOKEN\"
}" "" "Refresh access token"

echo ""

# 3. Dashboard
echo "📈 DASHBOARD"
echo "---"
test_endpoint "GET" "/dashboard" "" "$TOKEN" "Get dashboard data"
echo ""

# 4. Customers
echo "👥 CUSTOMER MANAGEMENT"
echo "---"

# Create customer
CUSTOMER_RESPONSE=$(test_endpoint "POST" "/customers" "{
  \"name\": \"Test Customer $RUN_ID\",
  \"email\": \"test${RUN_ID}@example.com\",
  \"phone\": \"9876543210\",
  \"creditLimit\": 100000,
  \"billingAddress\": {
    \"line1\": \"Shop 101, Market Street\",
    \"city\": \"Mumbai\",
    \"state\": \"Maharashtra\",
    \"pincode\": \"400001\",
    \"country\": \"India\"
  }
}" "$TOKEN" "Create new customer")

CUSTOMER_ID=$(echo "$CUSTOMER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List customers
test_endpoint "GET" "/customers" "" "$TOKEN" "List all customers"

# Get customer by ID
test_endpoint "GET" "/customers/$CUSTOMER_ID" "" "$TOKEN" "Get customer details"

# Update customer
test_endpoint "PATCH" "/customers/$CUSTOMER_ID" '{
  "creditLimit": 150000
}' "$TOKEN" "Update customer"

echo ""

# 5. Suppliers
echo "🏭 SUPPLIER MANAGEMENT"
echo "---"

# Create supplier
SUPPLIER_RESPONSE=$(test_endpoint "POST" "/suppliers" "{
  \"name\": \"Test Supplier $RUN_ID\",
  \"email\": \"supplier${RUN_ID}@global.com\",
  \"phone\": \"9123456789\",
  \"paymentTerms\": 30
}" "$TOKEN" "Create new supplier")

SUPPLIER_ID=$(echo "$SUPPLIER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List suppliers
test_endpoint "GET" "/suppliers" "" "$TOKEN" "List all suppliers"

echo ""

# 6. Products
echo "📦 PRODUCT MANAGEMENT"
echo "---"

# Create product
PRODUCT_RESPONSE=$(test_endpoint "POST" "/products" "{
  \"name\": \"Test Product $RUN_ID\",
  \"sku\": \"TST-$RUN_ID\",
  \"hsnCode\": \"85171200\",
  \"sellingPrice\": 79999,
  \"costPrice\": 65000,
  \"mrp\": 89999,
  \"taxRate\": 18,
  \"trackInventory\": true,
  \"openingStock\": 50,
  \"reorderPoint\": 10
}" "$TOKEN" "Create new product")

PRODUCT_ID=$(echo "$PRODUCT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List products
test_endpoint "GET" "/products" "" "$TOKEN" "List all products"

# Get product
test_endpoint "GET" "/products/$PRODUCT_ID" "" "$TOKEN" "Get product details"

# Update product
test_endpoint "PATCH" "/products/$PRODUCT_ID" '{
  "sellingPrice": 77999
}' "$TOKEN" "Update product price"

# Check low stock
test_endpoint "GET" "/products/low-stock" "" "$TOKEN" "Get low stock products"

echo ""

# 7. Invoices (Complete Billing Flow)
echo "🧾 INVOICE & BILLING"
echo "---"

# Create invoice
INVOICE_RESPONSE=$(test_endpoint "POST" "/invoices" "{
  \"customerId\": \"$CUSTOMER_ID\",
  \"invoiceDate\": \"2026-06-30\",
  \"dueDate\": \"2026-07-15\",
  \"items\": [
    {
      \"productId\": \"$PRODUCT_ID\",
      \"description\": \"Test Product $RUN_ID\",
      \"quantity\": 2,
      \"unitPrice\": 79999,
      \"taxRate\": 18
    }
  ]
}" "$TOKEN" "Create invoice")

INVOICE_ID=$(echo "$INVOICE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List invoices
test_endpoint "GET" "/invoices" "" "$TOKEN" "List all invoices"

# Get invoice
test_endpoint "GET" "/invoices/$INVOICE_ID" "" "$TOKEN" "Get invoice details"

# Record payment
test_endpoint "POST" "/invoices/$INVOICE_ID/payment" '{
  "amount": 50000,
  "mode": "UPI",
  "paymentDate": "2026-06-30",
  "referenceNumber": "UPI202406301234"
}' "$TOKEN" "Record partial payment"

# Get invoice PDF (download)
test_endpoint "GET" "/invoices/$INVOICE_ID/pdf" "" "$TOKEN" "Generate invoice PDF"

echo ""

# 8. Purchases
echo "🛒 PURCHASE MANAGEMENT"
echo "---"

# Create purchase
PURCHASE_RESPONSE=$(test_endpoint "POST" "/purchases" "{
  \"supplierId\": \"$SUPPLIER_ID\",
  \"purchaseDate\": \"2026-06-25\",
  \"billNumber\": \"SUPP-$RUN_ID\",
  \"items\": [
    {
      \"productId\": \"$PRODUCT_ID\",
      \"description\": \"Test Product\",
      \"quantity\": 20,
      \"unitPrice\": 65000,
      \"taxRate\": 18
    }
  ]
}" "$TOKEN" "Create purchase bill")

PURCHASE_ID=$(echo "$PURCHASE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List purchases
test_endpoint "GET" "/purchases" "" "$TOKEN" "List all purchases"

echo ""

# 9. Payments
echo "💰 PAYMENT MANAGEMENT"
echo "---"

# List payments
test_endpoint "GET" "/payments" "" "$TOKEN" "List all payments"

echo ""

# 10. Inventory
echo "📊 INVENTORY MANAGEMENT"
echo "---"

# Stock adjustment
test_endpoint "POST" "/inventory/adjustments" "{
  \"productId\": \"$PRODUCT_ID\",
  \"quantity\": 5,
  \"type\": \"ADJUSTMENT_IN\",
  \"notes\": \"Found extra stock during audit\"
}" "$TOKEN" "Create stock adjustment"

# Stock history
test_endpoint "GET" "/products/$PRODUCT_ID/stock-history" "" "$TOKEN" "Get stock history"

echo ""

# 11. Warehouses
echo "🏢 WAREHOUSE MANAGEMENT"
echo "---"

# Create warehouse
WAREHOUSE_RESPONSE=$(test_endpoint "POST" "/warehouses" "{
  \"name\": \"Warehouse $RUN_ID\",
  \"code\": \"WH-$RUN_ID\",
  \"address\": {
    \"line1\": \"Plot 45, Industrial Area\",
    \"city\": \"Mumbai\",
    \"state\": \"Maharashtra\",
    \"pincode\": \"400070\"
  },
  \"isDefault\": false
}" "$TOKEN" "Create warehouse")

# List warehouses
test_endpoint "GET" "/warehouses" "" "$TOKEN" "List all warehouses"

echo ""

# 12. Expenses
echo "💸 EXPENSE MANAGEMENT"
echo "---"

# Create expense
EXPENSE_RESPONSE=$(test_endpoint "POST" "/expenses" '{
  "description": "Office Rent - June 2026",
  "amount": 25000,
  "date": "2026-06-01",
  "paymentMode": "BANK_TRANSFER"
}' "$TOKEN" "Create expense")

# List expenses
test_endpoint "GET" "/expenses" "" "$TOKEN" "List all expenses"

echo ""

# 13. CRM (Leads)
echo "🎯 CRM - LEAD MANAGEMENT"
echo "---"

# Create lead
LEAD_RESPONSE=$(test_endpoint "POST" "/crm/leads" '{
  "name": "Priya Deshmukh",
  "email": "priya@company.com",
  "phone": "9988776655",
  "company": "Tech Solutions Pvt Ltd",
  "source": "Website",
  "status": "NEW",
  "expectedValue": 500000
}' "$TOKEN" "Create lead")

LEAD_ID=$(echo "$LEAD_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List leads
test_endpoint "GET" "/crm/leads" "" "$TOKEN" "List all leads"

# Update lead status
test_endpoint "PATCH" "/crm/leads/$LEAD_ID" '{
  "status": "CONTACTED"
}' "$TOKEN" "Update lead status"

echo ""

# 14. Quotations
echo "📋 QUOTATION MANAGEMENT"
echo "---"

# Create quotation
QUOTATION_RESPONSE=$(test_endpoint "POST" "/quotations" "{
  \"customerId\": \"$CUSTOMER_ID\",
  \"quotationDate\": \"2026-06-30\",
  \"validUntil\": \"2026-07-15\",
  \"items\": [
    {
      \"productId\": \"$PRODUCT_ID\",
      \"description\": \"Samsung Galaxy S24\",
      \"quantity\": 5,
      \"unitPrice\": 79999,
      \"taxRate\": 18
    }
  ]
}" "$TOKEN" "Create quotation")

QUOTATION_ID=$(echo "$QUOTATION_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List quotations
test_endpoint "GET" "/quotations" "" "$TOKEN" "List all quotations"

echo ""

# 15. Sales Orders
echo "📝 SALES ORDER MANAGEMENT"
echo "---"

# Create sales order
SO_RESPONSE=$(test_endpoint "POST" "/sales-orders" "{
  \"customerId\": \"$CUSTOMER_ID\",
  \"orderDate\": \"2026-06-30\",
  \"deliveryDate\": \"2026-07-05\",
  \"items\": [
    {
      \"productId\": \"$PRODUCT_ID\",
      \"description\": \"Samsung Galaxy S24\",
      \"quantity\": 3,
      \"unitPrice\": 79999,
      \"taxRate\": 18
    }
  ]
}" "$TOKEN" "Create sales order")

# List sales orders
test_endpoint "GET" "/sales-orders" "" "$TOKEN" "List all sales orders"

echo ""

# 16. Accounting
echo "📒 ACCOUNTING"
echo "---"

# Chart of accounts
test_endpoint "GET" "/accounting/accounts" "" "$TOKEN" "Get chart of accounts"

# Trial balance
test_endpoint "GET" "/accounting/trial-balance" "" "$TOKEN" "Get trial balance"

# P&L Statement
test_endpoint "GET" "/accounting/profit-loss?startDate=2026-04-01&endDate=2026-06-30" "" "$TOKEN" "Get P&L statement"

# Balance sheet
test_endpoint "GET" "/accounting/balance-sheet?date=2026-06-30" "" "$TOKEN" "Get balance sheet"

echo ""

# 17. GST Reports
echo "🧾 GST REPORTS"
echo "---"

# GSTR-1
test_endpoint "GET" "/gst/gstr1?month=6&year=2026" "" "$TOKEN" "Get GSTR-1 report"

# GSTR-3B
test_endpoint "GET" "/gst/gstr3b?month=6&year=2026" "" "$TOKEN" "Get GSTR-3B report"

# GST Summary
test_endpoint "GET" "/gst/summary?startDate=2026-06-01&endDate=2026-06-30" "" "$TOKEN" "Get GST summary"

echo ""

# 18. Reports
echo "📊 BUSINESS REPORTS"
echo "---"

# Sales summary
test_endpoint "GET" "/reports/sales-summary?startDate=2026-06-01&endDate=2026-06-30" "" "$TOKEN" "Sales summary report"

# Purchase summary
test_endpoint "GET" "/reports/purchase-summary?startDate=2026-06-01&endDate=2026-06-30" "" "$TOKEN" "Purchase summary report"

# Outstanding receivables
test_endpoint "GET" "/reports/outstanding-receivables" "" "$TOKEN" "Outstanding receivables"

# Outstanding payables
test_endpoint "GET" "/reports/outstanding-payables" "" "$TOKEN" "Outstanding payables"

echo ""

# 19. Analytics
echo "📈 ANALYTICS"
echo "---"

# Revenue analytics
test_endpoint "GET" "/analytics/revenue?period=month" "" "$TOKEN" "Revenue analytics"

# Top customers
test_endpoint "GET" "/analytics/top-customers?limit=5" "" "$TOKEN" "Top customers"

# Top products
test_endpoint "GET" "/analytics/top-products?limit=5" "" "$TOKEN" "Top products"

echo ""

# 20. Banking
echo "🏦 BANKING"
echo "---"

# Create bank account
BANK_RESPONSE=$(test_endpoint "POST" "/banking/accounts" '{
  "accountName": "Business Current Account",
  "bankName": "HDFC Bank",
  "accountNumber": "50100123456789",
  "ifscCode": "HDFC0001234",
  "accountType": "CURRENT",
  "openingBalance": 500000,
  "isDefault": true
}' "$TOKEN" "Create bank account")

# List bank accounts
test_endpoint "GET" "/banking/accounts" "" "$TOKEN" "List bank accounts"

echo ""

# Print Summary
echo ""
echo "========================================="
echo "           TEST SUMMARY"
echo "========================================="
echo -e "Total Tests  : $TOTAL_TESTS"
echo -e "${GREEN}Passed Tests : $PASSED_TESTS${NC}"
echo -e "${RED}Failed Tests : $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
else
    echo -e "${RED}✗ Some tests failed. Check $ERROR_LOG for details.${NC}"
fi

echo ""
echo "Full log saved to: $LOG_FILE"
echo "Errors saved to: $ERROR_LOG"
echo ""
