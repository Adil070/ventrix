import { Request, Response } from 'express';
import { 
  generateBarcode, 
  generateBarcodeDataURL, 
  generateQRCode, 
  generateProductBarcode,
  generateUPIQRCode 
} from '../../shared/utils/barcode';
import { prisma } from '../../infrastructure/database';
import { NotFoundError } from '../../shared/errors';

/**
 * Generate barcode for a product
 * GET /api/products/:id/barcode
 */
export const getProductBarcode = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req;
    const { id } = req.params;
    const { format = 'png' } = req.query;

    const product = await prisma.product.findFirst({
      where: { id, organizationId: organizationId! },
      select: { sku: true, barcode: true, name: true }
    });

    if (!product) throw new NotFoundError('Product', id);

    const barcodeText = product.barcode || product.sku || id;

    if (format === 'dataurl') {
      const dataURL = await generateBarcodeDataURL(barcodeText);
      return res.json({
        success: true,
        data: { dataURL, text: barcodeText }
      });
    }

    // Return as PNG image
    const barcodeBuffer = await generateProductBarcode(barcodeText);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="barcode-${barcodeText}.png"`);
    res.send(barcodeBuffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Barcode generation failed'
    });
  }
};

/**
 * Generate QR code for a product (with product details)
 * GET /api/products/:id/qrcode
 */
export const getProductQRCode = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req;
    const { id } = req.params;
    const { format = 'png' } = req.query;

    const product = await prisma.product.findFirst({
      where: { id, organizationId: organizationId! },
      select: { 
        id: true,
        name: true, 
        sku: true, 
        barcode: true, 
        sellingPrice: true,
        mrp: true 
      }
    });

    if (!product) throw new NotFoundError('Product', id);

    // Create QR data with product info
    const qrData = JSON.stringify({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      price: Number(product.sellingPrice),
      mrp: Number(product.mrp)
    });

    if (format === 'dataurl') {
      const dataURL = await generateQRCode(qrData);
      return res.json({
        success: true,
        data: { dataURL, productInfo: product }
      });
    }

    // Return as PNG image
    const { default: QRCode } = await import('qrcode');
    const qrBuffer = await QRCode.toBuffer(qrData, { width: 300 });
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${product.sku}.png"`);
    res.send(qrBuffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'QR code generation failed'
    });
  }
};

/**
 * Generate UPI QR code for invoice payment
 * POST /api/payments/upi-qrcode
 */
export const generatePaymentQRCode = async (req: Request, res: Response) => {
  try {
    const { upiId, amount, name, note } = req.body;

    if (!upiId || !amount || !name) {
      return res.status(400).json({
        success: false,
        message: 'UPI ID, amount, and name are required'
      });
    }

    const dataURL = await generateUPIQRCode(upiId, amount, name, note);

    res.json({
      success: true,
      message: 'UPI QR code generated successfully',
      data: { dataURL, upiId, amount, name }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'UPI QR generation failed'
    });
  }
};

/**
 * Bulk generate barcodes for multiple products
 * POST /api/products/barcodes/bulk
 */
export const bulkGenerateBarcodes = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Product IDs array is required'
      });
    }

    const products = await prisma.product.findMany({
      where: { 
        id: { in: productIds },
        organizationId: organizationId! 
      },
      select: { id: true, name: true, sku: true, barcode: true }
    });

    const barcodes = await Promise.all(
      products.map(async (product) => {
        const barcodeText = product.barcode || product.sku || product.id;
        const dataURL = await generateBarcodeDataURL(barcodeText);
        
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          barcodeText,
          dataURL
        };
      })
    );

    res.json({
      success: true,
      message: `Generated ${barcodes.length} barcodes`,
      data: barcodes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Bulk barcode generation failed'
    });
  }
};
