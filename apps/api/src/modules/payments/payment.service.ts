import { prisma } from '../../infrastructure/database';
import { nextSequenceNumber } from '../../shared/helpers/sequence';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { AccountingEngine } from '../accounting/accounting.engine';

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

const accountingEngine = new AccountingEngine();

/** Next sequential payment number for an organisation (PAY-00001 …). */
export async function nextPaymentNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
  // Same locked sequence billing uses for invoice payments, so both paths share one PAY- series.
  return nextSequenceNumber(tx, organizationId, 'payment', 'PAY-', 5);
}

/** Payments belonging to an org. Payments recorded on an invoice by billing may lack organizationId, so match via the invoice too. */
export function paymentOrgScope(organizationId: string): Prisma.PaymentWhereInput {
  return {
    OR: [
      { organizationId },
      { organizationId: null, invoice: { organizationId } },
      { organizationId: null, purchase: { organizationId } },
    ],
  };
}

export class PaymentService {
  /**
   * Record a standalone receipt (customer → us) or payment (us → supplier), optionally allocated to
   * invoices / purchases of the same organisation. Posts its own journal entry:
   *   RECEIPT: Dr Cash/Bank, Cr Accounts Receivable   PAYMENT: Dr Accounts Payable, Cr Cash/Bank
   * (Invoice payments made through POST /invoices/:id/payments are posted by billing, not here.)
   */
  async recordPayment(organizationId: string, userId: string, input: RecordPaymentInput) {
    const isReceipt = input.type === 'RECEIPT';
    const allocations = input.allocations?.length
      ? input.allocations
      : input.invoiceId || input.purchaseId
        ? [{ invoiceId: input.invoiceId, purchaseId: input.purchaseId, amount: input.amount }]
        : [];

    for (const a of allocations) {
      if (!!a.invoiceId === !!a.purchaseId) throw new BadRequestError('Each allocation must reference exactly one invoice or purchase');
      if (isReceipt && a.purchaseId) throw new BadRequestError('A RECEIPT can only be allocated to invoices');
      if (!isReceipt && a.invoiceId) throw new BadRequestError('A PAYMENT can only be allocated to purchases');
    }
    const allocated = roundTo(allocations.reduce((s, a) => s + a.amount, 0));
    if (allocated - input.amount > 0.005) {
      throw new BadRequestError(`Allocated amount (${allocated}) exceeds the payment amount (${input.amount})`);
    }

    // Referenced parties must belong to this organisation.
    if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId }, select: { id: true } }))) {
      throw new NotFoundError('Customer');
    }
    if (input.supplierId && !(await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true } }))) {
      throw new NotFoundError('Supplier');
    }
    if (input.bankAccountId && !(await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId }, select: { id: true } }))) {
      throw new NotFoundError('Bank account');
    }

    const payment = await prisma.$transaction(async (tx) => {
      // Validate and apply allocations (all scoped to this organisation).
      let customerId = input.customerId;
      let supplierId = input.supplierId;
      let singleInvoice: any = null;
      let singlePurchase: any = null;

      for (const alloc of allocations) {
        if (alloc.invoiceId) {
          const inv = await tx.invoice.findFirst({ where: { id: alloc.invoiceId, organizationId } });
          if (!inv) throw new NotFoundError('Invoice', alloc.invoiceId);
          if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') throw new BadRequestError(`Invoice ${inv.invoiceNumber} is ${inv.status.toLowerCase()} and cannot receive payments`);
          if (alloc.amount - toDecimal(inv.balanceAmount) > 0.005) throw new BadRequestError(`Allocation ${alloc.amount} exceeds the balance due on ${inv.invoiceNumber} (${toDecimal(inv.balanceAmount)})`);
          if (customerId && inv.customerId && inv.customerId !== customerId) throw new BadRequestError(`Invoice ${inv.invoiceNumber} belongs to a different customer`);
          customerId = customerId ?? inv.customerId ?? undefined;
          singleInvoice = allocations.length === 1 ? inv : null;
          const newPaid = roundTo(toDecimal(inv.paidAmount) + alloc.amount);
          const newBalance = roundTo(toDecimal(inv.totalAmount) - newPaid);
          await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, balanceAmount: Math.max(0, newBalance), status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID' } });
        }
        if (alloc.purchaseId) {
          const pur = await tx.purchase.findFirst({ where: { id: alloc.purchaseId, organizationId } });
          if (!pur) throw new NotFoundError('Purchase', alloc.purchaseId);
          if (pur.status === 'CANCELLED' || pur.status === 'DRAFT') throw new BadRequestError(`Purchase ${pur.purchaseNumber} is ${pur.status.toLowerCase()} and cannot be paid`);
          if (alloc.amount - toDecimal(pur.balanceAmount) > 0.005) throw new BadRequestError(`Allocation ${alloc.amount} exceeds the balance due on ${pur.purchaseNumber} (${toDecimal(pur.balanceAmount)})`);
          if (supplierId && pur.supplierId && pur.supplierId !== supplierId) throw new BadRequestError(`Purchase ${pur.purchaseNumber} belongs to a different supplier`);
          supplierId = supplierId ?? pur.supplierId ?? undefined;
          singlePurchase = allocations.length === 1 ? pur : null;
          const newPaid = roundTo(toDecimal(pur.paidAmount) + alloc.amount);
          const newBalance = roundTo(toDecimal(pur.totalAmount) - newPaid);
          // Purchase status tracks goods receipt (PurchaseOrderStatus has no PAID value); paid state is the balance.
          await tx.purchase.update({ where: { id: pur.id }, data: { paidAmount: newPaid, balanceAmount: Math.max(0, newBalance) } });
        }
      }

      const p = await tx.payment.create({
        data: {
          organizationId, paymentNumber: await nextPaymentNumber(tx, organizationId), type: input.type,
          customerId: isReceipt ? customerId : undefined, supplierId: isReceipt ? undefined : supplierId,
          invoiceId: singleInvoice?.id, purchaseId: singlePurchase?.id,
          amount: input.amount, mode: input.paymentMode as any,
          paymentDate: input.paymentDate, bankAccountId: input.bankAccountId,
          referenceNumber: input.referenceNumber, notes: input.notes, status: 'COMPLETED',
          createdBy: userId,
        },
      });

      if (isReceipt) await accountingEngine.postReceiptEntry(tx, p, singleInvoice, organizationId);
      else await accountingEngine.postPaymentEntry(tx, p, singlePurchase, organizationId);

      return p;
    });

    return payment;
  }

  async listPayments(organizationId: string, query: { page?: number; limit?: number; type?: string; customerId?: string; supplierId?: string; fromDate?: string; toDate?: string }) {
    const { page = 1, limit = 20, type, customerId, supplierId, fromDate, toDate } = query;
    const where: Prisma.PaymentWhereInput = {
      ...paymentOrgScope(organizationId),
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
    const payment = await prisma.payment.findFirst({ where: { id, ...paymentOrgScope(organizationId) }, include: { customer: true, supplier: true } });
    if (!payment) throw new NotFoundError('Payment not found');
    return payment;
  }
}

export const paymentService = new PaymentService();
