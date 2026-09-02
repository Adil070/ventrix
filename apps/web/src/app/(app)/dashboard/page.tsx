'use client';

import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { StatCard } from '@/components/shared/StatCard';
import { Card, StatusBadge, LoadingSpinner, PageHeader } from '@/components/shared';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import {
  TrendingUp, DollarSign, ShoppingCart, AlertCircle,
  Users, Receipt, CreditCard, BarChart3, ArrowRight, RefreshCw,
  Building2, FileText, Globe, ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
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
// Org Admin Dashboard
// ─────────────────────────────────────────────────────────────────────────────
function OrgDashboard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard.getSummary(),
    select: r => r.data.data,
    refetchInterval: 120_000,
  });

  // Backend shape: { kpis, trends, recentActivity, topCustomers }
  const kpis = data?.kpis;
  const monthly: any[] = data?.trends?.monthly || [];
  const recentInvoices: any[] = data?.recentActivity?.invoices || [];
  const recentPurchases: any[] = data?.recentActivity?.purchases || [];
  const topCustomers: any[] = data?.topCustomers || [];

  const stats = [
    { title: 'Sales This Month', value: formatCurrency(kpis?.salesThisMonth?.amount || 0), subtitle: `${kpis?.salesThisMonth?.count || 0} invoices · ${formatCurrency(kpis?.salesThisMonth?.collected || 0)} collected`, icon: TrendingUp, color: 'orange' as const, trend: { value: 12, label: 'vs last month' } },
    { title: 'Outstanding Receivables', value: formatCurrency(kpis?.outstandingReceivables?.amount || 0), subtitle: `${kpis?.outstandingReceivables?.count || 0} customers owe you`, icon: DollarSign, color: 'red' as const },
    { title: 'Purchases This Month', value: formatCurrency(kpis?.purchasesThisMonth?.amount || 0), subtitle: `${kpis?.purchasesThisMonth?.count || 0} bills`, icon: ShoppingCart, color: 'blue' as const },
    { title: 'Outstanding Payables', value: formatCurrency(kpis?.outstandingPayables?.amount || 0), subtitle: `${kpis?.outstandingPayables?.count || 0} suppliers`, icon: Receipt, color: 'purple' as const },
    { title: 'Expenses This Month', value: formatCurrency(kpis?.expenses?.amount || 0), subtitle: `${kpis?.expenses?.count || 0} entries`, icon: CreditCard, color: 'orange' as const },
    { title: 'GST Liability', value: formatCurrency(kpis?.gstLiability || 0), subtitle: 'Output tax this month', icon: FileText, color: 'blue' as const },
    { title: 'Low Stock Alerts', value: kpis?.lowStockAlerts || 0, subtitle: 'Items need reorder', icon: AlertCircle, color: 'red' as const },
    { title: 'Sales Today', value: formatCurrency(kpis?.salesToday?.amount || 0), subtitle: `${kpis?.salesToday?.count || 0} invoices`, icon: BarChart3, color: 'green' as const },
  ];

  const chartData = monthly.map(m => ({
    month: new Date(m.month).toLocaleDateString('en-IN', { month: 'short' }),
    sales: Number(m.sales || 0),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Your business overview at a glance"
        actions={
          <button onClick={() => refetch()} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => <StatCard key={s.title} {...s} loading={isLoading} />)}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Revenue Trend (6 months)</h2>
            <Link href="/analytics" className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">Full analytics <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {isLoading ? <div className="h-56 flex items-center justify-center"><LoadingSpinner size="lg" /></div> : chartData.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
              <BarChart3 className="w-10 h-10 opacity-30" />
              <p>No sales data yet. Create your first invoice to see trends.</p>
              <Link href="/billing/invoices/new" className="text-orange-600 font-medium hover:underline">Create invoice →</Link>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => [formatCurrency(v), 'Sales']} />
                <Area type="monotone" dataKey="sales" stroke="#f97316" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Cash flow summary */}
        <Card className="p-5 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">This Month</h2>
          <div className="space-y-3">
            {[
              { label: 'Collected', value: kpis?.salesThisMonth?.collected || 0, max: Math.max(kpis?.salesThisMonth?.amount || 0, 1), color: 'bg-green-500' },
              { label: 'Receivables', value: kpis?.outstandingReceivables?.amount || 0, max: Math.max(kpis?.outstandingReceivables?.amount || 0, 1), color: 'bg-red-400' },
              { label: 'Purchases', value: kpis?.purchasesThisMonth?.amount || 0, max: Math.max(kpis?.purchasesThisMonth?.amount || 0, 1), color: 'bg-blue-500' },
              { label: 'Expenses', value: kpis?.expenses?.amount || 0, max: Math.max(kpis?.expenses?.amount || 0, 1), color: 'bg-orange-400' },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">{item.label}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(item.value)}</span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className={`h-full ${item.color} rounded-full`} style={{ width: `${Math.min(100, (item.value / item.max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700">
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-gray-500">Net Position</span>
              <span className={cn(
                ((kpis?.salesThisMonth?.collected || 0) - (kpis?.purchasesThisMonth?.amount || 0) - (kpis?.expenses?.amount || 0)) >= 0
                  ? 'text-green-600' : 'text-red-600'
              )}>
                {formatCurrency((kpis?.salesThisMonth?.collected || 0) - (kpis?.purchasesThisMonth?.amount || 0) - (kpis?.expenses?.amount || 0))}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Invoices + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Invoices</h2>
            <Link href="/billing/invoices" className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" />)}</div>
          ) : recentInvoices.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No invoices yet.</p>
              <Link href="/billing/invoices/new" className="mt-2 inline-block text-orange-600 font-medium hover:underline">Create your first invoice →</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 dark:border-gray-700">{['Invoice#', 'Customer', 'Date', 'Amount', 'Status'].map(h =>
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase pb-2 pr-4">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {recentInvoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className="py-2 pr-4"><Link href={`/billing/invoices/${inv.id}`} className="font-mono text-orange-600 hover:underline">{inv.invoiceNumber}</Link></td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{inv.customer?.name}</td>
                      <td className="py-2 pr-4 text-gray-500">{formatDate(inv.invoiceDate)}</td>
                      <td className="py-2 pr-4 font-semibold text-gray-900 dark:text-white">{formatCurrency(inv.totalAmount)}</td>
                      <td className="py-2"><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Top Customers</h2>
            <Link href="/customers" className="text-sm text-orange-600 hover:text-orange-700"><ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" />)}</div>
          ) : topCustomers.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No customers yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topCustomers.map((c: any, i: number) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 font-bold text-xs flex-shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</p>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mt-1">
                      <div className="h-1.5 bg-orange-400 rounded-full" style={{ width: `${Math.min(100, ((c.outstandingAmount || 0) / Math.max(topCustomers[0]?.outstandingAmount || 1, 1)) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">{formatCurrency(c.outstandingAmount || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent Purchases */}
      {recentPurchases.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Purchases</h2>
            <Link href="/purchases" className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentPurchases.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/40 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{p.purchaseNumber}</p>
                  <p className="text-xs text-gray-500">{p.supplier?.name} · {formatDate(p.purchaseDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatCurrency(p.totalAmount)}</p>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Low stock warning */}
      {(kpis?.lowStockAlerts || 0) > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300 font-medium">{kpis.lowStockAlerts} products are below reorder level and need restocking.</p>
          </div>
          <Link href="/inventory" className="text-sm font-semibold text-red-600 hover:text-red-700 whitespace-nowrap">View Inventory →</Link>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root — switches view based on role
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const user = useAuthStore(s => s.user);
  return user?.isSuperAdmin ? <SuperAdminDashboard /> : <OrgDashboard />;
}
