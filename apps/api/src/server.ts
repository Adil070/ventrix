import 'dotenv/config';
import http from 'http';
import { Server as SocketServer } from 'socket.io';

import { createApp } from './app';
import { config } from './config';
import { logger } from './infrastructure/logger';
import { prisma } from './infrastructure/database';
import { redis } from './infrastructure/cache';
import { setupSocketHandlers } from './infrastructure/socket';
import { startJobQueues } from './infrastructure/queues';

async function main(): Promise<void> {
  try {
    // ── Database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // ── Redis connection
    await redis.ping();
    logger.info('✅ Redis connected');

    // ── Create Express app
    const app = createApp();
    const server = http.createServer(app);

    // ── Socket.io setup
    const io = new SocketServer(server, {
      cors: {
        origin: config.CORS_ORIGINS,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    setupSocketHandlers(io);
    logger.info('✅ Socket.io initialized');

    // ── Job queues
    await startJobQueues();
    logger.info('✅ Job queues started');

    // ── Start server
    server.listen(config.PORT, () => {
      logger.info(`🚀 Server running on port ${config.PORT} in ${config.NODE_ENV} mode`);
      logger.info(`📖 API Docs: http://localhost:${config.PORT}/api/docs`);
      logger.info(`❤️  Health: http://localhost:${config.PORT}/health`);
    });

    // ── Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      server.close(async () => {
        await prisma.$disconnect();
        await redis.quit();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, 'Unhandled Promise Rejection');
    });

    process.on('uncaughtException', (error) => {
      logger.error({ error }, 'Uncaught Exception');
      process.exit(1);
    });

  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
