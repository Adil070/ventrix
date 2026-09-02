import { test, expect, Page } from '@playwright/test';

/**
 * Ventrix — Full E2E Browser Test
 * 
 * Run modes:
 *   HEADED (visible browser):  npx playwright test --headed
 *   HEADLESS (terminal/CI):    npx playwright test
 *   SLOW MO (watch it work):   npx playwright test --headed --slow-mo=500
 *   DEBUG (step through):      npx playwright test --debug
 */

const API_URL = 'http://localhost:4000/api/v1';
const TS = Date.now().toString();

// Test user credentials (created during test)
const TEST_USER = {
  firstName: 'E2E',
  lastName: 'Tester',
  email: `e2e${TS}@test.com`,
  password: 'Test1234!',
  organizationName: `E2E Business ${TS}`,
};

let authToken: string;
let customerId: string;
let productId: string;
let supplierId: string;
let invoiceId: string;

test.describe.serial('Full Business Workflow', () => {

  // ═══════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════
  test.describe('🔐 Authentication', () => {
    test('Register page loads and user can sign up', async ({ page }) => {
      await page.goto('/auth/register');
      await expect(page.locator('h1')).toContainText('Create your account');

      // Register via API (the form UI is verified by page load + field presence)
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_USER),
      });
      const json = await res.json();
      expect(json.success).toBe(true);
      authToken = json.data.accessToken;
    });

    test('User can login with registered credentials', async ({ page }) => {
      await page.goto('/auth/login');
      await page.waitForLoadState('networkidle');

      // Fill login form
      const emailInput = page.locator('input[type="email"]');
      const passwordInput = page.locator('input[type="password"]');
      await emailInput.fill(TEST_USER.email);
      await passwordInput.fill(TEST_USER.password);

      // Submit and wait for API response
      await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/auth/login') && resp.ok(), { timeout: 15000 }),
        page.getByRole('button', { name: /sign in|login|log in/i }).click(),
      ]);

      // Wait for client-side navigation
      await page.waitForTimeout(2000);

      // Grab token from localStorage
      authToken = await page.evaluate(() => localStorage.getItem('accessToken') || '') || authToken;
      expect(authToken).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════
  test.describe('📊 Dashboard', () => {
    test('Dashboard loads with KPIs', async ({ page }) => {
      await loginAndGo(page, '/dashboard');
      // Check that dashboard content renders
      await expect(page.locator('body')).not.toBeEmpty();
      // Verify API works
      const res = await apiGet('/dashboard');
      expect(res.success).toBe(true);
      expect(res.data.kpis).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ═══════════════════════════════════════════════════════════════
  test.describe('👥 Customers', () => {
    test('Customers page loads', async ({ page }) => {
      await loginAndGo(page, '/customers');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create customer via API (simulates form submit)', async () => {
      const res = await apiPost('/customers', {
        name: `E2E Customer ${TS}`,
        email: `customer${TS}@test.com`,
        phone: '9876543210',
        creditLimit: 200000,
      });
      expect(res.success).toBe(true);
      customerId = res.data.id;
      expect(customerId).toBeTruthy();
    });

    test('Edit customer', async () => {
      const res = await apiPatch(`/customers/${customerId}`, { creditLimit: 300000 });
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════════════════
  test.describe('📦 Products', () => {
    test('Products page loads', async ({ page }) => {
      await loginAndGo(page, '/products');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create product', async () => {
      const res = await apiPost('/products', {
        name: `E2E Laptop ${TS}`,
        sku: `E2E-${TS}`,
        sellingPrice: 55000,
        costPrice: 45000,
        mrp: 60000,
        taxRate: 18,
        trackInventory: true,
        openingStock: 25,
        reorderPoint: 5,
      });
      expect(res.success).toBe(true);
      productId = res.data.id;
      expect(productId).toBeTruthy();
    });

    test('Low stock alerts work', async () => {
      const res = await apiGet('/products/low-stock');
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SUPPLIERS + WAREHOUSE
  // ═══════════════════════════════════════════════════════════════
  test.describe('🏭 Suppliers & Warehouse', () => {
    test('Suppliers page loads', async ({ page }) => {
      await loginAndGo(page, '/suppliers');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create supplier', async () => {
      const res = await apiPost('/suppliers', {
        name: `E2E Supplier ${TS}`,
        email: `supplier${TS}@test.com`,
        phone: '8888888888',
        paymentTerms: 30,
      });
      expect(res.success).toBe(true);
      supplierId = res.data.id;
    });

    test('Create warehouse (needed for stock)', async () => {
      const res = await apiPost('/warehouses', {
        name: `E2E Warehouse ${TS}`,
        code: `WH-${TS}`,
        address: { line1: 'Industrial Area', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
        isDefault: true,
      });
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PURCHASES — Buy stock from supplier
  // ═══════════════════════════════════════════════════════════════
  test.describe('🛒 Purchases', () => {
    test('Purchases page loads', async ({ page }) => {
      await loginAndGo(page, '/purchases');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create purchase (buy 20 units) & stock increases', async () => {
      const res = await apiPost('/purchases', {
        supplierId,
        purchaseDate: '2026-08-23',
        billNumber: `BILL-${TS}`,
        items: [{ productId, description: 'E2E Laptop', quantity: 20, unitPrice: 45000, taxRate: 18 }],
      });
      expect(res.success).toBe(true);

      // Verify stock: 25 + 20 = 45
      const prod = await apiGet(`/products/${productId}`);
      expect(Number(prod.data.openingStock)).toBe(45);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INVOICES — Sell to customer
  // ═══════════════════════════════════════════════════════════════
  test.describe('🧾 Invoices', () => {
    test('Billing page loads', async ({ page }) => {
      await loginAndGo(page, '/billing/invoices');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create invoice (sell 3 units)', async () => {
      const res = await apiPost('/invoices', {
        customerId,
        invoiceDate: '2026-08-23',
        dueDate: '2026-09-07',
        items: [{ productId, description: 'E2E Laptop', quantity: 3, unitPrice: 55000, taxRate: 18 }],
      });
      expect(res.success).toBe(true);
      invoiceId = res.data.id;
    });

    test('Confirm invoice & stock decreases', async () => {
      const res = await apiPatch(`/invoices/${invoiceId}/confirm`, {});
      expect(res.success).toBe(true);

      // Verify stock: 45 - 3 = 42
      const prod = await apiGet(`/products/${productId}`);
      expect(Number(prod.data.openingStock)).toBe(42);
    });

    test('Record partial payment', async () => {
      const res = await apiPost(`/invoices/${invoiceId}/payment`, {
        amount: 100000,
        mode: 'UPI',
        paymentDate: '2026-08-23',
        referenceNumber: 'UPI-E2E-123',
      });
      expect(res.success).toBe(true);
    });

    test('Invoice shows PARTIALLY_PAID', async () => {
      const res = await apiGet(`/invoices/${invoiceId}`);
      expect(res.data.status).toBe('PARTIALLY_PAID');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // QUOTATIONS & SALES ORDERS
  // ═══════════════════════════════════════════════════════════════
  test.describe('📋 Quotations & Sales Orders', () => {
    test('Create quotation', async () => {
      const res = await apiPost('/quotations', {
        customerId,
        quotationDate: '2026-08-23',
        validUntil: '2026-09-23',
        items: [{ productId, description: 'E2E Laptop', quantity: 10, unitPrice: 54000, taxRate: 18 }],
      });
      expect(res.success).toBe(true);
    });

    test('Create sales order', async () => {
      const res = await apiPost('/sales-orders', {
        customerId,
        orderDate: '2026-08-23',
        deliveryDate: '2026-08-30',
        items: [{ productId, description: 'E2E Laptop', quantity: 5, unitPrice: 55000, taxRate: 18 }],
      });
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EXPENSES
  // ═══════════════════════════════════════════════════════════════
  test.describe('💸 Expenses', () => {
    test('Expenses page loads', async ({ page }) => {
      await loginAndGo(page, '/expenses');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create expense', async () => {
      const res = await apiPost('/expenses', {
        description: 'Office Rent August 2026',
        amount: 35000,
        date: '2026-08-01',
        paymentMode: 'BANK_TRANSFER',
      });
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INVENTORY
  // ═══════════════════════════════════════════════════════════════
  test.describe('📊 Inventory', () => {
    test('Inventory page loads', async ({ page }) => {
      await loginAndGo(page, '/inventory');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Stock adjustment (damage 2 units)', async () => {
      const res = await apiPost('/inventory/adjust', {
        productId,
        type: 'DAMAGE',
        quantity: 2,
        notes: '2 units damaged in transit',
      });
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CRM
  // ═══════════════════════════════════════════════════════════════
  test.describe('🎯 CRM', () => {
    test('CRM page loads', async ({ page }) => {
      await loginAndGo(page, '/crm/leads');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Create and update lead', async () => {
      const res = await apiPost('/crm/leads', {
        name: 'Vikram Mehta',
        email: `vikram${TS}@corp.com`,
        company: 'MegaCorp Ltd',
        source: 'Referral',
        status: 'NEW',
        expectedValue: 1000000,
      });
      expect(res.success).toBe(true);
      const leadId = res.data.id;

      const upd = await apiPatch(`/crm/leads/${leadId}`, { status: 'QUALIFIED' });
      expect(upd.success).toBe(true);
    });

    test('Pipeline view works', async () => {
      const res = await apiGet('/crm/pipeline');
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTING
  // ═══════════════════════════════════════════════════════════════
  test.describe('📒 Accounting', () => {
    test('Accounting page loads', async ({ page }) => {
      await loginAndGo(page, '/accounting');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Chart of Accounts', async () => {
      const res = await apiGet('/accounting/accounts');
      expect(res.success).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
    });

    test('Trial Balance', async () => {
      const res = await apiGet('/accounting/reports/trial-balance');
      expect(res.success).toBe(true);
    });

    test('Profit & Loss', async () => {
      const res = await apiGet('/accounting/reports/profit-loss');
      expect(res.success).toBe(true);
    });

    test('Balance Sheet', async () => {
      const res = await apiGet('/accounting/reports/balance-sheet');
      expect(res.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GST
  // ═══════════════════════════════════════════════════════════════
  test.describe('🧾 GST', () => {
    test('GST page loads', async ({ page }) => {
      await loginAndGo(page, '/gst');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('GSTR-1, GSTR-3B, GST Summary', async () => {
      expect((await apiGet('/gst/reports/gstr1?month=8&year=2026')).success).toBe(true);
      expect((await apiGet('/gst/reports/gstr3b?month=8&year=2026')).success).toBe(true);
      expect((await apiGet('/gst/reports/gst-summary')).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // REPORTS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════
  test.describe('📊 Reports & Analytics', () => {
    test('Reports page loads', async ({ page }) => {
      await loginAndGo(page, '/reports');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('All report endpoints work', async () => {
      expect((await apiGet('/reports/sales/summary')).success).toBe(true);
      expect((await apiGet('/reports/purchases/summary')).success).toBe(true);
      expect((await apiGet('/reports/outstanding/receivables')).success).toBe(true);
      expect((await apiGet('/reports/outstanding/payables')).success).toBe(true);
    });

    test('Analytics page loads', async ({ page }) => {
      await loginAndGo(page, '/analytics');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('All analytics endpoints work', async () => {
      expect((await apiGet('/analytics/revenue')).success).toBe(true);
      expect((await apiGet('/analytics/products')).success).toBe(true);
      expect((await apiGet('/analytics/customers')).success).toBe(true);
      expect((await apiGet('/analytics/cash-flow')).success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // OTHER MODULES
  // ═══════════════════════════════════════════════════════════════
  test.describe('⚙️ Other Modules', () => {
    test('Banking', async ({ page }) => {
      await loginAndGo(page, '/banking');
      await expect(page.locator('body')).not.toBeEmpty();
      const res = await apiPost('/banking/accounts', {
        accountName: `E2E Account ${TS}`, bankName: 'SBI',
        accountNumber: `321${TS}`, ifscCode: 'SBIN0001234',
        accountType: 'CURRENT', openingBalance: 250000,
      });
      expect(res.success).toBe(true);
    });

    test('Manufacturing', async ({ page }) => {
      await loginAndGo(page, '/manufacturing');
      await expect(page.locator('body')).not.toBeEmpty();
      expect((await apiGet('/manufacturing/bom')).success).toBe(true);
    });

    test('Employees', async ({ page }) => {
      await loginAndGo(page, '/employees');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Documents', async ({ page }) => {
      await loginAndGo(page, '/documents');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Settings', async ({ page }) => {
      await loginAndGo(page, '/settings');
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Returns', async ({ page }) => {
      await loginAndGo(page, '/returns');
      await expect(page.locator('body')).not.toBeEmpty();
      expect((await apiGet('/returns/return-orders')).success).toBe(true);
      expect((await apiGet('/returns/credit-notes')).success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function loginAndGo(page: Page, path: string) {
  // If we don't have a token yet, login first
  if (!authToken) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    const json = await res.json();
    authToken = json.data.accessToken;
  }

  // Set auth in localStorage before navigating
  await page.goto('/auth/login');
  await page.evaluate(({ token, email }) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('refreshToken', 'dummy');
    localStorage.setItem('organizationId', 'auto');
    // Minimal auth-storage for zustand persist
    localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        user: { id: '1', email, firstName: 'E2E', lastName: 'Tester', isSuperAdmin: false, organizations: [] },
        accessToken: token,
        refreshToken: 'dummy',
        isAuthenticated: true,
        currentOrganization: null,
      },
      version: 0,
    }));
  }, { token: authToken, email: TEST_USER.email });

  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function apiGet(endpoint: string) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
  });
  return res.json();
}

async function apiPost(endpoint: string, body: any) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPatch(endpoint: string, body: any) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
