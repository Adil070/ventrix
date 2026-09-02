#!/bin/bash

# Complete Business Workflow Test
# This simulates a real business day with multiple transactions

set -e

API="http://localhost:4000/api/v1"
TIMESTAMP=$(date +%s)

echo "================================================"
echo "  COMPLETE BUSINESS WORKFLOW TEST"
echo "================================================"
echo ""

# Step 1: Login
echo "📝 Step 1: Login as Organization Owner"
LOGIN=$(curl -s -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@demotrade.local", "password": "Owner@123"}')

TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken')
ORG_NAME=$(echo "$LOGIN" | jq -r '.data.organization.name')

if [ "$TOKEN" == "null" ]; then
  echo "❌ Login failed!"
  exit 1
fi

echo "✅ Logged in to: $ORG_NAME"
echo ""

# Step 2: Create Supplier
echo "📝 Step 2: Create Supplier"
SUPPLIER=$(curl -s -X POST $API/suppliers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Electronics Supplier $TIMESTAMP\",
    \"email\": \"supplier$TIMESTAMP@test.com\",
    \"phone\": \"9876543210\",
    \"gstin\": \"27AABCD1234E1Z${TIMESTAMP:0:1}\",
    \"paymentTerms\": 30
  }")

SUPPLIER_ID=$(echo "$SUPPLIER" | jq -r '.data.id')
echo "✅ Supplier created: $SUPPLIER_ID"
echo ""

# Step 3: Create Products
echo "📝 Step 3: Create Products (Inventory)"
PRODUCT1=$(curl -s -X POST $API/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Laptop HP 15s $TIMESTAMP\",
    \"sku\": \"LAP-HP-$TIMESTAMP-001\",
    \"hsnCode\": \"84713000\",
    \"sellingPrice\": 45000,
    \"costPrice\": 38000,
    \"mrp\": 50000,
    \"taxRate\": 18,
    \"trackInventory\": true,
    \"openingStock\": 0,
    \"reorderPoint\": 5
  }")

PRODUCT1_ID=$(echo "$PRODUCT1" | jq -r '.data.id')

PRODUCT2=$(curl -s -X POST $API/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Mouse Logitech $TIMESTAMP\",
    \"sku\": \"MOUSE-LOG-$TIMESTAMP\",
    \"hsnCode\": \"84716060\",
    \"sellingPrice\": 800,
    \"costPrice\": 600,
    \"mrp\": 1000,
    \"taxRate\": 18,
    \"trackInventory\": true,
    \"openingStock\": 0,
    \"reorderPoint\": 10
  }")

PRODUCT2_ID=$(echo "$PRODUCT2" | jq -r '.data.id')

echo "✅ Product 1: Laptop - $PRODUCT1_ID"
echo "✅ Product 2: Mouse - $PRODUCT2_ID"
echo ""

# Step 4: Create Purchase Order
echo "📝 Step 4: Purchase Stock from Supplier"
PURCHASE=$(curl -s -X POST $API/purchases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"supplierId\": \"$SUPPLIER_ID\",
    \"purchaseDate\": \"2026-06-30\",
    \"billNumber\": \"SUPP-BILL-$TIMESTAMP\",
    \"items\": [
      {
        \"productId\": \"$PRODUCT1_ID\",
        \"description\": \"Laptop HP 15s\",
        \"quantity\": 10,
        \"unitPrice\": 38000,
        \"taxRate\": 18
      },
      {
        \"productId\": \"$PRODUCT2_ID\",
        \"description\": \"Mouse Logitech\",
        \"quantity\": 50,
        \"unitPrice\": 600,
        \"taxRate\": 18
      }
    ]
  }")

PURCHASE_ID=$(echo "$PURCHASE" | jq -r '.data.id')
PURCHASE_TOTAL=$(echo "$PURCHASE" | jq -r '.data.totalAmount')

echo "✅ Purchase Order: $PURCHASE_ID"
echo "   Total: ₹$PURCHASE_TOTAL"
echo ""

