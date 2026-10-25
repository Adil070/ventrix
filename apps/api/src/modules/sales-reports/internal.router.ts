import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { successResponse } from '../../shared/helpers/response.helper';
import { ServiceUnavailableError, UnauthorizedError } from '../../shared/errors';
import { runScheduledSalesReports } from './sales-report.service';

/**
 * Endpoints for the external scheduler (GitHub Actions / cron-job.org), not for users: no JWT, guarded by
 * the shared CRON_SECRET in the X-Cron-Secret header. Unset CRON_SECRET disables them.
 */
const router = Router();

function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!config.CRON_SECRET) throw new ServiceUnavailableError('Scheduled jobs are disabled (CRON_SECRET is not set)');
  const given = Buffer.from(String(req.headers['x-cron-secret'] ?? ''));
  const expected = Buffer.from(config.CRON_SECRET);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new UnauthorizedError('Invalid cron secret');
  }
  next();
}

router.use(requireCronSecret);

// POST /internal/sales-reports/run: called at 07:00, 11:00, 15:00, 19:00 and 22:00 IST.
// Safe to call again: a slot that already has a snapshot is skipped.
router.post('/sales-reports/run', async (_req: Request, res: Response) => {
  res.json(successResponse(await runScheduledSalesReports()));
});

export { router as internalRouter };
