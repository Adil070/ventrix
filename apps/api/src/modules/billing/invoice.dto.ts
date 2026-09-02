import { z } from 'zod';

const InvoiceItemSchema = z.object({
  productId: z.string().optional(),
  variantId: z.string().optional(),
  taxRateId: z.string().optional(),
  description: z.string().min(1),
  hsnCode: z.string().optional(),
  sacCode: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unit: z.string().optional(),
  unitPrice: z.coerce.number().min(0),
  discountType: z.enum(['PERCENTAGE', 'AMOUNT']).optional(),
  discountValue: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  cgstRate: z.coerce.number().min(0).max(100).default(0),
  sgstRate: z.coerce.number().min(0).max(100).default(0),
  igstRate: z.coerce.number().min(0).max(100).default(0),
  batchNumber: z.string().optional(),
  serialNumbers: z.array(z.string()).optional(),
  warehouseId: z.string().optional(),
  sortOrder: z.number().default(0),
});

export const CreateInvoiceDto = z.object({
  customerId: z.string().optional(),
  salesOrderId: z.string().optional(),
  invoiceType: z.enum(['GST_INVOICE', 'TAX_INVOICE', 'RETAIL_INVOICE', 'WHOLESALE_INVOICE', 'POS_INVOICE', 'PROFORMA_INVOICE']).default('GST_INVOICE'),
  invoiceDate: z.coerce.date().default(() => new Date()),
  dueDate: z.coerce.date().optional(),
  supplyDate: z.coerce.date().optional(),
  placeOfSupply: z.string().optional(),
  currency: z.string().default('INR'),
  exchangeRate: z.coerce.number().default(1),
  discountType: z.enum(['PERCENTAGE', 'AMOUNT']).optional(),
  discountValue: z.coerce.number().min(0).default(0),
  shippingCharges: z.coerce.number().min(0).default(0),
  roundOff: z.coerce.number().default(0),
  termsAndConditions: z.string().optional(),
  notes: z.string().optional(),
  billingAddress: z.any().optional(),
  shippingAddress: z.any().optional(),
  reverseCharge: z.boolean().default(false),
  isExport: z.boolean().default(false),
  exportType: z.string().optional(),
  couponId: z.string().optional(),
  templateId: z.string().optional(),
  autoConfirm: z.boolean().default(false),
  items: z.array(InvoiceItemSchema).min(1),
});

export const UpdateInvoiceDto = CreateInvoiceDto.partial();

export const InvoiceQueryDto = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'OVERDUE']).optional(),
  customerId: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  search: z.string().optional(),
  invoiceType: z.string().optional(),
  sortBy: z.enum(['invoiceDate', 'dueDate', 'totalAmount', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const SendInvoiceDto = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  channel: z.enum(['email', 'whatsapp', 'sms']),
  message: z.string().optional(),
});

export const RecordPaymentDto = z.object({
  amount: z.coerce.number().positive(),
  paymentDate: z.coerce.date().default(() => new Date()),
  mode: z.enum(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'WALLET', 'CREDIT', 'OTHER']),
  bankAccountId: z.string().optional(),
  referenceNumber: z.string().optional(),
  transactionId: z.string().optional(),
  upiId: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceDto>;
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceDto>;
export type InvoiceQueryInput = z.infer<typeof InvoiceQueryDto>;
export type SendInvoiceInput = z.infer<typeof SendInvoiceDto>;
export type RecordPaymentInput = z.infer<typeof RecordPaymentDto>;
