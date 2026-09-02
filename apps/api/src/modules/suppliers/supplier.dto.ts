import { z } from 'zod';

export const CreateSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  billingAddress: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    stateCode: z.string().optional(),
    pincode: z.string().optional(),
    country: z.string().default('India'),
  }).optional(),
  shippingAddress: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    stateCode: z.string().optional(),
    pincode: z.string().optional(),
    country: z.string().default('India'),
  }).optional(),
  openingBalance: z.number().default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('CREDIT'),
  currency: z.string().default('INR'),
  paymentTerms: z.number().min(0).default(30),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  bankDetails: z.object({
    accountName: z.string().optional(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifsc: z.string().optional(),
  }).optional(),
});

export const UpdateSupplierSchema = CreateSupplierSchema.partial();

export const SupplierQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(20),
  search: z.string().optional(),
  hasOutstanding: z.coerce.boolean().optional(),
  sortBy: z.enum(['name', 'createdAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
export type SupplierQueryInput = z.infer<typeof SupplierQuerySchema>;
