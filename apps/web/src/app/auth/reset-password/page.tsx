'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import Link from 'next/link';
import api from '@/lib/api';
import { KeyRound, ArrowLeft, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react';

// Same rule the API enforces in ResetPasswordDto (auth.dto.ts).
const PASSWORD_RULES: Array<{ label: string; test: (v: string) => boolean }> = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One number', test: (v) => /\d/.test(v) },
  { label: 'One symbol from @ $ ! % * ? &', test: (v) => /[@$!%*?&]/.test(v) },
];
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

const ResetSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(PASSWORD_REGEX, 'Password must contain uppercase, lowercase, number and one of @$!%*?&'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

type ResetForm = z.infer<typeof ResetSchema>;

function InvalidLink({ message }: { message: string }) {
  return (
    <div className="text-center space-y-4">
      <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
        <AlertTriangle className="w-8 h-8 text-orange-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Reset link not valid</h2>
      <p className="text-gray-500">{message}</p>
      <Link href="/auth/forgot-password" className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white text-center rounded-xl font-semibold transition">
        Request a new link
      </Link>
      <Link href="/auth/login" className="block w-full py-2 text-center text-sm font-medium text-orange-600 hover:text-orange-700">Back to sign in</Link>
    </div>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token')?.trim() || '';
  const [done, setDone] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const { register, handleSubmit, formState: { errors }, watch } = useForm<ResetForm>({ resolver: zodResolver(ResetSchema) });
  const password = watch('password') || '';

  const onSubmit = async (d: ResetForm) => {
    setLoading(true);
    try {
      await api.auth.resetPassword({ token, password: d.password });
      setDone(true);
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      // A 400 that is not about the password itself means the token is unknown, used or expired.
      const isPasswordProblem = data?.details?.some?.((x: any) => x?.field === 'password');
      if (status === 400 && !isPasswordProblem) {
        setInvalidToken(true);
      } else {
        toast.error(data?.details?.[0]?.message || data?.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return <InvalidLink message="This page needs the link from your password reset email. Request a new one below." />;
  }

  if (invalidToken) {
    return <InvalidLink message="This password reset link is invalid, has already been used, or has expired. Links work once and expire after 1 hour." />;
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Password updated</h2>
        <p className="text-gray-500">Your password has been reset. You have been signed out of other devices.</p>
        <Link href="/auth/login" className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white text-center rounded-xl font-semibold transition">
          Sign in
        </Link>
      </div>
    );
  }

  const inputClass = 'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';

  return (
    <>
      <div className="text-center mb-8">
        <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
          <KeyRound className="w-6 h-6 text-orange-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Set a new password</h2>
        <p className="text-gray-500 text-sm mt-2">Choose a new password for your account</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New password</label>
          <div className="relative">
            <input {...register('password')} type={show ? 'text' : 'password'} autoComplete="new-password" className={`${inputClass} pr-11`} placeholder="New password" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-600">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          <ul className="mt-2 space-y-1" aria-label="Password requirements">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.label} className={`text-xs flex items-center gap-1.5 ${ok ? 'text-green-600' : 'text-gray-500'}`}>
                  <CheckCircle className={`w-3.5 h-3.5 ${ok ? 'text-green-500' : 'text-gray-300'}`} /> {rule.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm new password</label>
          <input {...register('confirmPassword')} type={show ? 'text' : 'password'} autoComplete="new-password" className={inputClass} placeholder="Repeat new password" />
          {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>}
        </div>

        <button type="submit" disabled={loading} className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition disabled:opacity-50">
          {loading ? 'Saving...' : 'Reset password'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/auth/login" className="text-sm text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
        {/* useSearchParams needs a Suspense boundary for the static build. */}
        <Suspense fallback={<div className="h-64" aria-busy="true" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
