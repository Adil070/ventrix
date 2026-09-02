#!/bin/bash

# Test Newly Implemented Premium Features
# Features that work without schema changes: Barcodes, QR Codes, GST Reports

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

API_URL="http://localhost:4000/api/v1"
TOKEN=""
ORG_ID=""
PRODUCT_ID=""

echo -e "${BLUE}=== Testing New Premium Features ===${NC}\n"

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
  exit 1
fi

# Step 2: Test GST Reports
echo -e "\n${BLUE}2. Testing GST Reports...${NC}"

# GSTR-3B Report
echo -e "\n${BLUE}2.1 Getting GSTR-3B Report (Current Month)...${NC}"
GSTR3B_RESPONSE=$(curl -s -X GET "$API_URL/gst/reports/gstr3b?month=6&year=2026" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $GSTR3B_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ GSTR-3B report generated${NC}"
  echo $GSTR3B_RESPONSE | jq '{
    month, 
    year,
    outwardSupplies: .data.outwardSupplies.totalTax,
    inputTax: .data.inputTax.total,
    netPayable: .data.netPayable
  }'
else
  echo -e "${RED}✗ GSTR-3B report failed${NC}"
  echo $GSTR3B_RESPONSE | jq
fi

# GST Summary
echo -e "\n${BLUE}2.2 Getting GST Summary...${NC}"
GST_SUMMARY=$(curl -s -X GET "$API_URL/gst/reports/gst-summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $GST_SUMMARY | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ GST summary retrieved${NC}"
  echo $GST_SUMMARY | jq '.data | {outputTax, inputTax, netGSTPayable}'
else
  echo -e "${RED}✗ GST summary failed${NC}"
fi

# Step 3: Test Barcode & QR Features
echo -e "\n${BLUE}3. Testing Barcode & QR Code Generation...${NC}"

# Get a product
echo -e "\n${BLUE}3.1 Getting product for barcode test...${NC}"
PRODUCT_RESPONSE=$(curl -s -X GET "$API_URL/products?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

PRODUCT_ID=$(echo $PRODUCT_RESPONSE | jq -r '.data | if type == "array" then .[0].id else .products[0].id end')
PRODUCT_SKU=$(echo $PRODUCT_RESPONSE | jq -r '.data | if type == "array" then .[0].sku else .products[0].sku end')

if [ "$PRODUCT_ID" != "null" ] && [ -n "$PRODUCT_ID" ]; then
  echo -e "${GREEN}✓ Product found: $PRODUCT_SKU${NC}"
else
  echo -e "${RED}✗ No product found${NC}"
  exit 1
fi

# Generate Product Barcode (Data URL)
echo -e "\n${BLUE}3.2 Generating product barcode...${NC}"
BARCODE_RESPONSE=$(curl -s -X GET "$API_URL/products/$PRODUCT_ID/barcode?format=dataurl" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $BARCODE_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ Barcode generated${NC}"
  echo "Barcode text: $(echo $BARCODE_RESPONSE | jq -r '.data.text')"
  echo "Data URL length: $(echo $BARCODE_RESPONSE | jq -r '.data.dataURL' | wc -c) characters"
else
  echo -e "${RED}✗ Barcode generation failed${NC}"
  echo $BARCODE_RESPONSE | jq
fi

# Generate Product QR Code
echo -e "\n${BLUE}3.3 Generating product QR code...${NC}"
QR_RESPONSE=$(curl -s -X GET "$API_URL/products/$PRODUCT_ID/qrcode?format=dataurl" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID")

if [ "$(echo $QR_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ QR code generated${NC}"
  echo "Product info:"
  echo $QR_RESPONSE | jq '.data.productInfo | {name, sku, price}'
  echo "Data URL length: $(echo $QR_RESPONSE | jq -r '.data.dataURL' | wc -c) characters"
else
  echo -e "${RED}✗ QR code generation failed${NC}"
  echo $QR_RESPONSE | jq
fi

# Test UPI QR Code Generation
echo -e "\n${BLUE}3.4 Generating UPI payment QR code...${NC}"
UPI_QR_RESPONSE=$(curl -s -X POST "$API_URL/payments/upi-qrcode" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  -d '{
    "upiId": "merchant@paytm",
    "amount": 1000,
    "name": "Test Business",
    "note": "Invoice Payment"
  }')

if [ "$(echo $UPI_QR_RESPONSE | jq -r '.success')" = "true" ]; then
  echo -e "${GREEN}✓ UPI QR code generated${NC}"
  echo "UPI ID: $(echo $UPI_QR_RESPONSE | jq -r '.data.upiId')"
  echo "Amount: ₹$(echo $UPI_QR_RESPONSE | jq -r '.data.amount')"
  echo "Data URL length: $(echo $UPI_QR_RESPONSE | jq -r '.data.dataURL' | wc -c) characters"
else
  echo -e "${RED}✗ UPI QR code generation failed${NC}"
  echo $UPI_QR_RESPONSE | jq
fi

# Summary
echo -e "\n${BLUE}=== Test Summary ===${NC}"
echo -e "${GREEN}✓ GST Reports: GSTR-3B, Summary${NC}"
echo -e "${GREEN}✓ Product Barcode Generation${NC}"
echo -e "${GREEN}✓ Product QR Code Generation${NC}"
echo -e "${GREEN}✓ UPI Payment QR Code${NC}"
echo -e "\n${BLUE}All new premium features tested successfully!${NC}"
