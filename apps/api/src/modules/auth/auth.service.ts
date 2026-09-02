import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../infrastructure/database';
import { cache, CacheService } from '../../infrastructure/cache';
import { config } from '../../config';
import { jobs } from '../../infrastructure/queues';
import {
  RegisterInput,
  LoginInput,
  OTPLoginInput,
  SendOTPInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from './auth.dto';
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
} from '../../shared/errors';
import { logger } from '../../infrastructure/logger';

const BCRYPT_ROUNDS = 12;
const OTP_EXPIRY_MINUTES = 10;
const EMAIL_VERIFY_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;

export class AuthService {
  // ─── Register ────────────────────────────────────────────────────────────────
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
        },
      });

      // Create organization
      const org = await tx.organization.create({
        data: {
          name: input.organizationName,
        },
      });

      // Create default branch (HQ)
      const branch = await tx.branch.create({
        data: {
          organizationId: org.id,
          name: 'Head Office',
          code: 'HO',
          isHeadOffice: true,
        },
      });

      // Add user to org as owner
      await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          branchId: branch.id,
          role: 'ORG_OWNER',
        },
      });

      // Create default chart of accounts
      await this.createDefaultAccounts(tx, org.id);

      // Create trial subscription
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          plan: 'FREE',
          status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      return { user, org };
    });

    // Send verification email
    const verifyToken = this.generateSecureToken();
    await cache.set(
      `verify:email:${verifyToken}`,
      result.user.id,
      EMAIL_VERIFY_EXPIRY_HOURS * 3600
    );

    await jobs.sendEmail({
      type: 'welcome',
      to: input.email,
      data: {
        name: input.firstName,
        verifyUrl: `${config.APP_URL}/verify-email?token=${verifyToken}`,
      },
    });

    const tokens = await this.generateTokens(result.user.id, result.org.id, 'ORG_OWNER');

    return {
      user: this.sanitizeUser(result.user),
      organization: result.org,
      ...tokens,
    };
  }

  // ─── Login ───────────────────────────────────────────────────────────────────
  async login(input: LoginInput, ipAddress?: string) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        organizations: {
          where: { isActive: true },
          include: { organization: true },
          take: 1,
          orderBy: { joinedAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError(
        `Account locked. Try again after ${user.lockedUntil.toLocaleTimeString()}`
      );
    }

    if (!user.passwordHash) {
      throw new UnauthorizedError('Please login with Google or use OTP');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isPasswordValid) {
      // Increment failed attempts
      const attempts = user.failedLoginAttempts + 1;
      const updateData: any = { failedLoginAttempts: attempts };

      if (attempts >= 5) {
        updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lock
      }

      await prisma.user.update({ where: { id: user.id }, data: updateData });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Your account has been deactivated');
    }

    // Reset failed attempts
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    const userOrg = user.organizations[0];
    const organizationId = userOrg?.organizationId;
    const role = userOrg?.role || 'STAFF';

    const tokens = await this.generateTokens(user.id, organizationId, role);

    return {
      user: this.sanitizeUser(user),
      organization: userOrg?.organization,
      ...tokens,
    };
  }

  // ─── OTP Login ───────────────────────────────────────────────────────────────
  async sendOTP(input: SendOTPInput) {
    const identifier = input.identifier;
    const code = this.generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP
    await prisma.oTPCode.create({
      data: {
        identifier,
        code: await bcrypt.hash(code, 6),
        type: input.type,
        expiresAt,
      },
    });

    // Send via appropriate channel
    if (input.type === 'EMAIL') {
      await jobs.sendEmail({
        type: 'otp',
        to: identifier,
        data: {
          otp: code,
          expiresIn: `${OTP_EXPIRY_MINUTES} minutes`,
        },
      });
    }

    logger.info({ identifier, type: input.type }, 'OTP sent');

    return { message: `OTP sent to ${identifier}`, expiresIn: OTP_EXPIRY_MINUTES };
  }

  async verifyOTPLogin(input: OTPLoginInput) {
    const otpRecord = await prisma.oTPCode.findFirst({
      where: {
        identifier: input.identifier,
        isUsed: false,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new BadRequestError('Invalid or expired OTP');
    }

    const isValid = await bcrypt.compare(input.otp, otpRecord.code);

    if (!isValid) {
      await prisma.oTPCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestError('Invalid OTP');
    }

    // Mark as used
    await prisma.oTPCode.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.identifier }, { phone: input.identifier }],
      },
      include: { organizations: { where: { isActive: true }, take: 1 } },
    });

    if (!user) {
      throw new NotFoundError('User', input.identifier);
    }

    const userOrg = user.organizations[0];
    const tokens = await this.generateTokens(
      user.id,
      userOrg?.organizationId,
      userOrg?.role || 'STAFF'
    );

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────────
  async refreshToken(token: string) {
    const stored = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { include: { organizations: { where: { isActive: true }, take: 1 } } } },
    });

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const userOrg = stored.user.organizations[0];

    // Rotate refresh token
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });

    const tokens = await this.generateTokens(
      stored.userId,
      userOrg?.organizationId,
      userOrg?.role || 'STAFF'
    );

    return tokens;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────────
  async logout(refreshToken: string, userId: string) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken, userId },
      data: { isRevoked: true },
    });

    // Invalidate user cache
    await cache.del(CacheService.keys.user(userId));
  }

  // ─── Forgot Password ──────────────────────────────────────────────────────────
  async forgotPassword(input: ForgotPasswordInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    // Always return success to prevent email enumeration
    if (!user) return { message: 'If this email exists, a reset link has been sent' };

    const resetToken = this.generateSecureToken();
    await cache.set(
      `reset:password:${resetToken}`,
      user.id,
      PASSWORD_RESET_EXPIRY_HOURS * 3600
    );

    await jobs.sendEmail({
      type: 'password-reset',
      to: user.email,
      data: {
        name: user.firstName,
        resetUrl: `${config.APP_URL}/reset-password?token=${resetToken}`,
      },
    });

    return { message: 'If this email exists, a reset link has been sent' };
  }

  // ─── Reset Password ───────────────────────────────────────────────────────────
  async resetPassword(input: ResetPasswordInput) {
    const userId = await cache.get<string>(`reset:password:${input.token}`);

    if (!userId) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });

    // Revoke all refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    await cache.del(`reset:password:${input.token}`);
    await cache.del(CacheService.keys.user(userId));

    return { message: 'Password reset successfully' };
  }

  // ─── Verify Email ────────────────────────────────────────────────────────────
  async verifyEmail(token: string) {
    const userId = await cache.get<string>(`verify:email:${token}`);

    if (!userId) {
      throw new BadRequestError('Invalid or expired verification token');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    });

    await cache.del(`verify:email:${token}`);

    return { message: 'Email verified successfully' };
  }

  // ─── Change Password ──────────────────────────────────────────────────────────
  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user?.passwordHash) {
      throw new BadRequestError('No password set for this account');
    }

    const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Revoke all tokens
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    return { message: 'Password changed successfully' };
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────────
  async handleGoogleAuth(profile: {
    id: string;
    emails: Array<{ value: string }>;
    name: { givenName: string; familyName: string };
    photos: Array<{ value: string }>;
  }) {
    const email = profile.emails[0].value;

    let user = await prisma.user.findUnique({
      where: { email },
      include: { organizations: { where: { isActive: true }, take: 1 } },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          avatarUrl: profile.photos[0]?.value,
          isEmailVerified: true,
        },
        include: { organizations: { where: { isActive: true }, take: 1 } },
      });
    }

    const userOrg = user.organizations[0];
    const tokens = await this.generateTokens(
      user.id,
      userOrg?.organizationId,
      userOrg?.role || 'STAFF'
    );

    return { user: this.sanitizeUser(user), ...tokens };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────
  private async generateTokens(userId: string, organizationId?: string, role?: string) {
    const payload = { userId, organizationId, role };

    const accessToken = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as any,
    });

    const refreshTokenValue = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        userId,
        token: refreshTokenValue,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: config.JWT_EXPIRES_IN,
    };
  }

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  private async createDefaultAccounts(tx: any, organizationId: string) {
    const accounts = [
      // Assets
      { code: '1000', name: 'Cash', type: 'ASSET', subType: 'CASH' },
      { code: '1100', name: 'Bank Accounts', type: 'ASSET', subType: 'BANK' },
      { code: '1200', name: 'Accounts Receivable', type: 'ASSET', subType: 'ACCOUNTS_RECEIVABLE' },
      { code: '1300', name: 'Inventory', type: 'ASSET', subType: 'CURRENT_ASSET' },
      { code: '1400', name: 'Prepaid Expenses', type: 'ASSET', subType: 'CURRENT_ASSET' },
      { code: '1500', name: 'Fixed Assets', type: 'ASSET', subType: 'FIXED_ASSET' },
      // Liabilities
      { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'ACCOUNTS_PAYABLE' },
      { code: '2100', name: 'GST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
      { code: '2200', name: 'CGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
      { code: '2300', name: 'SGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
      { code: '2400', name: 'IGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
      { code: '2500', name: 'TDS Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
      // Equity
      { code: '3000', name: 'Owner\'s Capital', type: 'EQUITY', subType: 'CAPITAL' },
      { code: '3100', name: 'Retained Earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS' },
      // Revenue
      { code: '4000', name: 'Sales Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE' },
      { code: '4100', name: 'Service Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE' },
      { code: '4200', name: 'Other Income', type: 'REVENUE', subType: 'OTHER_REVENUE' },
      // Expenses
      { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD' },
      { code: '5100', name: 'Purchases', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD' },
      { code: '6000', name: 'Salaries & Wages', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6100', name: 'Rent', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6200', name: 'Utilities', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6300', name: 'Office Expenses', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6400', name: 'Marketing', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6500', name: 'Depreciation', type: 'EXPENSE', subType: 'DEPRECIATION' },
      { code: '6600', name: 'Bank Charges', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
      { code: '6700', name: 'Travel', type: 'EXPENSE', subType: 'OPERATING_EXPENSE' },
    ];

    for (const account of accounts) {
      await tx.account.create({
        data: {
          organizationId,
          ...account,
          isSystem: true,
        },
      });
    }
  }
}

export const authService = new AuthService();
