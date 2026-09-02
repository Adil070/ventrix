import { prisma } from '../../infrastructure/database';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

export const RecordPaymentSchema = z.object({
  type: z.enum(['RECEIPT', 'PAYMENT']), // RECEIPT = customer paying us, PAYMENT = us paying supplier
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  invoiceId: z.string().optional(),
  purchaseId: z.string().optional(),
  amount: z.number().positive(),
  paymentMode: z.enum(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'WALLET', 'CREDIT']),
  paymentDate: z.coerce.date(),
  bankAccountId: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  allocations: z.array(z.object({ invoiceId: z.string().optional(), purchaseId: z.string().optional(), amount: z.number().positive() })).optional(),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export class PaymentService {
  async recordPayment(organizationId: string, userId: string, input: RecordPaymentInput) {
    const count = await prisma.payment.count({ where: { organizationId } });
    const paymentNumber = `PAY-${String(count + 1).padStart(5, '0')}`;

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          organizationId, paymentNumber, type: input.type, customerId: input.customerId,
          supplierId: input.supplierId, amount: input.amount, mode: input.paymentMode as any,
          paymentDate: input.paymentDate, bankAccountId: input.bankAccountId,
          referenceNumber: input.referenceNumber, notes: input.notes, status: 'COMPLETED',
          createdBy: userId,
        },
      });

      // Handle allocations
      if (input.allocations?.length) {
        for (const alloc of input.allocations) {
          if (alloc.invoiceId) {
            const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
            if (inv) {
              const newPaid = Number(inv.paidAmount) + alloc.amount;
              const newBalance = Number(inv.totalAmount) - newPaid;
              const status = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';
              await tx.invoice.update({ where: { id: alloc.invoiceId }, data: { paidAmount: newPaid, balanceAmount: Math.max(0, newBalance), status } });
            }
          }
          if (alloc.purchaseId) {
            const pur = await tx.purchase.findUnique({ where: { id: alloc.purchaseId } });
            if (pur) {
              const newPaid = Number(pur.paidAmount) + alloc.amount;
              const newBalance = Number(pur.totalAmount) - newPaid;
              await tx.purchase.update({ where: { id: alloc.purchaseId }, data: { paidAmount: newPaid, balanceAmount: Math.max(0, newBalance), status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID' as any } });
            }
          }
        }
      } else if (input.invoiceId) {
        const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
        if (inv) {
          const newPaid = Number(inv.paidAmount) + input.amount;
          const newBalance = Number(inv.totalAmount) - newPaid;
          await tx.invoice.update({ where: { id: input.invoiceId }, data: { paidAmount: newPaid, balanceAmount: Math.max(0, newBalance), status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID' } });
        }
      }

      return p;
    });

    return payment;
  }

  async listPayments(organizationId: string, query: { page?: number; limit?: number; type?: string; customerId?: string; supplierId?: string; fromDate?: string; toDate?: string }) {
    const { page = 1, limit = 20, type, customerId, supplierId, fromDate, toDate } = query;
    const where: Prisma.PaymentWhereInput = {
      organizationId,
      ...(type && { type: type as any }),
      ...(customerId && { customerId }),
      ...(supplierId && { supplierId }),
      ...(fromDate && { paymentDate: { gte: new Date(fromDate) } }),
      ...(toDate && { paymentDate: { lte: new Date(toDate) } }),
    };
    const [data, total] = await Promise.all([
      prisma.payment.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { paymentDate: 'desc' }, include: { customer: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } }),
      prisma.payment.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getPayment(organizationId: string, id: string) {
    const payment = await prisma.payment.findFirst({ where: { id, organizationId }, include: { customer: true, supplier: true } });
    if (!payment) throw new NotFoundError('Payment not found');
    return payment;
  }
}

export const paymentService = new PaymentService();
