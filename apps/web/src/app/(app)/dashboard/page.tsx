'use client';

import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatCard } from '@/components/shared/StatCard';
import { Card, StatusBadge, LoadingSpinner, PageHeader } from '@/components/shared';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import {
  TrendingUp, DollarSign, Users, RefreshCw,
  Building2, Globe, ShieldCheck,
} from 'lucide-react';
import { HomeDashboard } from '@/components/home/HomeDashboard';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b'];

const planColor: Record<string, string> = {
  FREE: 'bg-gray-100 text-gray-600',
  BASIC: 'bg-blue-100 text-blue-700',
  PREMIUM: 'bg-orange-100 text-orange-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};

// ─────────────────────────────────────────────────────────────────────────────
// Super-Admin Platform Dashboard
// ─────────────────────────────────────────────────────────────────────────────
function SuperAdminDashboard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-admin'],
    queryFn: () => api.dashboard.getAdminStats(),
    select: r => r.data.data,
    refetchInterval: 60_000,
  });

  const p = data?.platform;

  const platformStats = [
    { title: 'Total Organisations', value: p?.totalOrgs ?? 0, subtitle: `${p?.activeOrgs ?? 0} active`, icon: Building2, color: 'orange' as const },
    { title: 'New This Month', value: p?.newOrgsThisMonth ?? 0, subtitle: 'Org sign-ups', icon: TrendingUp, color: 'green' as const },
    { title: 'Total Users', value: p?.totalUsers ?? 0, subtitle: 'Across all orgs', icon: Users, color: 'blue' as const },
    { title: 'Platform Revenue', value: formatCurrency(p?.totalRevenue ?? 0), subtitle: `${p?.totalInvoices ?? 0} invoices`, icon: DollarSign, color: 'purple' as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Admin Dashboard"
        subtitle="All organisations · real-time"
        actions={
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 text-xs font-bold bg-red-100 text-red-700 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Super Admin
            </span>
            <button onClick={() => refetch()} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {platformStats.map(s => <StatCard key={s.title} {...s} loading={isLoading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Org growth chart */}
        <Card className="lg:col-span-2 p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">New Organisations (Last 30 days)</h2>
          {isLoading ? <div className="h-48 flex items-center justify-center"><LoadingSpinner size="lg" /></div> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data?.revenueByDay || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v?.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={(v: any) => `Date: ${v}`} formatter={(v: any) => [v, 'Orgs joined']} />
                <Bar dataKey="orgs" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Plan breakdown */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Subscription Plans</h2>
          {isLoading ? <div className="h-48 flex items-center justify-center"><LoadingSpinner /></div> : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={data?.planBreakdown || []} dataKey="count" nameKey="plan" cx="50%" cy="50%" outerRadius={60}>
                    {(data?.planBreakdown || []).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {(data?.planBreakdown || []).map((pl: any, i: number) => (
                  <div key={pl.plan} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 dark:text-gray-400">{pl.plan}</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">{pl.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Recent Organisations table */}
      <Card className="overflow-hidden">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Organisations</h2>
          <Globe className="w-4 h-4 text-gray-400" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Organisation', 'Users', 'Plan', 'Status', 'Joined'].map(h =>
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && <tr><td colSpan={5} className="text-center py-8"><LoadingSpinner /></td></tr>}
              {(data?.recentOrgs || []).map((org: any) => (
                <tr key={org.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 font-bold text-xs">
                        {org.name?.[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{org.name}</p>
                        <p className="text-xs text-gray-400">{org.gstin || 'No GSTIN'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{org._count?.users ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${planColor[org.subscription?.plan || 'FREE']}`}>
                      {org.subscription?.plan || 'FREE'}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={org.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(org.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root — switches view based on role
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const user = useAuthStore(s => s.user);
  return user?.isSuperAdmin ? <SuperAdminDashboard /> : <HomeDashboard />;
}
