import { Router } from 'express';
import { authController } from './auth.controller';
import { validateBody, validateQuery } from '../../shared/middleware/validate.middleware';
import { authRateLimiter, otpRateLimiter } from '../../shared/middleware/rate-limiter';
import { authenticate } from '../../shared/middleware/auth.middleware';
import {
  RegisterDto,
  LoginDto,
  OTPLoginDto,
  SendOTPDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './auth.dto';
import { z } from 'zod';

export const authRouter = Router();

// Public routes
authRouter.post('/register', authRateLimiter, validateBody(RegisterDto), authController.register.bind(authController));
authRouter.post('/login', authRateLimiter, validateBody(LoginDto), authController.login.bind(authController));
authRouter.post('/otp/send', otpRateLimiter, validateBody(SendOTPDto), authController.sendOTP.bind(authController));
authRouter.post('/otp/verify', authRateLimiter, validateBody(OTPLoginDto), authController.verifyOTPLogin.bind(authController));
authRouter.post('/refresh-token', validateBody(RefreshTokenDto), authController.refreshToken.bind(authController));
authRouter.post('/forgot-password', authRateLimiter, validateBody(ForgotPasswordDto), authController.forgotPassword.bind(authController));
authRouter.post('/reset-password', validateBody(ResetPasswordDto), authController.resetPassword.bind(authController));
authRouter.get('/verify-email', validateQuery(z.object({ token: z.string() })), authController.verifyEmail.bind(authController));

// Protected routes
authRouter.post('/logout', authenticate, validateBody(RefreshTokenDto), authController.logout.bind(authController));
authRouter.post('/change-password', authenticate, validateBody(ChangePasswordDto), authController.changePassword.bind(authController));
authRouter.get('/me', authenticate, authController.me.bind(authController));
