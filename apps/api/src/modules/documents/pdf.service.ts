import PDFDocument from 'pdfkit';

interface InvoiceForPDF {
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate?: Date | string | null;
  status: string;
  customer?: { name: string; email?: string | null; phone?: string | null; gstin?: string | null; billingAddress?: any } | null;
  organization?: { name: string; gstin?: string | null; address?: any; phone?: string | null; email?: string | null } | null;
  items?: Array<{
    description: string;
    quantity: number | any;
    unitPrice: number | any;
    taxRate?: number | any;
    taxAmount?: number | any;
    amount: number | any;
    hsnCode?: string | null;
  }>;
  subtotal: number | any;
  discountAmount?: number | any;
  taxAmount?: number | any;
  cgstAmount?: number | any;
  sgstAmount?: number | any;
  igstAmount?: number | any;
  totalAmount: number | any;
  paidAmount?: number | any;
  balanceAmount?: number | any;
  termsAndConditions?: string | null;
  notes?: string | null;
  placeOfSupply?: string | null;
}

export class PDFService {
  async generateInvoicePDF(invoice: InvoiceForPDF): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const orange = '#f97316';
      const dark = '#111827';
      const gray = '#6b7280';
      const lightGray = '#f3f4f6';
      const pageWidth = doc.page.width - 80;

      // ── Header ──────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 90).fill(orange);
      doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
        .text(invoice.organization?.name ?? 'Company Name', 40, 25, { width: pageWidth / 2 });

      doc.fontSize(9).font('Helvetica').fillColor('white')
        .text(`GSTIN: ${invoice.organization?.gstin ?? ''}`, 40, 52)
        .text(invoice.organization?.phone ?? '', 40, 65)
        .text(invoice.organization?.email ?? '', 40, 78);

      // Invoice label
      doc.fontSize(20).font('Helvetica-Bold').fillColor('white')
        .text('TAX INVOICE', 400, 30, { align: 'right', width: pageWidth / 2 });
      doc.fontSize(9).font('Helvetica').fillColor('white')
        .text(`#${invoice.invoiceNumber}`, 400, 56, { align: 'right', width: pageWidth / 2 });

      doc.fillColor(dark);

      // ── Invoice Info + Bill To ─────────────────────────────────────
      const infoY = 105;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(gray)
        .text('INVOICE DATE', 40, infoY)
        .text('DUE DATE', 160, infoY)
        .text('PLACE OF SUPPLY', 280, infoY)
        .text('STATUS', 430, infoY);

      const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-IN') : '';
      const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN') : 'N/A';

      doc.fontSize(9).font('Helvetica').fillColor(dark)
        .text(invoiceDate, 40, infoY + 12)
        .text(dueDate, 160, infoY + 12)
        .text(invoice.placeOfSupply ?? '', 280, infoY + 12)
        .text(invoice.status, 430, infoY + 12);

