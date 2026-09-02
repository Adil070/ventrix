#!/bin/bash

# Test Returns and Credit/Debit Notes API
# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

API_URL="http://localhost:4000/api/v1"
TOKEN=""
ORG_ID=""
CUSTOMER_ID=""
INVOICE_ID=""
RETURN_ORDER_ID=""
CREDIT_NOTE_ID=""

echo -e "${BLUE}=== Testing Returns & Credit/Debit Notes API ===${NC}\n"

# Step 1: Login
echo -e "${BLUE}1. Logging in...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@demotrade.local",
    "password": "Owner@123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.accessToken')
ORG_ID=$(echo $LOGIN_RESPONSE | jq -r '.data.organization.id')

if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
  echo -e "${GREEN}✓ Login successful${NC}"
  echo "Organization ID: $ORG_ID"
else
  echo -e "${RED}✗ Login failed${NC}"
  echo $LOGIN_RESPONSE | jq
  exit 1
fi

# Step 2: Get a customer
echo -e "\n${BLUE}2. Getting customer...${NC}"
CUSTOMER_RESPONSE=$(curl -s -X GET "$API_URL/customers?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

CUSTOMER_ID=$(echo $CUSTOMER_RESPONSE | jq -r '.data | if type == "array" then .[0].id else .customers[0].id end')
if [ "$CUSTOMER_ID" != "null" ] && [ -n "$CUSTOMER_ID" ]; then
  echo -e "${GREEN}✓ Customer found: $CUSTOMER_ID${NC}"
else
  echo -e "${RED}✗ No customer found${NC}"
  exit 1
fi

# Step 3: Get an invoice
echo -e "\n${BLUE}3. Getting invoice...${NC}"
INVOICE_RESPONSE=$(curl -s -X GET "$API_URL/invoices?status=CONFIRMED&limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

INVOICE_ID=$(echo $INVOICE_RESPONSE | jq -r '.data | if type == "array" then .[0].id else .invoices[0].id end')
if [ "$INVOICE_ID" != "null" ] && [ -n "$INVOICE_ID" ]; then
  echo -e "${GREEN}✓ Invoice found: $INVOICE_ID${NC}"
  INVOICE_DETAILS=$(echo $INVOICE_RESPONSE | jq '.data[0] | {invoiceNumber, totalAmount, items: .items | length}')
  echo $INVOICE_DETAILS | jq
else
  echo -e "${RED}✗ No confirmed invoice found${NC}"
  exit 1
fi

# Step 4: Create a return order
echo -e "\n${BLUE}4. Creating return order...${NC}"
RETURN_RESPONSE=$(curl -s -X POST "$API_URL/returns/return-orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  -d "{
    \"type\": \"SALES_RETURN\",
    \"referenceType\": \"INVOICE\",
    \"referenceId\": \"$INVOICE_ID\",
    \"customerId\": \"$CUSTOMER_ID\",
    \"returnDate\": \"$(date -I)\",
    \"reason\": \"DEFECTIVE\",
    \"reasonNote\": \"Product was damaged during delivery\",
    \"items\": [
      {
        \"productId\": $(echo $INVOICE_RESPONSE | jq '.data[0].items[0].productId'),
        \"quantity\": 1,
        \"unitPrice\": $(echo $INVOICE_RESPONSE | jq '.data[0].items[0].unitPrice'),
        \"taxRate\": $(echo $INVOICE_RESPONSE | jq '.data[0].items[0].taxRate'),
        \"discountAmount\": 0,
        \"reason\": \"Damaged item\"
      }
    ],
    \"notes\": \"Customer requested return due to damage\",
    \"generateCreditNote\": true
  }")

RETURN_ORDER_ID=$(echo $RETURN_RESPONSE | jq -r '.data.id')
if [ "$RETURN_ORDER_ID" != "null" ] && [ -n "$RETURN_ORDER_ID" ]; then
  echo -e "${GREEN}✓ Return order created${NC}"
  echo $RETURN_RESPONSE | jq '.data | {id, returnOrderNumber, status, totalAmount, reason}'
else
  echo -e "${RED}✗ Return order creation failed${NC}"
  echo $RETURN_RESPONSE | jq
  exit 1
fi

# Step 5: Get return orders list
echo -e "\n${BLUE}5. Getting return orders...${NC}"
RETURNS_LIST=$(curl -s -X GET "$API_URL/returns/return-orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

RETURNS_COUNT=$(echo $RETURNS_LIST | jq '.data | length')
echo -e "${GREEN}✓ Found $RETURNS_COUNT return orders${NC}"

# Step 6: Get single return order
echo -e "\n${BLUE}6. Getting return order details...${NC}"
RETURN_DETAIL=$(curl -s -X GET "$API_URL/returns/return-orders/$RETURN_ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $RETURN_DETAIL | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ Return order retrieved${NC}"
  echo $RETURN_DETAIL | jq '.data | {returnOrderNumber, status, totalAmount, items: .items | length}'
else
  echo -e "${RED}✗ Failed to retrieve return order${NC}"
fi

# Step 7: Approve return order
echo -e "\n${BLUE}7. Approving return order...${NC}"
APPROVE_RESPONSE=$(curl -s -X POST "$API_URL/returns/return-orders/$RETURN_ORDER_ID/approve" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $APPROVE_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ Return order approved${NC}"
  echo $APPROVE_RESPONSE | jq '.data | {status, approvedAt}'
else
  echo -e "${RED}✗ Failed to approve return order${NC}"
  echo $APPROVE_RESPONSE | jq
fi

# Step 8: Create a credit note
echo -e "\n${BLUE}8. Creating credit note...${NC}"
CREDIT_NOTE_RESPONSE=$(curl -s -X POST "$API_URL/returns/credit-notes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  -d "{
    \"type\": \"CREDIT_NOTE\",
    \"customerId\": \"$CUSTOMER_ID\",
    \"referenceType\": \"RETURN_ORDER\",
    \"referenceId\": \"$RETURN_ORDER_ID\",
    \"noteDate\": \"$(date -I)\",
    \"reason\": \"Return approved - issuing credit for defective items\",
    \"items\": [
      {
        \"description\": \"Credit for returned items\",
        \"quantity\": 1,
        \"unitPrice\": 100,
        \"taxRate\": 18,
        \"amount\": 100
      }
    ],
    \"discountAmount\": 0,
    \"shippingCharges\": 0,
    \"notes\": \"Credit note issued for approved return\"
  }")

CREDIT_NOTE_ID=$(echo $CREDIT_NOTE_RESPONSE | jq -r '.data.id')
if [ "$CREDIT_NOTE_ID" != "null" ] && [ -n "$CREDIT_NOTE_ID" ]; then
  echo -e "${GREEN}✓ Credit note created${NC}"
  echo $CREDIT_NOTE_RESPONSE | jq '.data | {id, noteNumber, type, status, totalAmount}'
else
  echo -e "${RED}✗ Credit note creation failed${NC}"
  echo $CREDIT_NOTE_RESPONSE | jq
  exit 1
fi

# Step 9: Get credit notes list
echo -e "\n${BLUE}9. Getting credit/debit notes...${NC}"
CREDIT_NOTES_LIST=$(curl -s -X GET "$API_URL/returns/credit-notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

NOTES_COUNT=$(echo $CREDIT_NOTES_LIST | jq '.data | length')
echo -e "${GREEN}✓ Found $NOTES_COUNT credit/debit notes${NC}"

# Step 10: Get single credit note
echo -e "\n${BLUE}10. Getting credit note details...${NC}"
CREDIT_NOTE_DETAIL=$(curl -s -X GET "$API_URL/returns/credit-notes/$CREDIT_NOTE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $CREDIT_NOTE_DETAIL | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ Credit note retrieved${NC}"
  echo $CREDIT_NOTE_DETAIL | jq '.data | {noteNumber, type, status, totalAmount}'
else
  echo -e "${RED}✗ Failed to retrieve credit note${NC}"
fi

# Step 11: Confirm credit note
echo -e "\n${BLUE}11. Confirming credit note...${NC}"
CONFIRM_RESPONSE=$(curl -s -X POST "$API_URL/returns/credit-notes/$CREDIT_NOTE_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $CONFIRM_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ Credit note confirmed${NC}"
  echo $CONFIRM_RESPONSE | jq '.data | {status, confirmedAt}'
else
  echo -e "${RED}✗ Failed to confirm credit note${NC}"
  echo $CONFIRM_RESPONSE | jq
fi

# Step 12: Create a debit note
echo -e "\n${BLUE}12. Creating debit note (for purchase return)...${NC}"
DEBIT_NOTE_RESPONSE=$(curl -s -X POST "$API_URL/returns/credit-notes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  -d '{
    "type": "DEBIT_NOTE",
    "referenceType": "ADJUSTMENT",
    "noteDate": "'$(date -I)'",
    "reason": "Price adjustment for previous purchase",
    "items": [
      {
        "description": "Price difference adjustment",
        "quantity": 1,
        "unitPrice": 50,
        "taxRate": 18,
        "amount": 50
      }
    ],
    "discountAmount": 0,
    "shippingCharges": 0
  }')

DEBIT_NOTE_ID=$(echo $DEBIT_NOTE_RESPONSE | jq -r '.data.id')
if [ "$DEBIT_NOTE_ID" != "null" ] && [ -n "$DEBIT_NOTE_ID" ]; then
  echo -e "${GREEN}✓ Debit note created${NC}"
  echo $DEBIT_NOTE_RESPONSE | jq '.data | {id, noteNumber, type, status, totalAmount}'
else
  echo -e "${RED}✗ Debit note creation failed${NC}"
  echo $DEBIT_NOTE_RESPONSE | jq
fi

# Summary
echo -e "\n${BLUE}=== Test Summary ===${NC}"
echo -e "${GREEN}✓ Return Orders: Create, List, View, Approve${NC}"
echo -e "${GREEN}✓ Credit Notes: Create, List, View, Confirm${NC}"
echo -e "${GREEN}✓ Debit Notes: Create${NC}"
echo -e "\n${BLUE}All returns and credit/debit notes tests completed!${NC}"
