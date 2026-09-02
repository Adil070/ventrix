import Bull, { Queue, Job } from 'bull';
import { config } from '../../config';
import { logger } from '../logger';
import { emailService } from '../email';

// Queue definitions
interface EmailJobData {
  type: string;
  to: string;
  data: Record<string, unknown>;
  pdfBuffer?: string; // Base64
}

interface ReportJobData {
  type: string;
  organizationId: string;
  filters: Record<string, unknown>;
  userId: string;
}

interface NotificationJobData {
  type: string;
  userId: string;
  organizationId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

interface StockSyncJobData {
  organizationId: string;
  productId: string;
  warehouseId: string;
}

interface GSTReportJobData {
  organizationId: string;
  period: string;
  type: string;
}

const redisConnection = {
  host: new URL(config.REDIS_URL.replace('redis://', 'http://')).hostname,
  port: Number(new URL(config.REDIS_URL.replace('redis://', 'http://')).port) || 6379,
  password: config.REDIS_URL.includes('@')
    ? config.REDIS_URL.split(':')[2]?.split('@')[0]
    : undefined,
};

// Create queues
export const emailQueue = new Bull<EmailJobData>('email', { redis: redisConnection });
export const reportQueue = new Bull<ReportJobData>('reports', { redis: redisConnection });
export const notificationQueue = new Bull<NotificationJobData>('notifications', { redis: redisConnection });
export const stockSyncQueue = new Bull<StockSyncJobData>('stock-sync', { redis: redisConnection });
export const gstReportQueue = new Bull<GSTReportJobData>('gst-reports', { redis: redisConnection });

// Email queue processor
emailQueue.process(async (job: Job<EmailJobData>) => {
  const { type, to, data, pdfBuffer } = job.data;

  try {
    switch (type) {
      case 'welcome':
        await emailService.sendWelcomeEmail(to, data as any);
        break;
      case 'otp':
        await emailService.sendOTPEmail(to, data as any);
        break;
      case 'password-reset':
        await emailService.sendPasswordResetEmail(to, data as any);
        break;
      case 'invoice':
        const buffer = pdfBuffer ? Buffer.from(pdfBuffer, 'base64') : undefined;
        await emailService.sendInvoiceEmail(to, data as any, buffer);
        break;
      case 'payment-reminder':
        await emailService.sendPaymentReminderEmail(to, data as any);
        break;
      default:
        logger.warn({ type }, 'Unknown email job type');
    }

    logger.info({ jobId: job.id, type, to }, 'Email job completed');
  } catch (error) {
    logger.error({ error, jobId: job.id }, 'Email job failed');
    throw error;
  }
});

// Notification queue processor (placeholder)
notificationQueue.process(async (job: Job<NotificationJobData>) => {
  const { type, userId, title, body } = job.data;
  logger.info({ jobId: job.id, type, userId, title }, 'Processing notification');
  // Add real push notification logic here (FCM, etc.)
});

// Stock sync queue processor
stockSyncQueue.process(async (job: Job<StockSyncJobData>) => {
  const { organizationId, productId, warehouseId } = job.data;
  logger.info({ jobId: job.id, organizationId, productId }, 'Stock sync job');
  // Recalculate and cache stock levels
});

// Error handlers
[emailQueue, reportQueue, notificationQueue, stockSyncQueue, gstReportQueue].forEach((queue) => {
  queue.on('error', (error) => {
    logger.error({ queue: queue.name, error }, 'Queue error');
  });

  queue.on('failed', (job, error) => {
    logger.error({ queue: queue.name, jobId: job.id, error }, 'Job failed');
  });
});

export async function startJobQueues(): Promise<void> {
  logger.info('Job queues started');
}

// Helper to add jobs
export const jobs = {
  sendEmail: (data: EmailJobData) =>
    emailQueue.add(data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }),

  sendNotification: (data: NotificationJobData) =>
    notificationQueue.add(data, { attempts: 3 }),

  syncStock: (data: StockSyncJobData) =>
    stockSyncQueue.add(data, { attempts: 2 }),

  generateGSTReport: (data: GSTReportJobData) =>
    gstReportQueue.add(data, { attempts: 2, timeout: 60000 }),
};
