'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});

type LoginForm = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [showOTP, setShowOTP] = useState(false);
  const [otp, setOtp] = useState('');
  const [phoneOrEmail, setPhoneOrEmail] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(LoginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const res = await api.auth.login(data);
      const { user, accessToken, refreshToken } = res.data.data;
      setAuth(user, accessToken, refreshToken);
      toast.success(`Welcome back, ${user.firstName}!`);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const sendOTP = async () => {
    if (!phoneOrEmail) return toast.error('Enter phone or email');
    setLoading(true);
    try {
      await api.auth.sendOTP({ identifier: phoneOrEmail, type: 'LOGIN' });
      setShowOTP(true);
      toast.success('OTP sent!');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const loginWithOTP = async () => {
    setLoading(true);
    try {
      const res = await api.auth.loginWithOTP({ identifier: phoneOrEmail, otp });
      const { user, accessToken, refreshToken } = res.data.data;
      setAuth(user, accessToken, refreshToken);
      toast.success(`Welcome, ${user.firstName}!`);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Welcome back</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6">Sign in to your account</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
          <input {...register('email')} type="email" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition" placeholder="you@company.com" />
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
          <input {...register('password')} type="password" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition" placeholder="••••••••" />
          {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
        </div>
        <div className="flex justify-end">
          <Link href="/auth/forgot-password" className="text-sm text-orange-600 hover:text-orange-700">Forgot password?</Link>
        </div>
        <button type="submit" disabled={loading} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold rounded-lg transition">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-600" /></div>
        <div className="relative flex justify-center text-sm"><span className="px-2 bg-white dark:bg-gray-800 text-gray-500">Or sign in with OTP</span></div>
      </div>

      <div className="space-y-3">
        <input value={phoneOrEmail} onChange={e => setPhoneOrEmail(e.target.value)} type="text" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Mobile number or email" />
        {showOTP && (
          <input value={otp} onChange={e => setOtp(e.target.value)} type="text" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Enter 6-digit OTP" maxLength={6} />
        )}
        <button onClick={showOTP ? loginWithOTP : sendOTP} disabled={loading} className="w-full py-2.5 border-2 border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 font-semibold rounded-lg transition disabled:opacity-50">
          {showOTP ? 'Verify OTP' : 'Send OTP'}
        </button>
      </div>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
        Don&apos;t have an account?{' '}
        <Link href="/auth/register" className="text-orange-600 hover:text-orange-700 font-medium">Sign up free</Link>
      </p>
    </div>
  );
}
