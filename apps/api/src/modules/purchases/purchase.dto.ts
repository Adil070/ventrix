import { z } from 'zod';

export const CreatePurchaseItemSchema = z.object({
  productId: z.string(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unitId: z.string().optional(),
  unitPrice: z.number().min(0),
  discountType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
  discountValue: z.number().min(0).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  hsnCode: z.string().optional(),
  warehouseId: z.string().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const CreatePurchaseSchema = z.object({
  supplierId: z.string(),
  purchaseOrderId: z.string().optional(),
  purchaseDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  billNumber: z.string().optional(),
  items: z.array(CreatePurchaseItemSchema).min(1),
  discountType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
  discountValue: z.number().min(0).default(0),
  shippingCharges: z.number().min(0).default(0),
  roundOff: z.number().default(0),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  billingAddress: z.record(z.string()).optional(),
  paymentMode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CARD', 'CREDIT']).optional(),
  amountPaid: z.number().min(0).default(0),
  reverseCharge: z.boolean().default(false),
  branchId: z.string().optional(),
});

export const UpdatePurchaseSchema = CreatePurchaseSchema.partial();

export const PurchaseQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(20),
  search: z.string().optional(),
  supplierId: z.string().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sortBy: z.enum(['purchaseDate', 'createdAt', 'totalAmount']).default('purchaseDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof UpdatePurchaseSchema>;
export type PurchaseQueryInput = z.infer<typeof PurchaseQuerySchema>;
