import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { prisma } from '../../infrastructure/database';
import { cache, CacheService } from '../../infrastructure/cache';
import { UnauthorizedError, ForbiddenError } from '../errors';
import { Permission } from '@prisma/client';

export interface AuthUser {
  userId: string;
  email: string;
  organizationId: string;
  branchId?: string;
  role: string;
  isSuperAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      organizationId?: string;
      userId?: string;
      branchId?: string;
    }
  }
}

// Verify JWT and attach user to request
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('No authentication token provided');
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as any;

    // Check if user exists and is active
    const cacheKey = CacheService.keys.user(payload.userId);
    let user = await cache.get<AuthUser>(cacheKey);

    if (!user) {
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          isActive: true,
          isSuperAdmin: true,
        },
      });

      if (!dbUser || !dbUser.isActive) {
        throw new UnauthorizedError('User account is inactive');
      }

      user = {
        userId: dbUser.id,
        email: dbUser.email,
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        role: payload.role,
        isSuperAdmin: dbUser.isSuperAdmin,
      };

      await cache.set(cacheKey, user, 300); // Cache for 5 minutes
    }

    req.user = user;
    req.userId = user.userId;
    req.branchId = user.branchId;
    req.organizationId = user.organizationId;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired authentication token');
  }
}

// Alias for backward compatibility with older routers
export const authMiddleware = authenticate;

// Permission check middleware factory
export function requirePermission(module: string, permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;

    if (!user) {
      throw new UnauthorizedError();
    }

    if (user.isSuperAdmin) {
      return next();
    }

    const userOrg = await prisma.userOrganization.findFirst({
      where: {
        userId: user.userId,
        organizationId: user.organizationId,
        isActive: true,
      },
      include: {
        permissions: {
          where: { module },
        },
      },
    });

    if (!userOrg) {
      throw new ForbiddenError();
    }

    // Check role-based permissions
    if (hasRolePermission(userOrg.role, module, permission)) {
      return next();
    }

    // Check custom permissions
    const modulePermissions = userOrg.permissions[0];
    if (modulePermissions && modulePermissions.permissions.includes(permission)) {
      return next();
    }

    throw new ForbiddenError(`You don't have ${permission} permission for ${module}`);
  };
}

// Default role permissions map
function hasRolePermission(role: string, _module: string, permission: Permission): boolean {
  const rolePermissions: Record<string, Permission[]> = {
    SUPER_ADMIN: Object.values(Permission),
    ORG_OWNER: Object.values(Permission),
    BRANCH_ADMIN: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.EXPORT, Permission.PRINT, Permission.APPROVE],
    ACCOUNTANT: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.EXPORT, Permission.PRINT],
    MANAGER: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.APPROVE, Permission.EXPORT, Permission.PRINT],
    SALES_EXECUTIVE: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.PRINT],
    CASHIER: [Permission.VIEW, Permission.CREATE, Permission.PRINT],
    WAREHOUSE_MANAGER: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    STAFF: [Permission.VIEW],
  };

  return rolePermissions[role]?.includes(permission) ?? false;
}

// Require specific role
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      throw new UnauthorizedError();
    }

    if (user.isSuperAdmin) {
      return next();
    }

    if (!roles.includes(user.role)) {
      throw new ForbiddenError(`Required role: ${roles.join(' or ')}`);
    }

    next();
  };
}

// Super admin only
export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user?.isSuperAdmin) {
    throw new ForbiddenError('Super admin access required');
  }
  next();
};
