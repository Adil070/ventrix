import { z } from 'zod';

// Env flags are compared as text: z.coerce.boolean() turns the string "false" into true.
const envBoolean = (fallback: boolean) =>
  z.string().optional().transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8000),
  APP_NAME: z.string().default('Ventrix'),
  APP_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:8000'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // S3
  S3_ENDPOINT: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string().default('ventrix-files'),
  S3_REGION: z.string().default('ap-south-1'),
  S3_FORCE_PATH_STYLE: envBoolean(true),

  // Email
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().default('noreply@ventrix.com'),
  FROM_NAME: z.string().default('Ventrix'),

  // Twilio SMS
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // WhatsApp
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Encryption (at rest, e.g. each client's own SMTP password). Required to save client email settings.
  ENCRYPTION_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  // Per user (or per IP when signed out) per window. One screen loads several API calls, so 100 ran out in minutes.
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(1000),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Scheduled jobs: the external scheduler (GitHub Actions / cron-job.org) sends this in X-Cron-Secret.
  // Unset disables POST /api/v1/internal/* (503).
  CRON_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),

  // Feature Flags
  // Real-time push over Socket.io — off until a feature needs it (keeps the API free-tier friendly).
  FEATURE_REALTIME: envBoolean(false),
});

function loadConfig() {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  const data = parsed.data;

  return {
    ...data,
    CORS_ORIGINS: data.CORS_ORIGINS.split(',').map(o => o.trim()),
    IS_DEVELOPMENT: data.NODE_ENV === 'development',
    IS_PRODUCTION: data.NODE_ENV === 'production',
    IS_TEST: data.NODE_ENV === 'test',
  };
}

export const config = loadConfig();
export type Config = typeof config;
