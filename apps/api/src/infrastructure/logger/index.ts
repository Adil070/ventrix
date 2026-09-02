import pino from 'pino';
import { config } from '../../config';

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.IS_DEVELOPMENT && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: {
    env: config.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});