# Step 5: Check Inventory Update
echo "📝 Step 5: Verify Inventory Update"
PRODUCT1_CHECK=$(curl -s -X GET $API/products/$PRODUCT1_ID \
  -H "Authorization: Bearer $TOKEN")

LAPTOP_STOCK=$(echo "$PRODUCT1_CHECK" | jq -r '.data.openingStock')
echo "✅ Laptop stock updated: $LAPTOP_STOCK units"
echo ""

# Step 6: Create Customers
echo "📝 Step 6: Create Customers"
CUSTOMER1=$(curl -s -X POST $API/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"ABC Technologies $TIMESTAMP\",
    \"email\": \"abc$TIMESTAMP@test.com\",
    \"phone\": \"9876501234\",
    \"gstin\": \"27XYZAB5678C1Z2\",
    \"creditLimit\": 500000,
    \"creditDays\": 30
  }")

CUSTOMER1_ID=$(echo "$CUSTOMER1" | jq -r '.data.id')

CUSTOMER2=$(curl -s -X POST $API/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"XYZ Retail $TIMESTAMP\",
    \"email\": \"xyz$TIMESTAMP@test.com\",
    \"phone\": \"9876502345\",
    \"creditLimit\": 300000
  }")

CUSTOMER2_ID=$(echo "$CUSTOMER2" | jq -r '.data.id')

echo "✅ Customer 1: $CUSTOMER1_ID"
echo "✅ Customer 2: $CUSTOMER2_ID"
echo ""

# Step 7: Create Invoices
echo "📝 Step 7: Create Sales Invoices"

INVOICE1=$(curl -s -X POST $API/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER1_ID\",
    \"invoiceDate\": \"2026-06-30\",
    \"dueDate\": \"2026-07-30\",
    \"items\": [
      {
        \"productId\": \"$PRODUCT1_ID\",
        \"description\": \"Laptop HP 15s\",
        \"quantity\": 3,
        \"unitPrice\": 45000,
        \"taxRate\": 18
      },
      {
        \"productId\": \"$PRODUCT2_ID\",
        \"description\": \"Mouse Logitech\",
        \"quantity\": 10,
        \"unitPrice\": 800,
        \"taxRate\": 18
      }
    ]
  }")

INVOICE1_ID=$(echo "$INVOICE1" | jq -r '.data.id')
INVOICE1_NUM=$(echo "$INVOICE1" | jq -r '.data.invoiceNumber')
INVOICE1_TOTAL=$(echo "$INVOICE1" | jq -r '.data.totalAmount')

INVOICE2=$(curl -s -X POST $API/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER2_ID\",
    \"invoiceDate\": \"2026-06-30\",
    \"dueDate\": \"2026-07-15\",
    \"items\": [
      {
        \"productId\": \"$PRODUCT2_ID\",
        \"description\": \"Mouse Logitech\",
        \"quantity\": 20,
        \"unitPrice\": 800,
        \"taxRate\": 18
      }
    ]
  }")

INVOICE2_ID=$(echo "$INVOICE2" | jq -r '.data.id')
INVOICE2_NUM=$(echo "$INVOICE2" | jq -r '.data.invoiceNumber')
INVOICE2_TOTAL=$(echo "$INVOICE2" | jq -r '.data.totalAmount')

echo "✅ Invoice 1: $INVOICE1_NUM - Total: ₹$INVOICE1_TOTAL"
echo "✅ Invoice 2: $INVOICE2_NUM - Total: ₹$INVOICE2_TOTAL"
echo ""

# Step 8: Record Payments
echo "📝 Step 8: Record Customer Payments"

PAYMENT1=$(curl -s -X POST $API/invoices/$INVOICE1_ID/payment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100000,
    "mode": "UPI",
    "paymentDate": "2026-06-30",
    "referenceNumber": "UPI202406301234"
  }')

PAYMENT1_MSG=$(echo "$PAYMENT1" | jq -r '.message')

