import { PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { logger } from '../logger';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.IS_DEVELOPMENT
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ]
      : [
          { emit: 'event', level: 'error' },
        ],
  });

if (config.IS_DEVELOPMENT) {
  (prisma as any).$on('query', (e: any) => {
    logger.debug({ query: e.query, params: e.params, duration: `${e.duration}ms` }, 'DB Query');
  });
}

(prisma as any).$on('error', (e: any) => {
  logger.error({ error: e }, 'DB Error');
});

if (config.IS_DEVELOPMENT) {
  globalForPrisma.prisma = prisma;
}

// Repository base class
export abstract class BaseRepository<T> {
  constructor(protected readonly prisma: PrismaClient) {}
}
