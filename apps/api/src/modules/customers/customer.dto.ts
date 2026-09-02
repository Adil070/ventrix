import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
  email: z.string().email().optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().or(z.literal('')),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional().or(z.literal('')),
  customerType: z.enum(['RETAIL', 'WHOLESALE', 'B2B', 'B2C', 'EXPORT']).optional(),
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
  creditLimit: z.number().min(0).default(0),
  creditDays: z.number().min(0).max(365).default(30),
  openingBalance: z.number().default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('DEBIT'),
  priceListId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  bankDetails: z.object({
    accountName: z.string().optional(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifsc: z.string().optional(),
    branch: z.string().optional(),
  }).optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export const CustomerQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(20),
  search: z.string().optional(),
  tags: z.string().optional(),
  hasOutstanding: z.coerce.boolean().optional(),
  sortBy: z.enum(['name', 'createdAt', 'outstandingAmount']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type CustomerQueryInput = z.infer<typeof CustomerQuerySchema>;
