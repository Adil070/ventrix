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

const RegisterSchema = z.object({
  firstName: z.string().min(1, 'First name required'),
  lastName: z.string().min(1, 'Last name required'),
  email: z.string().email('Invalid email'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit mobile').optional().or(z.literal('')),
  password: z.string().min(8, 'Minimum 8 characters'),
  organizationName: z.string().min(1, 'Business name required'),
  gstin: z.string().optional(),
});

type RegisterForm = z.infer<typeof RegisterSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({ resolver: zodResolver(RegisterSchema) });

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true);
    try {
      const res = await api.auth.register(data);
      const { user, organization, accessToken, refreshToken } = res.data.data;
      // Attach organization to user so setAuth can read it
      const userWithOrg = {
        ...user,
        organizations: [{
          organizationId: organization.id,
          role: 'ORG_OWNER',
          organization,
          permissions: [],
        }],
      };
      setAuth(userWithOrg, accessToken, refreshToken);
      toast.success('Account created successfully!');
      router.push('/auth/login');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Create your account</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6">Engineered for Scale — start managing your operations</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
            <input {...register('firstName')} className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Rahul" />
            {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
            <input {...register('lastName')} className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Sharma" />
            {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business Name *</label>
          <input {...register('organizationName')} className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Sharma Traders" />
          {errors.organizationName && <p className="text-red-500 text-xs mt-1">{errors.organizationName.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
          <input {...register('email')} type="email" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="rahul@sharma.com" />
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile Number</label>
          <input {...register('phone')} type="tel" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="9876543210" />
          {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GSTIN (optional)</label>
          <input {...register('gstin')} className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none uppercase" placeholder="22AAAAA0000A1Z5" maxLength={15} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password *</label>
          <input {...register('password')} type="password" className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" placeholder="Min. 8 characters" />
          {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
        </div>
        <button type="submit" disabled={loading} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold rounded-lg transition">
          {loading ? 'Creating account...' : 'Create Free Account'}
        </button>
      </form>

      <p className="text-center text-xs text-gray-400 mt-4">
        By signing up, you agree to our Terms of Service and Privacy Policy
      </p>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
        Already have an account?{' '}
        <Link href="/auth/login" className="text-orange-600 hover:text-orange-700 font-medium">Sign in</Link>
      </p>
    </div>
  );
}
