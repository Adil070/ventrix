'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Card, EmptyState, StatusBadge } from '@/components/shared';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#eab308'];

export default function AnalyticsPage() {
  const { data: revenue } = useQuery({ queryKey: ['analytics-revenue'], queryFn: () => api.analytics.getRevenue(), select: r => r.data.data });
  const { data: products } = useQuery({ queryKey: ['analytics-products'], queryFn: () => api.analytics.getProducts(), select: r => r.data.data });
  const { data: customers } = useQuery({ queryKey: ['analytics-customers'], queryFn: () => api.analytics.getCustomers(), select: r => r.data.data });
  const { data: cashFlow } = useQuery({ queryKey: ['analytics-cashflow'], queryFn: () => api.analytics.getCashFlow(), select: r => r.data.data });

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Business insights and performance metrics" />

      {/* Revenue Trend */}
      <Card className="p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Revenue Trend (12 months)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={revenue?.monthly || []}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.3} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: any) => [formatCurrency(v), 'Revenue']} />
            <Area type="monotone" dataKey="revenue" stroke="#f97316" strokeWidth={2} fill="url(#revGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Top Products by Revenue</h3>
          <div className="space-y-3">
            {(products?.topByRevenue || []).slice(0, 8).map((p: any, i: number) => (
              <div key={p.productId} className="flex items-center gap-3">
                <span className="w-6 text-xs text-gray-400 font-medium">{i+1}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-900 dark:text-white truncate">{p.product?.name}</span><span className="font-semibold ml-2">{formatCurrency(p._sum?.totalPrice || 0)}</span></div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full"><div className="h-1.5 bg-orange-500 rounded-full" style={{ width: `${Math.min(100, ((p._sum?.totalPrice || 0) / (products?.topByRevenue?.[0]?._sum?.totalPrice || 1)) * 100)}%` }} /></div>
                </div>
              </div>
            ))}
            {!products?.topByRevenue?.length && <EmptyState title="No data" description="Sales data will appear here" />}
          </div>
        </Card>

        {/* Category Breakdown */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Sales by Category</h3>
          {products?.categoryBreakdown?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={products.categoryBreakdown} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={80} label={({ category, percent }: any) => `${category} (${(percent*100).toFixed(0)}%)`}>
                  {products.categoryBreakdown.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No data" description="Category data will appear here" />}
        </Card>

        {/* Cash Flow */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Cash Flow (monthly)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cashFlow?.monthly || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="inflows" fill="#10b981" name="Inflows" />
              <Bar dataKey="outflows" fill="#ef4444" name="Outflows" />
              <Bar dataKey="expenses" fill="#f97316" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Customer Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5"><p className="text-sm text-gray-500">Total Customers</p><p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{customers?.totalCustomers || 0}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">New This Month</p><p className="text-3xl font-bold text-green-600 mt-1">{customers?.newThisMonth || 0}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">Avg. Revenue/Customer</p><p className="text-3xl font-bold text-orange-600 mt-1">{formatCurrency(customers?.avgRevenuePerCustomer || 0)}</p></Card>
      </div>
    </div>
  );
}
