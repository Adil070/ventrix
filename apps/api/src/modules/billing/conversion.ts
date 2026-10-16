import { prisma } from '../../infrastructure/database';
import { BadRequestError } from '../../shared/errors';
import { roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { CreateInvoiceDto, type CreateInvoiceInput } from './invoice.dto';

/** A quotation / sales-order line as stored (Decimal fields come back as Prisma.Decimal). */
interface SourceLine {
  productId: string | null;
  variantId?: string | null;
  description: string | null;
  quantity: unknown;
  unit?: string | null;
  unitPrice: unknown;
  discount?: unknown; // percentage
  taxRate?: unknown;
  cgstRate?: unknown;
  sgstRate?: unknown;
  igstRate?: unknown;
  sortOrder?: number | null;
}

interface SourceDocument {
  customerId: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  discountAmount?: unknown;
  notes?: string | null;
  terms?: string | null;
}

/**
 * Builds the CreateInvoiceDto payload for converting a quotation / sales order, so the invoice goes through
 * invoiceService.createInvoice like any other. Lines carry only a total GST rate, which is split
 * intra-state (CGST = SGST = rate / 2) unless the line already stores its own CGST/SGST/IGST rates.
 * `lineQuantities` (sales orders) invoices only what is still open on each line; the document-level
 * discount is then applied pro rata to the share of the order value being invoiced.
 */
export async function buildInvoiceInputFromSource(
  organizationId: string,
  doc: SourceDocument,
  lines: SourceLine[],
  extras: { salesOrderId?: string; lineQuantities?: number[]; reference: string },
): Promise<CreateInvoiceInput> {
  const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, organizationId },
        select: { id: true, name: true, hsnCode: true, sacCode: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  if (byId.size !== productIds.length) {
    throw new BadRequestError(`${extras.reference} references products that no longer exist`);
  }

  let fullValue = 0;
  let invoicedValue = 0;
  const items: any[] = [];
  lines.forEach((line, idx) => {
    const ordered = toDecimal(line.quantity);
    const quantity = extras.lineQuantities ? extras.lineQuantities[idx] : ordered;
    const unitPrice = toDecimal(line.unitPrice);
    const discount = toDecimal(line.discount);
    const lineValue = (q: number) => q * unitPrice * (1 - discount / 100);
    fullValue += lineValue(ordered);
    if (quantity <= 0) return;
    invoicedValue += lineValue(quantity);

    const taxRate = toDecimal(line.taxRate);
    const hasSplit = [line.cgstRate, line.sgstRate, line.igstRate].some((r) => toDecimal(r) > 0);
    const product = line.productId ? byId.get(line.productId) : undefined;
    items.push({
      productId: line.productId || undefined,
      variantId: line.variantId || undefined,
      description: line.description?.trim() || product?.name || 'Item',
      hsnCode: product?.hsnCode || undefined,
      sacCode: product?.sacCode || undefined,
      quantity,
      unit: line.unit || undefined,
      unitPrice,
      discountType: discount > 0 ? 'PERCENTAGE' : undefined,
      discountValue: discount,
      taxRate,
      cgstRate: hasSplit ? toDecimal(line.cgstRate) : taxRate / 2,
      sgstRate: hasSplit ? toDecimal(line.sgstRate) : taxRate / 2,
      igstRate: hasSplit ? toDecimal(line.igstRate) : 0,
      sortOrder: line.sortOrder ?? idx,
    });
  });

  if (!items.length) throw new BadRequestError(`${extras.reference} has nothing left to invoice`);

  const docDiscount = toDecimal(doc.discountAmount);
  const discountValue = docDiscount > 0 && fullValue > 0 ? roundTo((docDiscount * invoicedValue) / fullValue) : 0;

  return CreateInvoiceDto.parse({
    customerId: doc.customerId || undefined,
    salesOrderId: extras.salesOrderId,
    invoiceType: 'GST_INVOICE',
    invoiceDate: new Date(),
    currency: doc.currency || undefined,
    exchangeRate: doc.exchangeRate != null ? toDecimal(doc.exchangeRate) : undefined,
    discountType: discountValue > 0 ? 'AMOUNT' : undefined,
    discountValue,
    notes: doc.notes || undefined,
    termsAndConditions: doc.terms || undefined,
    autoConfirm: true,
    items,
  });
}
