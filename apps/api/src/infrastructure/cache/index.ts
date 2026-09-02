import Redis from 'ioredis';
import { config } from '../../config';
import { logger } from '../logger';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
});

redis.on('connect', () => logger.info('Redis connecting...'));
redis.on('ready', () => logger.info('Redis ready'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
redis.on('close', () => logger.warn('Redis connection closed'));

// Cache helper class
export class CacheService {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.redis.exists(key);
    return count > 0;
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  // Cache keys factory
  static keys = {
    user: (id: string) => `user:${id}`,
    userSession: (token: string) => `session:${token}`,
    orgSettings: (orgId: string) => `org:${orgId}:settings`,
    rateLimit: (ip: string) => `ratelimit:${ip}`,
    otp: (identifier: string) => `otp:${identifier}`,
    stockSummary: (orgId: string, productId: string) => `stock:${orgId}:${productId}`,
    dashboardStats: (orgId: string) => `dashboard:${orgId}:stats`,
    gstrReport: (orgId: string, period: string) => `gst:${orgId}:${period}`,
    invoiceSeq: (orgId: string) => `seq:invoice:${orgId}`,
    purchaseSeq: (orgId: string) => `seq:purchase:${orgId}`,
  };
}

export const cache = new CacheService(redis);
