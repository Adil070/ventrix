import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_URL}/api/v1`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor - add auth token
    this.client.interceptors.request.use((config) => {
      const token = this.getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;

      const orgId = this.getOrgId();
      if (orgId) config.headers['X-Organization-ID'] = orgId;

      return config;
    });

    // Response interceptor - handle auth errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Try refresh
          const refreshed = await this.refreshToken();
          if (!refreshed) {
            this.clearAuth();
            window.location.href = '/auth/login';
          } else if (error.config) {
            return this.client(error.config);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  private getOrgId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('organizationId');
  }

  private clearAuth() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('organizationId');
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return false;

      const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refreshToken });
      const { accessToken } = response.data.data;
      localStorage.setItem('accessToken', accessToken);
      return true;
    } catch {
      return false;
    }
  }

  // Auth
  auth = {
    register: (data: any) => this.client.post('/auth/register', data),
    login: (data: any) => this.client.post('/auth/login', data),
    loginWithOTP: (data: any) => this.client.post('/auth/login/otp', data),
    sendOTP: (data: any) => this.client.post('/auth/otp/send', data),
    loginWithGoogle: (data: any) => this.client.post('/auth/google', data),
    logout: () => this.client.post('/auth/logout'),
    refreshToken: (data: any) => this.client.post('/auth/refresh', data),
    forgotPassword: (data: any) => this.client.post('/auth/forgot-password', data),
    resetPassword: (data: any) => this.client.post('/auth/reset-password', data),
    verifyEmail: (token: string) => this.client.get(`/auth/verify-email?token=${token}`),
  };

  // Dashboard
  dashboard = {
    get: () => this.client.get('/dashboard'),
    getSummary: () => this.client.get('/dashboard'),
    getAdminStats: () => this.client.get('/dashboard/admin'),
  };

  // Analytics
  analytics = {
    revenue: (params?: any) => this.client.get('/analytics/revenue', { params }),
    products: (params?: any) => this.client.get('/analytics/products', { params }),
    customers: (params?: any) => this.client.get('/analytics/customers', { params }),
    cashFlow: (params?: any) => this.client.get('/analytics/cash-flow', { params }),
    getRevenue: (params?: any) => this.client.get('/analytics/revenue', { params }),
    getProducts: (params?: any) => this.client.get('/analytics/products', { params }),
    getCustomers: (params?: any) => this.client.get('/analytics/customers', { params }),
    getCashFlow: (params?: any) => this.client.get('/analytics/cash-flow', { params }),
  };

  // Customers
  customers = {
    list: (params?: any) => this.client.get('/customers', { params }),
    create: (data: any) => this.client.post('/customers', data),
    get: (id: string) => this.client.get(`/customers/${id}`),
    update: (id: string, data: any) => this.client.put(`/customers/${id}`, data),
    delete: (id: string) => this.client.delete(`/customers/${id}`),
    getLedger: (id: string, params?: any) => this.client.get(`/customers/${id}/ledger`, { params }),
    getStatement: (id: string, params?: any) => this.client.get(`/customers/${id}/statement`, { params }),
  };

  // Suppliers
  suppliers = {
    list: (params?: any) => this.client.get('/suppliers', { params }),
    create: (data: any) => this.client.post('/suppliers', data),
    get: (id: string) => this.client.get(`/suppliers/${id}`),
    update: (id: string, data: any) => this.client.put(`/suppliers/${id}`, data),
    delete: (id: string) => this.client.delete(`/suppliers/${id}`),
    getLedger: (id: string, params?: any) => this.client.get(`/suppliers/${id}/ledger`, { params }),
  };

  // Products
  products = {
    list: (params?: any) => this.client.get('/products', { params }),
    create: (data: any) => this.client.post('/products', data),
    get: (id: string) => this.client.get(`/products/${id}`),
    update: (id: string, data: any) => this.client.put(`/products/${id}`, data),
    delete: (id: string) => this.client.delete(`/products/${id}`),
    getStockHistory: (id: string, params?: any) => this.client.get(`/products/${id}/stock-history`, { params }),
    getLowStock: () => this.client.get('/products/low-stock'),
    listCategories: () => this.client.get('/products/categories'),
    listUnits: () => this.client.get('/products/units'),
    listBrands: () => this.client.get('/products/brands'),
    categories: { list: () => this.client.get('/products/categories'), create: (d: any) => this.client.post('/products/categories', d) },
    units: { list: () => this.client.get('/products/units'), create: (d: any) => this.client.post('/products/units', d) },
    brands: { list: () => this.client.get('/products/brands'), create: (d: any) => this.client.post('/products/brands', d) },
  };

  // Inventory
  inventory = {
    summary: (params?: any) => this.client.get('/inventory/summary', { params }),
    valuation: () => this.client.get('/inventory/valuation'),
    movements: (params?: any) => this.client.get('/inventory/movements', { params }),
    adjust: (data: any) => this.client.post('/inventory/adjust', data),
    transfer: (data: any) => this.client.post('/inventory/transfer', data),
    getSummary: (params?: any) => this.client.get('/inventory/summary', { params }),
    getMovements: (params?: any) => this.client.get('/inventory/movements', { params }),
    adjustStock: (data: any) => this.client.post('/inventory/adjust', data),
    transferStock: (data: any) => this.client.post('/inventory/transfer', data),
  };

  // Invoices
  invoices = {
    list: (params?: any) => this.client.get('/invoices', { params }),
    create: (data: any) => this.client.post('/invoices', data),
    get: (id: string) => this.client.get(`/invoices/${id}`),
    update: (id: string, data: any) => this.client.put(`/invoices/${id}`, data),
    confirm: (id: string) => this.client.patch(`/invoices/${id}/confirm`),
    cancel: (id: string) => this.client.patch(`/invoices/${id}/cancel`, { reason: 'Cancelled' }),
    recordPayment: (id: string, data: any) => this.client.post(`/invoices/${id}/payment`, data),
    generatePdf: (id: string) => this.client.get(`/invoices/${id}/pdf`, { responseType: 'blob' }),
    sendEmail: (id: string, data: any) => this.client.post(`/invoices/${id}/send-email`, data),
  };

  // Quotations
  quotations = {
    list: (params?: any) => this.client.get('/quotations', { params }),
    create: (data: any) => this.client.post('/quotations', data),
    get: (id: string) => this.client.get(`/quotations/${id}`),
    send: (id: string) => this.client.post(`/quotations/${id}/send`),
    convertToInvoice: (id: string) => this.client.post(`/quotations/${id}/convert-to-invoice`),
    delete: (id: string) => this.client.delete(`/quotations/${id}`),
  };

  // Sales Orders
  salesOrders = {
    list: (params?: any) => this.client.get('/sales-orders', { params }),
    create: (data: any) => this.client.post('/sales-orders', data),
    get: (id: string) => this.client.get(`/sales-orders/${id}`),
    convertToInvoice: (id: string) => this.client.post(`/sales-orders/${id}/convert-to-invoice`),
    cancel: (id: string) => this.client.delete(`/sales-orders/${id}`),
  };

  // Purchases
  purchases = {
    list: (params?: any) => this.client.get('/purchases', { params }),
    create: (data: any) => this.client.post('/purchases', data),
    get: (id: string) => this.client.get(`/purchases/${id}`),
    cancel: (id: string) => this.client.post(`/purchases/${id}/cancel`),
  };

  // Payments
  payments = {
    list: (params?: any) => this.client.get('/payments', { params }),
    create: (data: any) => this.client.post('/payments', data),
    record: (data: any) => this.client.post('/payments', data),
    get: (id: string) => this.client.get(`/payments/${id}`),
  };

  // Accounting
  accounting = {
    accounts: { list: () => this.client.get('/accounting/accounts'), create: (d: any) => this.client.post('/accounting/accounts', d), get: (id: string) => this.client.get(`/accounting/accounts/${id}`) },
    journal: { list: (p?: any) => this.client.get('/accounting/journal', { params: p }), create: (d: any) => this.client.post('/accounting/journal', d) },
    reports: {
      trialBalance: (p?: any) => this.client.get('/accounting/reports/trial-balance', { params: p }),
      balanceSheet: (p?: any) => this.client.get('/accounting/reports/balance-sheet', { params: p }),
      profitLoss: (p?: any) => this.client.get('/accounting/reports/profit-loss', { params: p }),
      generalLedger: (p?: any) => this.client.get('/accounting/reports/general-ledger', { params: p }),
      dayBook: (p?: any) => this.client.get('/accounting/reports/day-book', { params: p }),
      cashFlow: (p?: any) => this.client.get('/accounting/reports/cash-flow', { params: p }),
    },
    getAccounts: () => this.client.get('/accounting/accounts'),
    getJournal: (p?: any) => this.client.get('/accounting/journal', { params: p }),
    getTrialBalance: (p?: any) => this.client.get('/accounting/reports/trial-balance', { params: p }),
    getBalanceSheet: (p?: any) => this.client.get('/accounting/reports/balance-sheet', { params: p }),
    getProfitLoss: (p?: any) => this.client.get('/accounting/reports/profit-loss', { params: p }),
  };

  // GST
  gst = {
    hsn: { list: (p?: any) => this.client.get('/gst/hsn', { params: p }), create: (d: any) => this.client.post('/gst/hsn', d) },
    validateGstin: (gstin: string) => this.client.post('/gst/validate-gstin', { gstin }),
    taxRates: { list: () => this.client.get('/gst/tax-rates'), create: (d: any) => this.client.post('/gst/tax-rates', d) },
    reports: {
      gstr1: (p: any) => this.client.get('/gst/reports/gstr1', { params: p }),
      gstr2: (p: any) => this.client.get('/gst/reports/gstr2', { params: p }),
      gstr3b: (p: any) => this.client.get('/gst/reports/gstr3b', { params: p }),
      summary: (p?: any) => this.client.get('/gst/reports/gst-summary', { params: p }),
    },
    listHSN: (p?: any) => this.client.get('/gst/hsn', { params: p }),
    getSummary: (p?: any) => this.client.get('/gst/reports/gst-summary', { params: p }),
    getGSTR1: (p?: any) => this.client.get('/gst/reports/gstr1', { params: p }),
    getGSTR3B: (p?: any) => this.client.get('/gst/reports/gstr3b', { params: p }),
  };

  // Banking
  banking = {
    accounts: { list: () => this.client.get('/banking/accounts'), create: (d: any) => this.client.post('/banking/accounts', d), get: (id: string) => this.client.get(`/banking/accounts/${id}`), update: (id: string, d: any) => this.client.put(`/banking/accounts/${id}`, d) },
    transactions: { list: (accountId: string, p?: any) => this.client.get(`/banking/accounts/${accountId}/transactions`, { params: p }), create: (accountId: string, d: any) => this.client.post(`/banking/accounts/${accountId}/transactions`, d) },
    reconcile: { get: (accountId: string) => this.client.get(`/banking/accounts/${accountId}/reconcile`), save: (accountId: string, d: any) => this.client.post(`/banking/accounts/${accountId}/reconcile`, d) },
    listAccounts: () => this.client.get('/banking/accounts'),
    createAccount: (d: any) => this.client.post('/banking/accounts', d),
    getTransactions: (accountId: string, p?: any) => this.client.get(`/banking/accounts/${accountId}/transactions`, { params: p }),
  };

  // Expenses
  expenses = {
    list: (params?: any) => this.client.get('/expenses', { params }),
    create: (data: any) => this.client.post('/expenses', data),
    get: (id: string) => this.client.get(`/expenses/${id}`),
    update: (id: string, data: any) => this.client.put(`/expenses/${id}`, data),
    delete: (id: string) => this.client.delete(`/expenses/${id}`),
    listCategories: () => this.client.get('/expenses/categories/list'),
    categories: { list: () => this.client.get('/expenses/categories/list'), create: (d: any) => this.client.post('/expenses/categories', d) },
  };

  // CRM
  crm = {
    leads: { list: (p?: any) => this.client.get('/crm/leads', { params: p }), create: (d: any) => this.client.post('/crm/leads', d), get: (id: string) => this.client.get(`/crm/leads/${id}`), update: (id: string, d: any) => this.client.put(`/crm/leads/${id}`, d), delete: (id: string) => this.client.delete(`/crm/leads/${id}`), addNote: (id: string, d: any) => this.client.post(`/crm/leads/${id}/notes`, d) },
    tasks: { list: (p?: any) => this.client.get('/crm/tasks', { params: p }), create: (d: any) => this.client.post('/crm/tasks', d), update: (id: string, d: any) => this.client.put(`/crm/tasks/${id}`, d) },
    pipeline: () => this.client.get('/crm/pipeline'),
    listLeads: (p?: any) => this.client.get('/crm/leads', { params: p }),
    createLead: (d: any) => this.client.post('/crm/leads', d),
    updateLead: (id: string, d: any) => this.client.put(`/crm/leads/${id}`, d),
    deleteLead: (id: string) => this.client.delete(`/crm/leads/${id}`),
    getPipeline: () => this.client.get('/crm/pipeline'),
  };

  // Manufacturing
  manufacturing = {
    bom: { list: () => this.client.get('/manufacturing/bom'), create: (d: any) => this.client.post('/manufacturing/bom', d) },
    orders: { list: (p?: any) => this.client.get('/manufacturing/orders', { params: p }), create: (d: any) => this.client.post('/manufacturing/orders', d), start: (id: string) => this.client.post(`/manufacturing/orders/${id}/start`), complete: (id: string) => this.client.post(`/manufacturing/orders/${id}/complete`) },
    listBOM: () => this.client.get('/manufacturing/bom'),
    createBOM: (d: any) => this.client.post('/manufacturing/bom', d),
    listOrders: (p?: any) => this.client.get('/manufacturing/orders', { params: p }),
    createOrder: (d: any) => this.client.post('/manufacturing/orders', d),
    startOrder: (id: string) => this.client.post(`/manufacturing/orders/${id}/start`),
    completeOrder: (id: string) => this.client.post(`/manufacturing/orders/${id}/complete`),
  };

  // Warehouse
  warehouse = {
    list: () => this.client.get('/warehouses'),
    create: (d: any) => this.client.post('/warehouses', d),
    get: (id: string) => this.client.get(`/warehouses/${id}`),
    update: (id: string, d: any) => this.client.put(`/warehouses/${id}`, d),
    stock: (id: string) => this.client.get(`/warehouses/${id}/stock`),
    getStock: (id: string) => this.client.get(`/warehouses/${id}/stock`),
  };

  // Employees
  employees = {
    list: (params?: any) => this.client.get('/employees', { params }),
    create: (data: any) => this.client.post('/employees', data),
    get: (id: string) => this.client.get(`/employees/${id}`),
    update: (id: string, data: any) => this.client.put(`/employees/${id}`, data),
    delete: (id: string) => this.client.delete(`/employees/${id}`),
    markAttendance: (id: string, d: any) => this.client.post(`/employees/${id}/attendance`, d),
    attendance: { get: (id: string, p?: any) => this.client.get(`/employees/${id}/attendance`, { params: p }), record: (d: any) => this.client.post('/employees/attendance', d) },
  };

  // Documents
  documents = {
    list: (params?: any) => this.client.get('/documents', { params }),
    upload: (formData: FormData) => this.client.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
    download: (id: string) => this.client.get(`/documents/${id}/download`),
    getDownloadUrl: (id: string) => this.client.get(`/documents/${id}/download`),
    delete: (id: string) => this.client.delete(`/documents/${id}`),
  };

  // Notifications
  notifications = {
    list: (params?: any) => this.client.get('/notifications', { params }),
    markRead: (id: string) => this.client.post(`/notifications/${id}/read`),
    markAllRead: () => this.client.post('/notifications/read-all'),
    delete: (id: string) => this.client.delete(`/notifications/${id}`),
  };

  // Returns & Credit Notes
  returns = {
    listReturns: (params?: any) => this.client.get('/returns/return-orders', { params }),
    createReturn: (data: any) => this.client.post('/returns/return-orders', data),
    getReturn: (id: string) => this.client.get(`/returns/return-orders/${id}`),
    approveReturn: (id: string) => this.client.post(`/returns/return-orders/${id}/approve`),
    listCreditNotes: (params?: any) => this.client.get('/returns/credit-notes', { params }),
    createCreditNote: (data: any) => this.client.post('/returns/credit-notes', data),
    getCreditNote: (id: string) => this.client.get(`/returns/credit-notes/${id}`),
    confirmCreditNote: (id: string) => this.client.post(`/returns/credit-notes/${id}/confirm`),
  };

  // Reports
  reports = {
    sales: { summary: (p?: any) => this.client.get('/reports/sales/summary', { params: p }) },
    purchases: { summary: (p?: any) => this.client.get('/reports/purchases/summary', { params: p }) },
    outstanding: { receivables: () => this.client.get('/reports/outstanding/receivables'), payables: () => this.client.get('/reports/outstanding/payables') },
    expenses: { summary: (p?: any) => this.client.get('/reports/expenses/summary', { params: p }) },
    inventory: { aging: () => this.client.get('/reports/inventory/aging'), fastMoving: (p?: any) => this.client.get('/reports/inventory/fast-moving', { params: p }) },
    getSalesSummary: (p?: any) => this.client.get('/reports/sales/summary', { params: p }),
    getPurchasesSummary: (p?: any) => this.client.get('/reports/purchases/summary', { params: p }),
    getOutstanding: () => Promise.all([this.client.get('/reports/outstanding/receivables'), this.client.get('/reports/outstanding/payables')]).then(([r, p]) => ({ data: { data: { receivables: r.data.data, payables: p.data.data } } })),
    getExpensesSummary: (p?: any) => this.client.get('/reports/expenses/summary', { params: p }),
    getInventoryAging: () => this.client.get('/reports/inventory/aging'),
  };

  // Users
  users = {
    me: () => this.client.get('/users/me'),
    updateMe: (d: any) => this.client.put('/users/me', d),
    changePassword: (d: any) => this.client.post('/users/me/change-password', d),
    members: () => this.client.get('/users/organization/members'),
    getOrgMembers: () => this.client.get('/users/organization/members'),
    invite: (d: any) => this.client.post('/users/organization/members/invite', d),
    updateRole: (userId: string, d: any) => this.client.put(`/users/organization/members/${userId}/role`, d),
    removeMember: (userId: string) => this.client.delete(`/users/organization/members/${userId}`),
    sessions: () => this.client.get('/users/me/sessions'),
    terminateSession: (id: string) => this.client.delete(`/users/me/sessions/${id}`),
  };

  // Organization
  organization = {
    get: () => this.client.get('/organizations'),
    update: (d: any) => this.client.put('/organizations', d),
    branches: { list: () => this.client.get('/organizations/branches'), create: (d: any) => this.client.post('/organizations/branches', d), update: (id: string, d: any) => this.client.put(`/organizations/branches/${id}`, d) },
    auditLogs: (p?: any) => this.client.get('/organizations/audit-logs', { params: p }),
    priceLists: { list: () => this.client.get('/organizations/price-lists'), create: (d: any) => this.client.post('/organizations/price-lists', d) },
    paymentTerms: () => this.client.get('/organizations/payment-terms'),
  };

  // Subscription
  subscription = {
    get: () => this.client.get('/subscriptions'),
    upgrade: (d: any) => this.client.post('/subscriptions/upgrade', d),
    cancel: () => this.client.post('/subscriptions/cancel'),
  };
}

export const api = new ApiClient();
export default api;