      // Bill To
      const billY = 145;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(gray).text('BILL TO', 40, billY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(dark)
        .text(invoice.customer?.name ?? 'Walk-in Customer', 40, billY + 12);

      const addr = invoice.customer?.billingAddress as any;
      if (addr) {
        const addrLine = [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
        doc.fontSize(8).font('Helvetica').fillColor(gray).text(addrLine, 40, billY + 24);
      }
      if (invoice.customer?.gstin) {
        doc.fontSize(8).font('Helvetica').fillColor(gray).text(`GSTIN: ${invoice.customer.gstin}`, 40, billY + 36);
      }

      // ── Line separator ─────────────────────────────────────────────
      const tableY = 210;
      doc.moveTo(40, tableY - 5).lineTo(40 + pageWidth, tableY - 5).stroke(orange);

      // ── Table Header ──────────────────────────────────────────────
      doc.rect(40, tableY, pageWidth, 20).fill(lightGray);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(dark);

      const cols = { desc: 40, hsn: 240, qty: 300, rate: 360, tax: 420, amount: 480 };

      doc.text('#', cols.desc, tableY + 6).text('Item & Description', cols.desc + 15, tableY + 6)
        .text('HSN', cols.hsn, tableY + 6)
        .text('Qty', cols.qty, tableY + 6)
        .text('Rate', cols.rate, tableY + 6)
        .text('Tax', cols.tax, tableY + 6)
        .text('Amount', cols.amount, tableY + 6);

      // ── Table Rows ────────────────────────────────────────────────
      let rowY = tableY + 24;
      const items = invoice.items ?? [];

      items.forEach((item, idx) => {
        if (rowY > 680) {
          doc.addPage();
          rowY = 40;
        }
        const isEven = idx % 2 === 0;
        if (isEven) doc.rect(40, rowY - 3, pageWidth, 18).fill('#fafafa');

        doc.fontSize(8).font('Helvetica').fillColor(dark);
        doc.text(String(idx + 1), cols.desc, rowY);
        doc.text(item.description ?? '', cols.desc + 15, rowY, { width: 190 });
        doc.text(item.hsnCode ?? '', cols.hsn, rowY);
        doc.text(String(Number(item.quantity ?? 0)), cols.qty, rowY);
        doc.text(`₹${Number(item.unitPrice ?? 0).toFixed(2)}`, cols.rate, rowY);
        doc.text(`${Number(item.taxRate ?? 0)}%`, cols.tax, rowY);
        doc.text(`₹${Number(item.amount ?? 0).toFixed(2)}`, cols.amount, rowY);

        rowY += 20;
      });

      // ── Totals ────────────────────────────────────────────────────
      rowY += 10;
      doc.moveTo(40, rowY).lineTo(40 + pageWidth, rowY).stroke('#e5e7eb');
      rowY += 8;

      const totalsX = 380;
      const valX = 530;

      const addTotal = (label: string, value: number, bold = false, color = dark) => {
        if (bold) {
          doc.rect(totalsX - 10, rowY - 3, pageWidth - totalsX + 50, 20).fill(orange);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('white')
            .text(label, totalsX, rowY, { width: 130 })
            .text(`₹${value.toFixed(2)}`, valX, rowY, { align: 'right', width: 50 });
          doc.fillColor(dark);
        } else {
          doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
            .text(label, totalsX, rowY, { width: 130 })
            .text(`₹${value.toFixed(2)}`, valX, rowY, { align: 'right', width: 50 });
        }
        rowY += bold ? 22 : 16;
      };

      addTotal('Subtotal', Number(invoice.subtotal ?? 0));
      if (Number(invoice.discountAmount ?? 0) > 0) addTotal('Discount', Number(invoice.discountAmount ?? 0), false, '#ef4444');
      if (Number(invoice.cgstAmount ?? 0) > 0) addTotal('CGST', Number(invoice.cgstAmount ?? 0));
      if (Number(invoice.sgstAmount ?? 0) > 0) addTotal('SGST', Number(invoice.sgstAmount ?? 0));
      if (Number(invoice.igstAmount ?? 0) > 0) addTotal('IGST', Number(invoice.igstAmount ?? 0));
      addTotal('TOTAL AMOUNT', Number(invoice.totalAmount ?? 0), true);
      if (Number(invoice.paidAmount ?? 0) > 0) addTotal('Paid', Number(invoice.paidAmount ?? 0), false, '#10b981');
      if (Number(invoice.balanceAmount ?? 0) > 0) addTotal('Balance Due', Number(invoice.balanceAmount ?? 0), false, '#ef4444');

      // ── Footer ────────────────────────────────────────────────────
      if (invoice.termsAndConditions) {
        rowY += 20;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(gray).text('Terms & Conditions', 40, rowY);
        rowY += 12;
        doc.fontSize(7).font('Helvetica').fillColor(gray).text(invoice.termsAndConditions, 40, rowY, { width: 300 });
      }

      if (invoice.notes) {
        rowY += 20;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(gray).text('Notes', 40, rowY);
        rowY += 12;
        doc.fontSize(7).font('Helvetica').fillColor(gray).text(invoice.notes, 40, rowY, { width: 300 });
      }

      // Powered by
      doc.fontSize(7).fillColor('#d1d5db')
        .text('Generated by Ventrix', 40, doc.page.height - 30, { align: 'center', width: pageWidth });

      doc.end();
    });
  }
}
