import { Request, Response } from 'express';
import { catchAsync } from '@/shared/utils/catch-async';
import { GSTReportsService } from './gst-reports.service';
import { z } from 'zod';

const gstReportsService = new GSTReportsService();

const DateRangeSchema = z.object({
  fromDate: z.string().transform(str => new Date(str)),
  toDate: z.string().transform(str => new Date(str))
});

const MonthYearSchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000).max(2100)
});

/**
 * GET /api/gst/reports/gstr1
 * Generate GSTR-1 report (Outward Supplies)
 */
export const getGSTR1 = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.user;
  const { fromDate, toDate } = DateRangeSchema.parse(req.query);

  const report = await gstReportsService.generateGSTR1(organizationId, fromDate, toDate);

  res.json({
    success: true,
    message: 'GSTR-1 report generated successfully',
    data: report
  });
});

/**
 * GET /api/gst/reports/gstr2
 * Generate GSTR-2 report (Inward Supplies)
 */
export const getGSTR2 = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.user;
  const { fromDate, toDate } = DateRangeSchema.parse(req.query);

  const report = await gstReportsService.generateGSTR2(organizationId, fromDate, toDate);

  res.json({
    success: true,
    message: 'GSTR-2 report generated successfully',
    data: report
  });
});

/**
 * GET /api/gst/reports/gstr3b
 * Generate GSTR-3B report (Monthly Summary)
 */
export const getGSTR3B = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.user;
  const { month, year } = MonthYearSchema.parse(req.query);

  const report = await gstReportsService.generateGSTR3B(organizationId, month, year);

  res.json({
    success: true,
    message: 'GSTR-3B report generated successfully',
    data: report
  });
});

/**
 * GET /api/gst/summary
 * Get GST summary for dashboard
 */
export const getGSTSummary = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.user;
  
  // Get current month
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const gstr3b = await gstReportsService.generateGSTR3B(organizationId, month, year);

  res.json({
    success: true,
    message: 'GST summary retrieved successfully',
    data: {
      currentMonth: { month, year },
      outputGST: gstr3b.outwardSupplies.totalTax,
      inputGST: gstr3b.inwardSupplies.totalITC,
      netGSTPayable: gstr3b.netTaxLiability.total,
      breakdown: {
        cgst: gstr3b.netTaxLiability.cgst,
        sgst: gstr3b.netTaxLiability.sgst,
        igst: gstr3b.netTaxLiability.igst
      }
    }
  });
});
