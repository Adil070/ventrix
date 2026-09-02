import swaggerJsdoc from 'swagger-jsdoc';
import { config } from '../../config';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ventrix API',
      version: '1.0.0',
      description: 'Ventrix — modular operational management ERP for mid-to-large businesses across any industry.',
      contact: {
        name: 'Ventrix Support',
        email: 'support@ventrix.com',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: `${config.API_URL}/api/v1`,
        description: config.IS_PRODUCTION ? 'Production Server' : 'Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 5 },
            hasNextPage: { type: 'boolean' },
            hasPreviousPage: { type: 'boolean' },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { type: 'object' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Organizations', description: 'Organization & tenant management' },
      { name: 'Customers', description: 'Customer management' },
      { name: 'Suppliers', description: 'Supplier management' },
      { name: 'Products', description: 'Product & inventory management' },
      { name: 'Inventory', description: 'Stock & warehouse operations' },
      { name: 'Invoices', description: 'Invoice & billing' },
      { name: 'Quotations', description: 'Quotation management' },
      { name: 'Sales Orders', description: 'Sales order management' },
      { name: 'Purchases', description: 'Purchase management' },
      { name: 'Payments', description: 'Payment tracking' },
      { name: 'Accounting', description: 'Double-entry accounting' },
      { name: 'GST', description: 'GST compliance & reporting' },
      { name: 'Banking', description: 'Bank account & reconciliation' },
      { name: 'Expenses', description: 'Expense management' },
      { name: 'CRM', description: 'Customer relationship management' },
      { name: 'Manufacturing', description: 'BOM & production orders' },
      { name: 'Warehouse', description: 'Warehouse & stock transfer' },
      { name: 'Employees', description: 'Employee management' },
      { name: 'Documents', description: 'Document management' },
      { name: 'Reports', description: 'Business reports' },
      { name: 'Analytics', description: 'Business analytics' },
      { name: 'Dashboard', description: 'Dashboard data' },
      { name: 'Notifications', description: 'Notifications' },
      { name: 'Subscriptions', description: 'Subscription plans' },
    ],
  },
  apis: ['./src/modules/**/*.router.ts', './src/modules/**/*.dto.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
