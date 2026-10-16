'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Card, EmptyState, StatusBadge } from '@/components/shared';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#eab308'];

// Raw SQL rows carry `month` as a DATE_TRUNC timestamp (UTC), e.g. "2026-09-01T00:00:00.000Z".
const monthKey = (v: string | Date) => { const d = new Date(v); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
// The last `n` month keys ending with the current month, oldest first (matches the API's windows).
function lastMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
}
const sumByMonth = (rows: any[] | undefined, field: string) => {
  const map: Record<string, number> = {};
  for (const r of rows || []) map[monthKey(r.month)] = (map[monthKey(r.month)] || 0) + Number(r[field] || 0);
  return map;
};

export default function AnalyticsPage() {
  const revenueMonths = lastMonths(12);
  const cashMonths = lastMonths(6);

  // GET /analytics/revenue → data: [{ month, revenue, collected, gst, invoices }] (last 12 months, only months with sales)
  const { data: revenueRows } = useQuery({ queryKey: ['analytics-revenue'], queryFn: () => api.analytics.getRevenue({ period: '12months' }), select: r => (r.data.data || []) as any[] });
  // GET /analytics/products → { topByRevenue: [{ productId, _sum: { quantity, amount }, product }], topByQuantity, categoryBreakdown: [{ category, revenue, quantity }] } (1 Jan → today)
  const { data: products } = useQuery({ queryKey: ['analytics-products'], queryFn: () => api.analytics.getProducts(), select: r => r.data.data });
  // GET /analytics/customers → { topCustomers, newVsReturning: { new_customers, active_customers }, customerGrowth: [{ month, count }] } for the same 12-month window
  const { data: customers } = useQuery({ queryKey: ['analytics-customers', revenueMonths[0]], queryFn: () => api.analytics.getCustomers({ fromDate: `${revenueMonths[0]}-01` }), select: r => r.data.data });
  // GET /customers → { customers, total } — only the count is needed
  const { data: totalCustomers } = useQuery({ queryKey: ['customers-count'], queryFn: () => api.customers.list({ limit: 1 }), select: r => Number(r.data.data?.total || 0) });
  // GET /analytics/cash-flow → { inflows: [{ month, amount }], outflows: [...], expenses: [...] } (last 6 months)
  const { data: cashFlow } = useQuery({ queryKey: ['analytics-cashflow'], queryFn: () => api.analytics.getCashFlow({ months: 6 }), select: r => r.data.data });

  const revenueByMonth = sumByMonth(revenueRows, 'revenue');
  const revenueChart = revenueMonths.map(k => ({ month: monthLabel(k), revenue: revenueByMonth[k] || 0 }));
  const revenue12m = revenueChart.reduce((s, r) => s + r.revenue, 0);

  const inflows = sumByMonth(cashFlow?.inflows, 'amount');
  const outflows = sumByMonth(cashFlow?.outflows, 'amount');
  const expenses = sumByMonth(cashFlow?.expenses, 'amount');
  const cashChart = cashMonths.map(k => ({ month: monthLabel(k), inflows: inflows[k] || 0, outflows: outflows[k] || 0, expenses: expenses[k] || 0 }));

  const topProducts: any[] = (products?.topByRevenue || []).filter((p: any) => Number(p._sum?.amount || 0) > 0);
  const topAmount = Number(topProducts[0]?._sum?.amount || 0) || 1;
  const categories = (products?.categoryBreakdown || []).map((c: any) => ({ category: c.category || 'Uncategorised', revenue: Number(c.revenue || 0) })).filter((c: any) => c.revenue > 0);

  const thisMonth = revenueMonths[revenueMonths.length - 1];
  const newThisMonth = (customers?.customerGrowth || []).filter((g: any) => monthKey(g.month) === thisMonth).reduce((s: number, g: any) => s + Number(g.count || 0), 0);
  const activeCustomers = Number(customers?.newVsReturning?.active_customers || 0);
  // active_customers counts named customers only, so leave walk-in (no customer) sales out of the average.
  const walkInRevenue = Number((customers?.topCustomers || []).find((c: any) => !c.customerId)?._sum?.totalAmount || 0);
  const avgRevenuePerCustomer = activeCustomers ? Math.max(0, revenue12m - walkInRevenue) / activeCustomers : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Business insights and performance metrics" />

      {/* Revenue Trend */}
      <Card className="p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Revenue Trend (12 months)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={revenueChart}>
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
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Top Products by Revenue <span className="text-sm font-normal text-gray-500">(this year)</span></h3>
          <div className="space-y-3">
            {topProducts.slice(0, 8).map((p: any, i: number) => {
              const amount = Number(p._sum?.amount || 0);
              return (
                <div key={p.productId ?? i} className="flex items-center gap-3">
                  <span className="w-6 text-xs text-gray-400 font-medium">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-900 dark:text-white truncate">{p.product?.name || 'Other items'}</span><span className="font-semibold ml-2">{formatCurrency(amount)}</span></div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full"><div className="h-1.5 bg-orange-500 rounded-full" style={{ width: `${Math.min(100, (amount / topAmount) * 100)}%` }} /></div>
                    <p className="text-xs text-gray-400 mt-0.5">{Number(p._sum?.quantity || 0)} sold</p>
                  </div>
                </div>
              );
            })}
            {products && !topProducts.length && <EmptyState title="No data" description="Sales data will appear here" />}
          </div>
        </Card>

        {/* Category Breakdown */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Sales by Category <span className="text-sm font-normal text-gray-500">(this year)</span></h3>
          {categories.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categories} dataKey="revenue" nameKey="category" cx="50%" cy="50%" outerRadius={80} label={({ category, percent }: any) => `${category} (${(percent*100).toFixed(0)}%)`}>
                  {categories.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No data" description="Category data will appear here" />}
        </Card>

        {/* Cash Flow */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Cash Flow (last 6 months)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cashChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="inflows" fill="#10b981" name="Received from customers" />
              <Bar dataKey="outflows" fill="#ef4444" name="Paid to suppliers" />
              <Bar dataKey="expenses" fill="#f97316" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Customer Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5"><p className="text-sm text-gray-500">Total Customers</p><p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{totalCustomers || 0}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">New This Month</p><p className="text-3xl font-bold text-green-600 mt-1">{newThisMonth}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">Avg. Sales per Buying Customer</p><p className="text-3xl font-bold text-orange-600 mt-1">{formatCurrency(avgRevenuePerCustomer)}</p><p className="text-xs text-gray-400 mt-1">{activeCustomers} {activeCustomers === 1 ? 'customer' : 'customers'} bought in the last 12 months</p></Card>
      </div>
    </div>
  );
}
