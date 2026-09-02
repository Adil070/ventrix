import { z } from 'zod';

export const RegisterDto = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
      message: 'Password must contain uppercase, lowercase, number and special character',
    }),
  organizationName: z.string().min(1).max(100),
});

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceInfo: z
    .object({
      deviceId: z.string().optional(),
      deviceName: z.string().optional(),
      deviceType: z.string().optional(),
    })
    .optional(),
});

export const OTPLoginDto = z.object({
  identifier: z.string(),
  otp: z.string().length(6),
});

export const SendOTPDto = z.object({
  identifier: z.string(),
  type: z.enum(['EMAIL', 'SMS']),
});

export const RefreshTokenDto = z.object({
  refreshToken: z.string(),
});

export const ForgotPasswordDto = z.object({
  email: z.string().email(),
});

export const ResetPasswordDto = z.object({
  token: z.string(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
});

export const VerifyEmailDto = z.object({
  token: z.string(),
});

export const ChangePasswordDto = z.object({
  currentPassword: z.string(),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
});

export type RegisterInput = z.infer<typeof RegisterDto>;
export type LoginInput = z.infer<typeof LoginDto>;
export type OTPLoginInput = z.infer<typeof OTPLoginDto>;
export type SendOTPInput = z.infer<typeof SendOTPDto>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenDto>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDto>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordDto>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordDto>;
