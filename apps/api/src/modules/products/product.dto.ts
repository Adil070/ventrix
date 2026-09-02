import { z } from 'zod';

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(300),
  sku: z.string().max(100).optional(),
  barcode: z.string().optional(),
  hsnCode: z.string().optional(),
  sacCode: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  unitId: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE', 'COMPOSITE']).default('PRODUCT'),
  taxRateId: z.string().optional(),
  taxRate: z.number().min(0).max(100).default(18),
  sellingPrice: z.number().min(0).default(0),
  purchasePrice: z.number().min(0).default(0),
  mrp: z.number().min(0).optional(),
  minimumSellingPrice: z.number().min(0).optional(),
  openingStock: z.number().default(0),
  reorderLevel: z.number().min(0).optional(),
  maxStockLevel: z.number().min(0).optional(),
  warehouseId: z.string().optional(),
  valuationMethod: z.enum(['FIFO', 'LIFO', 'WEIGHTED_AVERAGE']).default('WEIGHTED_AVERAGE'),
  trackInventory: z.boolean().default(true),
  hasBatches: z.boolean().default(false),
  hasSerialNumbers: z.boolean().default(false),
  hasVariants: z.boolean().default(false),
  imageUrls: z.array(z.string()).optional(),
  attributes: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export const ProductQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(20),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE', 'COMPOSITE']).optional(),
  lowStock: z.coerce.boolean().optional(),
  sortBy: z.enum(['name', 'createdAt', 'sellingPrice', 'currentStock']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
  description: z.string().optional(),
});

export const CreateUnitSchema = z.object({
  name: z.string().min(1),
  abbreviation: z.string().min(1).max(10),
});

export const CreateBrandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
export type ProductQueryInput = z.infer<typeof ProductQuerySchema>;
