import { prisma } from '../../infrastructure/database';
import { cache } from '../../infrastructure/cache';
import { NotFoundError, ConflictError, BadRequestError } from '../../shared/errors';
import type { CreateCustomerInput, UpdateCustomerInput, CustomerQueryInput } from './customer.dto';
import { Prisma } from '@prisma/client';

export class CustomerService {
  // ─── Create Customer ──────────────────────────────────────────────────────────
  async createCustomer(organizationId: string, input: CreateCustomerInput) {
    if (input.code) {
      const existing = await prisma.customer.findUnique({
        where: { organizationId_code: { organizationId, code: input.code } },
      });
      if (existing) throw new ConflictError('Customer code already exists');
    }

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: input.name,
        code: input.code,
        phone: (input as any).mobile ?? (input as any).phone,
        email: input.email,
        gstin: input.gstin || null,
        pan: input.pan || null,
        billingAddress: input.billingAddress as Prisma.InputJsonValue,
        shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
        creditLimit: input.creditLimit,
        creditDays: input.creditDays,
        openingBalance: input.openingBalance,
        openingBalanceType: input.openingBalanceType as any,
        priceListId: input.priceListId,
        tags: input.tags ?? [],
        notes: input.notes,
      },
    });

    await cache.del(`customers:${organizationId}:*`);
    return customer;
  }

  // ─── List Customers ───────────────────────────────────────────────────────────
  async listCustomers(organizationId: string, query: CustomerQueryInput) {
    const { page, limit, search, tags, hasOutstanding, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      isActive: true,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { gstin: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(tags && { tags: { hasSome: tags.split(',') } }),
    };

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { priceList: { select: { id: true, name: true } } },
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Get Customer ─────────────────────────────────────────────────────────────
  async getCustomer(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: {
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, invoiceNumber: true, totalAmount: true, balanceAmount: true, status: true, invoiceDate: true },
        },
        priceList: true,
      },
    });
    if (!customer) throw new NotFoundError('Customer not found');
    return customer;
  }

  // ─── Update Customer ──────────────────────────────────────────────────────────
  async updateCustomer(organizationId: string, customerId: string, input: UpdateCustomerInput) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundError('Customer not found');

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: {
        ...input,
        billingAddress: input.billingAddress as Prisma.InputJsonValue,
        shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
        gstin: input.gstin || null,
        pan: input.pan || null,
      } as any,
    });

    return updated;
  }

  // ─── Delete Customer ──────────────────────────────────────────────────────────
  async deleteCustomer(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundError('Customer not found');

    const invoiceCount = await prisma.invoice.count({ where: { customerId, organizationId } });
    if (invoiceCount > 0) throw new BadRequestError('Cannot delete customer with existing invoices');

    await prisma.customer.update({ where: { id: customerId }, data: { isActive: false } });
    return { message: 'Customer deactivated successfully' };
  }

  // ─── Customer Ledger ──────────────────────────────────────────────────────────
  async getCustomerLedger(organizationId: string, customerId: string, fromDate?: string, toDate?: string) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundError('Customer not found');

    const where: Prisma.InvoiceWhereInput = {
      customerId,
      organizationId,
      ...(fromDate && { invoiceDate: { gte: new Date(fromDate) } }),
      ...(toDate && { invoiceDate: { lte: new Date(toDate) } }),
    };

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
      },
    });

    const payments = await prisma.payment.findMany({
      where: { customerId, organizationId },
      orderBy: { paymentDate: 'asc' },
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        amount: true,
        mode: true,
        notes: true,
      },
    });

    return {
      customer,
      invoices,
      payments,
      summary: {
        totalInvoiced: invoices.reduce((s, i) => s + Number(i.totalAmount), 0),
        totalPaid: invoices.reduce((s, i) => s + Number(i.paidAmount), 0),
        totalOutstanding: invoices.reduce((s, i) => s + Number(i.balanceAmount), 0),
      },
    };
  }

  // ─── Customer Statement ───────────────────────────────────────────────────────
  async getCustomerStatement(organizationId: string, customerId: string, fromDate: string, toDate: string) {
    return this.getCustomerLedger(organizationId, customerId, fromDate, toDate);
  }
}

export const customerService = new CustomerService();
