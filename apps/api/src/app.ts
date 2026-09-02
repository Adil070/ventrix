import 'dotenv/config';
import 'express-async-errors';
import express, { Application } from 'express';

// Global BigInt JSON serialization — Prisma raw queries / aggregates can return
// BigInt which JSON.stringify cannot handle natively. Serialize as Number.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { config } from './config';
import { logger } from './infrastructure/logger';
import { swaggerSpec } from './infrastructure/swagger';
import { errorHandler } from './shared/middleware/error-handler';
import { rateLimiter } from './shared/middleware/rate-limiter';
import { requestId } from './shared/middleware/request-id';
import { tenantMiddleware } from './shared/middleware/tenant';

// Route imports
import { authRouter } from './modules/auth/auth.router';
import { userRouter } from './modules/users/user.router';
import { organizationRouter } from './modules/organizations/organization.router';
import { customerRouter } from './modules/customers/customer.router';
import { supplierRouter } from './modules/suppliers/supplier.router';
import { productRouter } from './modules/products/product.router';
import { inventoryRouter } from './modules/inventory/inventory.router';
import { invoiceRouter } from './modules/billing/invoice.router';
import { quotationRouter } from './modules/billing/quotation.router';
import { salesOrderRouter } from './modules/billing/sales-order.router';
import { purchaseRouter } from './modules/purchases/purchase.router';
import { paymentRouter } from './modules/payments/payment.router';
import { accountingRouter } from './modules/accounting/accounting.router';
import { gstRouter } from './modules/gst/gst.router';
import { bankingRouter } from './modules/banking/banking.router';
import { expenseRouter } from './modules/expenses/expense.router';
import { crmRouter } from './modules/crm/crm.router';
import { manufacturingRouter } from './modules/manufacturing/manufacturing.router';
import { warehouseRouter } from './modules/warehouse/warehouse.router';
import { employeeRouter } from './modules/employees/employee.router';
import { documentRouter } from './modules/documents/document.router';
import { notificationRouter } from './modules/notifications/notification.router';
import { reportRouter } from './modules/reports/report.router';
import { subscriptionRouter } from './modules/subscriptions/subscription.router';
import { dashboardRouter } from './modules/dashboard/dashboard.router';
import { analyticsRouter } from './modules/analytics/analytics.router';
import { returnRouter } from './modules/returns/return.router';

export function createApp(): Application {
  const app = express();

  // ──────────────────────────────────────────
  // Security Middleware
  // ──────────────────────────────────────────
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  }));

  app.use(cors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Organization-ID'],
  }));

  // ──────────────────────────────────────────
  // Core Middleware
  // ──────────────────────────────────────────
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ──────────────────────────────────────────
  // Logging & Request Tracing
  // ──────────────────────────────────────────
  app.use(requestId);
  app.use(pinoHttp({ logger }));

  // ──────────────────────────────────────────
  // Rate Limiting
  // ──────────────────────────────────────────
  app.use('/api/', rateLimiter);

  // ──────────────────────────────────────────
  // API Documentation
  // ──────────────────────────────────────────
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Ventrix API Documentation',
  }));

  // ──────────────────────────────────────────
  // Health Check
  // ──────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.NODE_ENV,
    });
  });

  // ──────────────────────────────────────────
  // API Routes (v1)
  // ──────────────────────────────────────────
  const apiV1 = express.Router();

  // Public routes
  apiV1.use('/auth', authRouter);

  // Tenant middleware (extracts org context)
  apiV1.use(tenantMiddleware);

  // Protected routes
  apiV1.use('/users', userRouter);
  apiV1.use('/organizations', organizationRouter);
  apiV1.use('/customers', customerRouter);
  apiV1.use('/suppliers', supplierRouter);
  apiV1.use('/products', productRouter);
  apiV1.use('/inventory', inventoryRouter);
  apiV1.use('/invoices', invoiceRouter);
  apiV1.use('/quotations', quotationRouter);
  apiV1.use('/sales-orders', salesOrderRouter);
  apiV1.use('/purchases', purchaseRouter);
  apiV1.use('/payments', paymentRouter);
  apiV1.use('/accounting', accountingRouter);
  apiV1.use('/gst', gstRouter);
  apiV1.use('/banking', bankingRouter);
  apiV1.use('/expenses', expenseRouter);
  apiV1.use('/crm', crmRouter);
  apiV1.use('/manufacturing', manufacturingRouter);
  apiV1.use('/warehouses', warehouseRouter);
  apiV1.use('/employees', employeeRouter);
  apiV1.use('/documents', documentRouter);
  apiV1.use('/notifications', notificationRouter);
  apiV1.use('/reports', reportRouter);
  apiV1.use('/subscriptions', subscriptionRouter);
  apiV1.use('/dashboard', dashboardRouter);
  apiV1.use('/analytics', analyticsRouter);
  apiV1.use('/returns', returnRouter);

  app.use('/api/v1', apiV1);

  // ──────────────────────────────────────────
  // 404 Handler
  // ──────────────────────────────────────────
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      message: `Route ${req.originalUrl} not found`,
    });
  });

  // ──────────────────────────────────────────
  // Global Error Handler
  // ──────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
