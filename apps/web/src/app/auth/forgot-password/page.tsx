'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import Link from 'next/link';
import api from '@/lib/api';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';

const ForgotSchema = z.object({
  email: z.string().email('Invalid email'),
});

type ForgotForm = z.infer<typeof ForgotSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, watch } = useForm<ForgotForm>({ resolver: zodResolver(ForgotSchema) });
  const email = watch('email');

  const onSubmit = async (d: ForgotForm) => {
    setLoading(true);
    try {
      await api.auth.forgotPassword(d);
      setSent(true);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Check your email</h2>
            <p className="text-gray-500">We sent a password reset link to <span className="font-medium text-gray-900 dark:text-white">{email}</span></p>
            <Link href="/auth/login" className="block w-full py-3 text-center text-sm font-medium text-orange-600 hover:text-orange-700">Back to sign in</Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Forgot password?</h2>
              <p className="text-gray-500 text-sm mt-2">Enter your email and we'll send you a reset link</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
                <input {...register('email')} type="email" className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" placeholder="you@company.com" />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <button type="submit" disabled={loading} className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition disabled:opacity-50">
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link href="/auth/login" className="text-sm text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
