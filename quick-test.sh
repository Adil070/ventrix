#!/bin/bash

API="http://localhost:4000/api/v1"

echo "=== 1. Health Check ==="
curl -s http://localhost:4000/health | jq .

echo -e "\n=== 2. Login ==="
LOGIN=$(curl -s -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@demotrade.local", "password": "Owner@123"}')

echo "$LOGIN" | jq '{success, message, user: .data.user.email, org: .data.organization.name}'

TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken')
echo "Token: ${TOKEN:0:50}..."

echo -e "\n=== 3. Dashboard ==="
curl -s -X GET $API/dashboard \
  -H "Authorization: Bearer $TOKEN" | jq '{success, message}'

echo -e "\n=== 4. List Customers ==="
curl -s -X GET $API/customers \
  -H "Authorization: Bearer $TOKEN" | jq '{success, count: (.data | length)}'

echo -e "\n=== 5. List Products ==="
curl -s -X GET $API/products \
  -H "Authorization: Bearer $TOKEN" | jq '{success, count: (.data | length)}'

echo -e "\n=== 6. List Invoices ==="
curl -s -X GET $API/invoices \
  -H "Authorization: Bearer $TOKEN" | jq '{success, count: (.data | length)}'

echo -e "\n=== 7. Create Customer ==="
CUSTOMER=$(curl -s -X POST $API/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Customer Ltd",
    "email": "test@customer.com",
    "phone": "9999888877",
    "creditLimit": 100000
  }')

echo "$CUSTOMER" | jq '{success, message, customerId: .data.id, name: .data.name}'
CUSTOMER_ID=$(echo "$CUSTOMER" | jq -r '.data.id')

echo -e "\n=== 8. Create Product ==="
PRODUCT=$(curl -s -X POST $API/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product XYZ",
    "sku": "TEST-XYZ-001",
    "sellingPrice": 5000,
    "costPrice": 4000,
    "taxRate": 18,
    "trackInventory": true,
    "openingStock": 100
  }')

echo "$PRODUCT" | jq '{success, message, productId: .data.id, name: .data.name}'
PRODUCT_ID=$(echo "$PRODUCT" | jq -r '.data.id')

echo -e "\n=== 9. Create Invoice ==="
INVOICE=$(curl -s -X POST $API/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"invoiceDate\": \"2026-06-30\",
    \"dueDate\": \"2026-07-15\",
    \"items\": [
      {
        \"productId\": \"$PRODUCT_ID\",
        \"description\": \"Test Product XYZ\",
        \"quantity\": 10,
        \"unitPrice\": 5000,
        \"taxRate\": 18
      }
    ]
  }")

echo "$INVOICE" | jq '{success, message, invoiceId: .data.id, total: .data.totalAmount}'
INVOICE_ID=$(echo "$INVOICE" | jq -r '.data.id')

echo -e "\n=== 10. Record Payment ==="
PAYMENT=$(curl -s -X POST $API/invoices/$INVOICE_ID/payment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 30000,
    "mode": "UPI",
    "paymentDate": "2026-06-30"
  }')

echo "$PAYMENT" | jq '{success, message}'

echo -e "\n=== 11. Get Updated Invoice ==="
curl -s -X GET $API/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{
    invoiceNumber: .data.invoiceNumber,
    total: .data.totalAmount,
    paid: .data.paidAmount,
    balance: .data.balanceAmount,
    status: .data.status
  }'

echo -e "\n=== All Basic Tests Complete ==="
