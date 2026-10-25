import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { paymentModeLabel } from '@/lib/business';
import type { PaperSize } from '@/lib/printing';

/**
 * The printed bill. Plain black-on-white HTML styled by PRINT_CSS (no Tailwind, no dark mode), so it looks
 * the same on a thermal receipt printer and an A4 printer. Thermal printers print about 72 mm (80 mm paper)
 * or 48 mm (58 mm paper) wide; the printer driver turns this into pixels, so ₹ and Indian-language names
 * print without any printer fonts.
 */

const num = (v: unknown) => Number(v || 0);

export const PRINT_CSS = `
  html, body { margin: 0; padding: 0; background: #fff !important; color: #000 !important; }
  .vx-bill { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; box-sizing: border-box; line-height: 1.35; }
  .vx-bill * { box-sizing: border-box; }
  .vx-80 { width: 72mm; padding: 2mm 1mm; font-size: 12px; }
  .vx-58 { width: 48mm; padding: 1mm 0.5mm; font-size: 10.5px; }
  .vx-a4 { width: 190mm; padding: 10mm; font-size: 13px; }
  .vx-center { text-align: center; }
  .vx-right { text-align: right; }
  .vx-bold { font-weight: 700; }
  .vx-name { font-size: 1.35em; font-weight: 700; }
  .vx-title { font-weight: 700; letter-spacing: 1px; margin-top: 1.5mm; }
  .vx-muted { font-size: 0.9em; }
  .vx-rule { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
  .vx-row { display: flex; justify-content: space-between; gap: 2mm; }
  .vx-row > span:last-child { text-align: right; white-space: nowrap; }
  .vx-item { margin-bottom: 1mm; }
  .vx-total { font-size: 1.3em; font-weight: 700; }
  .vx-table { width: 100%; border-collapse: collapse; }
  .vx-table th, .vx-table td { padding: 0.6mm 0.5mm; text-align: right; }
  .vx-table th:first-child, .vx-table td:first-child { text-align: left; }
  .vx-a4 .vx-table th { border-bottom: 1px solid #000; }
  .vx-a4 .vx-table td { border-bottom: 1px solid #ddd; }
`;

interface Props {
  invoice: any;
  org: any;
  paper: PaperSize;
}

