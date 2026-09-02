import { Request, Response } from 'express';
import { authService } from './auth.service';
import { successResponse, createdResponse } from '../../shared/helpers/response.helper';
import { authenticate } from '../../shared/middleware/auth.middleware';

export class AuthController {
  /**
   * @swagger
   * /auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register a new user and organization
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [firstName, lastName, email, password, organizationName]
   *             properties:
   *               firstName: { type: string }
   *               lastName: { type: string }
   *               email: { type: string, format: email }
   *               phone: { type: string }
   *               password: { type: string, minLength: 8 }
   *               organizationName: { type: string }
   *     responses:
   *       201:
   *         description: Registration successful
   */
  async register(req: Request, res: Response): Promise<void> {
    const result = await authService.register(req.body);
    res.status(201).json(createdResponse(result, 'Registration successful'));
  }

  /**
   * @swagger
   * /auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Login with email and password
   *     security: []
   */
  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body, req.ip);
    res.json(successResponse(result, 'Login successful'));
  }

  async sendOTP(req: Request, res: Response): Promise<void> {
    const result = await authService.sendOTP(req.body);
    res.json(successResponse(result, 'OTP sent successfully'));
  }

  async verifyOTPLogin(req: Request, res: Response): Promise<void> {
    const result = await authService.verifyOTPLogin(req.body);
    res.json(successResponse(result, 'OTP verified successfully'));
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    const result = await authService.refreshToken(refreshToken);
    res.json(successResponse(result, 'Token refreshed'));
  }

  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken, req.user!.userId);
    res.json(successResponse(null, 'Logged out successfully'));
  }

  async forgotPassword(req: Request, res: Response): Promise<void> {
    const result = await authService.forgotPassword(req.body);
    res.json(successResponse(result));
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    const result = await authService.resetPassword(req.body);
    res.json(successResponse(result));
  }

  async verifyEmail(req: Request, res: Response): Promise<void> {
    const { token } = req.query as { token: string };
    const result = await authService.verifyEmail(token);
    res.json(successResponse(result));
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    const result = await authService.changePassword(req.user!.userId, req.body);
    res.json(successResponse(result));
  }

  async me(req: Request, res: Response): Promise<void> {
    const { prisma } = await import('../../infrastructure/database');
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        organizations: {
          where: { isActive: true },
          include: {
            organization: true,
            permissions: true,
          },
        },
      },
    });

    const { passwordHash, ...safeUser } = user as any;
    res.json(successResponse(safeUser));
  }
}

export const authController = new AuthController();
