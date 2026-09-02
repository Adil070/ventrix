import { prisma } from '../../infrastructure/database';
import { NotFoundError, ConflictError, BadRequestError } from '../../shared/errors';
import type { CreateSupplierInput, UpdateSupplierInput, SupplierQueryInput } from './supplier.dto';
import { Prisma } from '@prisma/client';

export class SupplierService {
  async createSupplier(organizationId: string, input: CreateSupplierInput) {
    if (input.code) {
      const existing = await prisma.supplier.findFirst({ where: { organizationId, code: input.code } });
      if (existing) throw new ConflictError('Supplier code already exists');
    }
    return prisma.supplier.create({
      data: { 
        organizationId,
        name: input.name,
        code: input.code,
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
        altPhone: input.altPhone,
        gstin: input.gstin || null,
        pan: input.pan || null,
        openingBalance: input.openingBalance || 0,
        openingBalanceType: input.openingBalanceType || 'CREDIT',
        currency: input.currency || 'INR',
        paymentTerms: input.paymentTerms || 30,
        billingAddress: input.billingAddress as Prisma.InputJsonValue,
        shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
        bankDetails: input.bankDetails as Prisma.InputJsonValue,
        tags: input.tags ?? [],
        notes: input.notes,
      },
    });
  }

  async listSuppliers(organizationId: string, query: SupplierQueryInput) {
    const { page, limit, search, hasOutstanding, sortBy, sortOrder } = query;
    const where: Prisma.SupplierWhereInput = {
      organizationId, isActive: true,
      ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { gstin: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] }),
    };
    const [data, total] = await Promise.all([
      prisma.supplier.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.supplier.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getSupplier(organizationId: string, id: string) {
    const supplier = await prisma.supplier.findFirst({
      where: { id, organizationId },
      include: {
        purchases: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, purchaseNumber: true, totalAmount: true, balanceAmount: true, status: true, purchaseDate: true } },
      },
    });
    if (!supplier) throw new NotFoundError('Supplier not found');
    return supplier;
  }

  async updateSupplier(organizationId: string, id: string, input: UpdateSupplierInput) {
    const supplier = await prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    return prisma.supplier.update({ where: { id }, data: { ...input, billingAddress: input.billingAddress as Prisma.InputJsonValue, bankDetails: input.bankDetails as Prisma.InputJsonValue, gstin: input.gstin || null, pan: input.pan || null } });
  }

  async deleteSupplier(organizationId: string, id: string) {
    const supplier = await prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    const count = await prisma.purchase.count({ where: { supplierId: id, organizationId } });
    if (count > 0) throw new BadRequestError('Cannot delete supplier with existing purchases');
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return { message: 'Supplier deactivated successfully' };
  }

  async getSupplierLedger(organizationId: string, supplierId: string, fromDate?: string, toDate?: string) {
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    const purchases = await prisma.purchase.findMany({
      where: { supplierId, organizationId, ...(fromDate && { purchaseDate: { gte: new Date(fromDate) } }), ...(toDate && { purchaseDate: { lte: new Date(toDate) } }) },
      orderBy: { purchaseDate: 'asc' },
      select: { id: true, purchaseNumber: true, purchaseDate: true, totalAmount: true, paidAmount: true, balanceAmount: true, status: true },
    });
    return { supplier, purchases, summary: { totalPurchased: purchases.reduce((s, p) => s + Number(p.totalAmount), 0), totalPaid: purchases.reduce((s, p) => s + Number(p.paidAmount), 0), totalOutstanding: purchases.reduce((s, p) => s + Number(p.balanceAmount), 0) } };
  }
}

export const supplierService = new SupplierService();