export function InvoicePrint({ invoice, org, paper }: Props) {
  const items: any[] = invoice.items || [];
  const payments: any[] = invoice.payments || [];
  const total = num(invoice.totalAmount);
  const paid = num(invoice.paidAmount);
  const balance = num(invoice.balanceAmount ?? total - paid);
  const hasTax = num(invoice.taxAmount) > 0;
  const igst = num(invoice.igstAmount) > 0;
  const a = org?.address || {};
  const address = [a.line1, [a.city, a.state].filter(Boolean).join(', '), a.pincode].filter(Boolean).join(', ');
  const customerName = invoice.customer?.name || 'Walk-in customer';
  const itemName = (it: any) => it.product?.name || it.description || 'Item';

  // GST summary by rate, as Indian bills show it.
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const it of items) {
    const rate = num(it.taxRate);
    const r = byRate.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += num(it.taxableAmount);
    r.cgst += num(it.cgstAmount);
    r.sgst += num(it.sgstAmount);
    r.igst += num(it.igstAmount);
    byRate.set(rate, r);
  }
  const rates = Array.from(byRate.entries()).filter(([rate]) => rate > 0).sort(([x], [y]) => x - y);

  const header = (
    <div className="vx-center">
      <div className="vx-name">{org?.name}</div>
      {address && <div className="vx-muted">{address}</div>}
      {org?.phone && <div className="vx-muted">Ph: {org.phone}</div>}
      {org?.gstin && <div className="vx-muted">GSTIN: {org.gstin}</div>}
      <div className="vx-title">{org?.gstin ? 'TAX INVOICE' : 'BILL'}</div>
    </div>
  );

  const meta = (
    <>
      <div className="vx-row"><span>Bill No: <b>{invoice.invoiceNumber}</b></span><span>{formatDate(invoice.invoiceDate)}</span></div>
      {invoice.createdAt && paper !== 'A4' && <div className="vx-muted">{formatDateTime(invoice.createdAt)}</div>}
      <div>To: <b>{customerName}</b>{invoice.customer?.mobile ? ` · ${invoice.customer.mobile}` : ''}</div>
      {invoice.customer?.gstin && <div className="vx-muted">Customer GSTIN: {invoice.customer.gstin}</div>}
    </>
  );

  const totals = (
    <>
      {num(invoice.discountAmount) > 0 && <div className="vx-row"><span>Discount</span><span>-{formatCurrency(invoice.discountAmount)}</span></div>}
      {hasTax && <div className="vx-row"><span>Taxable value</span><span>{formatCurrency(invoice.taxableAmount)}</span></div>}
      {num(invoice.cgstAmount) > 0 && <div className="vx-row"><span>CGST</span><span>{formatCurrency(invoice.cgstAmount)}</span></div>}
      {num(invoice.sgstAmount) > 0 && <div className="vx-row"><span>SGST</span><span>{formatCurrency(invoice.sgstAmount)}</span></div>}
      {igst && <div className="vx-row"><span>IGST</span><span>{formatCurrency(invoice.igstAmount)}</span></div>}
      {num(invoice.shippingCharges) > 0 && <div className="vx-row"><span>Shipping</span><span>{formatCurrency(invoice.shippingCharges)}</span></div>}
      {num(invoice.roundOff) !== 0 && <div className="vx-row"><span>Round off</span><span>{formatCurrency(invoice.roundOff)}</span></div>}
      <hr className="vx-rule" />
      <div className="vx-row vx-total"><span>TOTAL</span><span>{formatCurrency(total)}</span></div>
      {paid > 0 && <div className="vx-row"><span>Paid</span><span>{formatCurrency(paid)}</span></div>}
      {balance > 0 && <div className="vx-row vx-bold"><span>Balance due</span><span>{formatCurrency(balance)}</span></div>}
      {payments.length > 0 && (
        <div className="vx-muted">Paid by {Array.from(new Set(payments.map(p => paymentModeLabel(p.mode)))).join(', ')}</div>
      )}
    </>
  );

  const gstSummary = rates.length > 0 && (
    <>
      <hr className="vx-rule" />
      <table className="vx-table vx-muted">
        <thead>
          <tr><th>GST</th><th>Taxable</th>{igst ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}</tr>
        </thead>
        <tbody>
          {rates.map(([rate, r]) => (
            <tr key={rate}>
              <td>{rate}%</td>
              <td>{r.taxable.toFixed(2)}</td>
              {igst ? <td>{r.igst.toFixed(2)}</td> : <><td>{r.cgst.toFixed(2)}</td><td>{r.sgst.toFixed(2)}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const footer = (
    <div className="vx-center vx-muted">
      {invoice.notes && <div>{invoice.notes}</div>}
      {invoice.termsAndConditions && <div>{invoice.termsAndConditions}</div>}
      <div>Thank you! Visit again.</div>
      <div>This is a computer generated bill.</div>
    </div>
  );

  if (paper === 'A4') {
    return (
      <div className="vx-bill vx-a4">
        {header}
        <hr className="vx-rule" />
        {meta}
        <hr className="vx-rule" />
        <table className="vx-table">
          <thead>
            <tr><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id ?? i}>
                <td>{itemName(it)}</td>
                <td>{it.hsnCode || '-'}</td>
                <td>{num(it.quantity)}</td>
                <td>{formatCurrency(it.unitPrice)}</td>
                <td>{num(it.taxRate)}%</td>
                <td>{formatCurrency(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ width: '80mm', marginLeft: 'auto', marginTop: '4mm' }}>{totals}</div>
        {gstSummary}
        <hr className="vx-rule" />
        {footer}
      </div>
    );
  }

  return (
    <div className={`vx-bill ${paper === '58mm' ? 'vx-58' : 'vx-80'}`}>
      {header}
      <hr className="vx-rule" />
      {meta}
      <hr className="vx-rule" />
      {items.map((it, i) => (
        <div key={it.id ?? i} className="vx-item">
          <div className="vx-bold">{itemName(it)}</div>
          <div className="vx-row">
            <span>{num(it.quantity)} x {formatCurrency(it.unitPrice)}{num(it.discountAmount) > 0 ? ` (-${formatCurrency(it.discountAmount)})` : ''}</span>
            <span>{formatCurrency(it.amount)}</span>
          </div>
          {(it.hsnCode || num(it.taxRate) > 0) && (
            <div className="vx-muted">{[it.hsnCode && `HSN ${it.hsnCode}`, num(it.taxRate) > 0 && `GST ${num(it.taxRate)}%`].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      ))}
      <div className="vx-muted">{items.length} item{items.length === 1 ? '' : 's'} · Qty {items.reduce((s, it) => s + num(it.quantity), 0)}</div>
      <hr className="vx-rule" />
      {totals}
      {gstSummary}
      <hr className="vx-rule" />
      {footer}
    </div>
  );
}

/** Demo bill for the "Print test receipt" button in Settings → Printing. */
export const SAMPLE_INVOICE = {
  invoiceNumber: 'TEST-0001',
  invoiceDate: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  customer: { name: 'Test customer' },
  items: [
    { id: '1', description: 'Basmati Rice 5kg', hsnCode: '1006', quantity: 2, unitPrice: 650, taxRate: 5, taxableAmount: 1300, cgstAmount: 32.5, sgstAmount: 32.5, igstAmount: 0, discountAmount: 0, amount: 1365 },
    { id: '2', description: 'Notebook A5 (pack of 6)', hsnCode: '4820', quantity: 1, unitPrice: 240, taxRate: 12, taxableAmount: 240, cgstAmount: 14.4, sgstAmount: 14.4, igstAmount: 0, discountAmount: 0, amount: 268.8 },
  ],
  taxableAmount: 1540, cgstAmount: 46.9, sgstAmount: 46.9, igstAmount: 0, taxAmount: 93.8,
  discountAmount: 0, roundOff: 0.2, totalAmount: 1634, paidAmount: 1634, balanceAmount: 0,
  payments: [{ mode: 'UPI' }],
};
