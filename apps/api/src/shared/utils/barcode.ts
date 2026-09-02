import QRCode from 'qrcode';
import bwipjs from 'bwip-js';

/**
 * Generate QR Code for UPI payments, product info, or any data
 */
export async function generateQRCode(data: string, options?: {
  width?: number;
  margin?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}): Promise<string> {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(data, {
      width: options?.width || 300,
      margin: options?.margin || 2,
      errorCorrectionLevel: options?.errorCorrectionLevel || 'M',
    });
    return qrCodeDataURL;
  } catch (error) {
    const err = error as Error;
    throw new Error(`QR Code generation failed: ${err.message}`);
  }
}

/**
 * Generate QR Code as buffer (for PDF embedding)
 */
export async function generateQRCodeBuffer(data: string, options?: {
  width?: number;
  margin?: number;
}): Promise<Buffer> {
  try {
    const buffer = await QRCode.toBuffer(data, {
      width: options?.width || 300,
      margin: options?.margin || 2,
      type: 'png',
    });
    return buffer;
  } catch (error) {
    const err = error as Error;
    throw new Error(`QR Code buffer generation failed: ${err.message}`);
  }
}

/**
 * Generate UPI Payment QR Code
 * @param upiId - UPI ID (e.g., merchant@upi)
 * @param amount - Payment amount
 * @param name - Payee name
 * @param note - Payment note/reference
 */
export async function generateUPIQRCode(
  upiId: string,
  amount: number,
  name: string,
  note?: string
): Promise<string> {
  // UPI QR Code format: upi://pay?pa=<UPI_ID>&pn=<NAME>&am=<AMOUNT>&cu=INR&tn=<NOTE>
  const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR${note ? `&tn=${encodeURIComponent(note)}` : ''}`;
  
  return generateQRCode(upiString, { errorCorrectionLevel: 'H' });
}

/**
 * Generate Barcode (Code128, EAN13, etc.)
 * @param text - Text to encode
 * @param type - Barcode type
 */
export async function generateBarcode(
  text: string,
  options?: {
    type?: 'code128' | 'ean13' | 'ean8' | 'upca' | 'code39' | 'itf14';
    width?: number;
    height?: number;
    includeText?: boolean;
  }
): Promise<Buffer> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: options?.type || 'code128',
      text: text,
      scale: 3,
      height: options?.height || 10,
      width: options?.width,
      includetext: options?.includeText !== false,
      textxalign: 'center',
    });
    
    return png;
  } catch (error) {
    const err = error as Error;
    throw new Error(`Barcode generation failed: ${err.message}`);
  }
}

/**
 * Generate Barcode as Base64 Data URL
 */
export async function generateBarcodeDataURL(
  text: string,
  options?: {
    type?: 'code128' | 'ean13' | 'ean8' | 'upca' | 'code39' | 'itf14';
    width?: number;
    height?: number;
  }
): Promise<string> {
  const buffer = await generateBarcode(text, options);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Generate Product Barcode (EAN13 format)
 */
export async function generateProductBarcode(sku: string): Promise<Buffer> {
  // If SKU is numeric and 13 digits, use EAN13
  if (/^\d{13}$/.test(sku)) {
    return generateBarcode(sku, { type: 'ean13' });
  }
  // Otherwise use Code128
  return generateBarcode(sku, { type: 'code128' });
}

/**
 * Validate EAN13 checksum
 */
export function validateEAN13(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;
  
  const digits = ean.split('').map(Number);
  const checkDigit = digits[12];
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  
  const calculatedCheck = (10 - (sum % 10)) % 10;
  return calculatedCheck === checkDigit;
}

/**
 * Generate GST QR Code for invoices (as per GST specifications)
 */
export async function generateGSTQRCode(invoiceData: {
  gstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  igstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  cessAmount?: number;
}): Promise<string> {
  // GST QR Code format (pipe-separated)
  const qrData = [
    invoiceData.gstin,
    invoiceData.invoiceNumber,
    invoiceData.invoiceDate,
    invoiceData.totalAmount.toFixed(2),
    (invoiceData.igstAmount || 0).toFixed(2),
    (invoiceData.cgstAmount || 0).toFixed(2),
    (invoiceData.sgstAmount || 0).toFixed(2),
    (invoiceData.cessAmount || 0).toFixed(2),
  ].join('|');
  
  return generateQRCode(qrData, { errorCorrectionLevel: 'H' });
}