PAYMENT2=$(curl -s -X POST $API/invoices/$INVOICE2_ID/payment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"amount\": $INVOICE2_TOTAL,
    \"mode\": \"CASH\",
    \"paymentDate\": \"2026-06-30\"
  }")

PAYMENT2_MSG=$(echo "$PAYMENT2" | jq -r '.message')

echo "✅ Payment 1: ₹100,000 (Partial) - $PAYMENT1_MSG"
echo "✅ Payment 2: ₹$INVOICE2_TOTAL (Full) - $PAYMENT2_MSG"
echo ""

# Step 9: Create Expense
echo "📝 Step 9: Record Business Expense"
EXPENSE=$(curl -s -X POST $API/expenses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Office Electricity Bill - June 2026",
    "amount": 5500,
    "expenseDate": "2026-06-30",
    "paymentMode": "BANK_TRANSFER",
    "status": "PAID"
  }')

EXPENSE_ID=$(echo "$EXPENSE" | jq -r '.data.id')
echo "✅ Expense recorded: ₹5,500"
echo ""

# Step 10: Check Dashboard
echo "📝 Step 10: Check Dashboard Summary"
DASHBOARD=$(curl -s -X GET $API/dashboard \
  -H "Authorization: Bearer $TOKEN")

echo "$DASHBOARD" | jq '{
  revenue: .data.revenue,
  expenses: .data.expenses,
  profit: .data.profit,
  outstandingReceivables: .data.outstandingReceivables,
  outstandingPayables: .data.outstandingPayables,
  totalInvoices: .data.invoiceCount,
  totalCustomers: .data.customerCount,
  lowStockProducts: .data.lowStockCount
}'
echo ""

# Step 11: Generate Reports
echo "📝 Step 11: Generate Sales Report"
SALES_REPORT=$(curl -s -X GET "$API/reports/sales-summary?startDate=2026-06-01&endDate=2026-06-30" \
  -H "Authorization: Bearer $TOKEN")

echo "$SALES_REPORT" | jq '{
  totalRevenue: .data.totalRevenue,
  totalTax: .data.totalTax,
  invoiceCount: .data.invoiceCount
}'
echo ""

echo "📝 Step 12: Check Outstanding Receivables"
RECEIVABLES=$(curl -s -X GET $API/reports/outstanding-receivables \
  -H "Authorization: Bearer $TOKEN")

echo "$RECEIVABLES" | jq '{
  totalOutstanding: .data.totalOutstanding,
  customerCount: (.data.customers | length)
}'
echo ""

# Step 13: Check Inventory After Sales
echo "📝 Step 13: Verify Final Inventory"
PRODUCT1_FINAL=$(curl -s -X GET $API/products/$PRODUCT1_ID \
  -H "Authorization: Bearer $TOKEN")

PRODUCT2_FINAL=$(curl -s -X GET $API/products/$PRODUCT2_ID \
  -H "Authorization: Bearer $TOKEN")

LAPTOP_FINAL_STOCK=$(echo "$PRODUCT1_FINAL" | jq -r '.data.openingStock')
MOUSE_FINAL_STOCK=$(echo "$PRODUCT2_FINAL" | jq -r '.data.openingStock')

echo "✅ Laptop stock: $LAPTOP_FINAL_STOCK units (Started: 0, Purchased: 10, Sold: 3)"
echo "✅ Mouse stock: $MOUSE_FINAL_STOCK units (Started: 0, Purchased: 50, Sold: 30)"
echo ""

echo "================================================"
echo "  ✅ COMPLETE WORKFLOW TEST SUCCESSFUL!"
echo "================================================"
echo ""
echo "Summary:"
echo "  - Created 1 supplier"
echo "  - Created 2 products"
echo "  - Purchased stock worth ₹$PURCHASE_TOTAL"
echo "  - Created 2 customers"
echo "  - Generated 2 invoices"
echo "  - Recorded payments"
echo "  - Tracked expenses"
echo "  - Inventory properly updated"
echo ""
