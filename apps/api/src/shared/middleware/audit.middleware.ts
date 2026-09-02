import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../infrastructure/database';

interface AuditContext {
  organizationId: string;
  userId: string;
  action: string;
  module: string;
  resourceType?: string;
  resourceId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(ctx: AuditContext, req: Request): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: ctx.action,
        module: ctx.module,
        resourceType: ctx.resourceType,
        resourceId: ctx.resourceId,
        oldValues: ctx.oldValues as any,
        newValues: ctx.newValues as any,
        metadata: ctx.metadata as any,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch {
    // Audit log failures should not break the main flow
  }
}

export function auditMiddleware(module: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const originalSend = res.json.bind(res);

    res.json = function (data) {
      if (res.statusCode < 400 && req.user) {
        createAuditLog(
          {
            organizationId: req.organizationId || req.user.organizationId,
            userId: req.user.userId,
            action,
            module,
            resourceId: req.params?.id,
            metadata: { method: req.method, path: req.path },
          },
          req
        ).catch(() => {});
      }
      return originalSend(data);
    };

    next();
  };
}
