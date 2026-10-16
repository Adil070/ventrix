'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowRight, AlertTriangle, BarChart3, Check, Circle, Receipt, X } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { EXPERIENCES, type Experience, BILL_STATUS_TEXT, plural } from '@/lib/business';
import { QUICK_ACTIONS } from '@/lib/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useOrgSettings } from '@/hooks/useOrganization';
import { Card, StatusBadge, LoadingSpinner } from '@/components/shared';

const PRIMARY_ACTIONS = QUICK_ACTIONS.slice(0, 4);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function ExperiencePicker({ onPick, saving, current }: { onPick: (e: Experience) => void; saving: boolean; current?: Experience }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {EXPERIENCES.map(e => (
        <button
          key={e.key}
          disabled={saving}
          onClick={() => onPick(e.key)}
          className={cn(
            'text-left p-4 rounded-xl border-2 transition hover:border-orange-400 disabled:opacity-60',
            current === e.key ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800',
          )}
        >
          <p className="font-semibold text-gray-900 dark:text-white">{e.title}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{e.description}</p>
          <p className="text-xs text-gray-400 mt-2">e.g. {e.example}</p>
        </button>
      ))}
    </div>
  );
}

function SetupGuide({ hasSale, hasPurchase }: { hasSale: boolean; hasPurchase: boolean }) {
  const { org, hasChosenExperience, experience, updateSettings, isSaving } = useOrgSettings();

  const steps = [
    { done: hasChosenExperience, title: 'Tell us how you work', body: 'We’ll show only the tools you need. You can change this any time in Settings.' },
    { done: !!(org?.gstin || org?.phone || org?.address?.line1), title: 'Add your business details', body: 'Your phone, address and GSTIN get printed on every bill.', href: '/settings', cta: 'Add details' },
    { done: hasSale, title: 'Make your first sale', body: 'Type the customer and item names. New ones are saved for you as you go.', href: '/billing/invoices/new', cta: 'New sale' },
    { done: hasPurchase, title: 'Record a purchase', body: 'Bought stock? Recording it keeps your stock count and supplier dues right.', href: '/purchases/new', cta: 'New purchase' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const current = steps.findIndex(s => !s.done);

  const pick = async (e: Experience) => {
    try {
      await updateSettings({ experience: e });
      toast.success('Menu updated for your business');
    } catch {
      toast.error('Could not save. Please try again.');
    }
  };

  return (
    <Card className="p-5 border-orange-200 dark:border-orange-900">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">Get started: {doneCount} of {steps.length} done</h2>
          <p className="text-sm text-gray-500">A few minutes now, and daily billing takes seconds.</p>
        </div>
        <button onClick={() => updateSettings({ setupGuideHidden: true }).catch(() => toast.error('Only the business owner can hide the guide'))} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Hide setup guide" title="Hide setup guide">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 mb-4 overflow-hidden">
        <div className="h-full bg-orange-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn('flex gap-3', i !== current && 'opacity-80')}>
            {s.done
              ? <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0"><Check className="w-3.5 h-3.5" /></span>
              : <Circle className={cn('w-6 h-6 flex-shrink-0', i === current ? 'text-orange-500' : 'text-gray-300')} />}
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-medium', s.done ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white')}>{s.title}</p>
              {i === current && (
                <div className="mt-1 space-y-3">
                  <p className="text-sm text-gray-500">{s.body}</p>
                  {i === 0
                    ? <ExperiencePicker onPick={pick} saving={isSaving} current={hasChosenExperience ? experience : undefined} />
                    : s.href && <Link href={s.href} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium">{s.cta} <ArrowRight className="w-3.5 h-3.5" /></Link>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Figure({ label, value, sub, href, tone = 'default' }: { label: string; value: string; sub?: string; href?: string; tone?: 'default' | 'good' | 'warn' }) {
  const body = (
    <Card className={cn('p-4 h-full', href && 'hover:shadow-md hover:border-gray-300 transition')}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', tone === 'good' ? 'text-green-600' : tone === 'warn' ? 'text-red-600' : 'text-gray-900 dark:text-white')}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">{sub}{href && <ArrowRight className="w-3 h-3" />}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function HomeDashboard() {
  const user = useAuthStore(s => s.user);
  const { org, settings, experience, isLoading: orgLoading } = useOrgSettings();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard.getSummary(),
    select: r => r.data.data,
    refetchInterval: 120_000,
  });

  const kpis = data?.kpis;
  const recentInvoices: any[] = data?.recentActivity?.invoices || [];
  const recentPurchases: any[] = data?.recentActivity?.purchases || [];
  const chartData = (data?.trends?.monthly || []).map((m: any) => ({
    month: new Date(m.month).toLocaleDateString('en-IN', { month: 'short' }),
    sales: Number(m.sales || 0),
  }));

  const hasSale = (org?._count?.invoices ?? recentInvoices.length) > 0;
  const hasPurchase = recentPurchases.length > 0;
  const showGuide = !orgLoading && !isLoading && !settings.setupGuideHidden &&
    !(settings.experience && (org?.gstin || org?.phone || org?.address?.line1) && hasSale && hasPurchase);

  const receivable = kpis?.outstandingReceivables?.amount || 0;
  const payable = kpis?.outstandingPayables?.amount || 0;
  const lowStock = kpis?.lowStockAlerts || 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{greeting()}{user?.firstName ? `, ${user.firstName}` : ''}</h1>
        <p className="text-gray-500 text-sm">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* What most people come here to do */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PRIMARY_ACTIONS.map((a, i) => (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              'group p-4 rounded-xl border transition flex flex-col gap-3',
              i === 0
                ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-orange-300 hover:shadow-sm',
            )}
          >
            <a.icon className={cn('w-6 h-6', i === 0 ? 'text-white' : 'text-orange-500')} />
            <span>
              <span className={cn('block font-semibold', i === 0 ? 'text-white' : 'text-gray-900 dark:text-white')}>{a.label}</span>
              <span className={cn('block text-xs mt-0.5', i === 0 ? 'text-orange-100' : 'text-gray-500')}>{a.description}</span>
            </span>
          </Link>
        ))}
      </div>

      {showGuide && <SetupGuide hasSale={hasSale} hasPurchase={hasPurchase} />}

      {/* Today, in plain words */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Sold today" value={formatCurrency(kpis?.salesToday?.amount || 0)} sub={plural(kpis?.salesToday?.count || 0, 'bill')} href="/billing/invoices" />
        <Figure label="Customers owe you" value={formatCurrency(receivable)} sub={receivable ? `${plural(kpis?.outstandingReceivables?.count || 0, 'unpaid bill')} · see who` : 'All collected'} href="/reports?type=outstanding" tone={receivable ? 'warn' : 'good'} />
        <Figure label="You owe suppliers" value={formatCurrency(payable)} sub={payable ? `${plural(kpis?.outstandingPayables?.count || 0, 'bill')} to pay` : 'Nothing due'} href="/reports?type=outstanding" />
        <Figure label="This month’s sales" value={formatCurrency(kpis?.salesThisMonth?.amount || 0)} sub={`${formatCurrency(kpis?.salesThisMonth?.collected || 0)} collected`} href="/reports?type=sales" />
      </div>

      {lowStock > 0 && (
        <Link href="/products" className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 hover:border-amber-300">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300 flex-1"><strong>{lowStock} {lowStock === 1 ? 'item is' : 'items are'} running low.</strong> Time to reorder.</p>
          <span className="text-sm font-semibold text-amber-700 whitespace-nowrap">See items →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">Recent sales</h2>
            <Link href="/billing/invoices" className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">All sales <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">{Array(4).fill(0).map((_, i) => <div key={i} className="h-11 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" />)}</div>
          ) : recentInvoices.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No sales yet.</p>
              <Link href="/billing/invoices/new" className="mt-2 inline-block text-orange-600 font-medium hover:underline">Make your first sale →</Link>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentInvoices.map((inv: any) => (
                <li key={inv.id}>
                  <Link href={`/billing/invoices/${inv.id}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 -mx-2 px-2 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inv.customer?.name || 'Walk-in customer'}</p>
                      <p className="text-xs text-gray-500">{inv.invoiceNumber} · {formatDate(inv.invoiceDate)}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(inv.totalAmount)}</span>
                    <StatusBadge status={inv.status} label={BILL_STATUS_TEXT[inv.status]} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 dark:text-white">This month</h2>
          {[
            { label: 'Sales', value: kpis?.salesThisMonth?.amount || 0 },
            { label: 'Money collected', value: kpis?.salesThisMonth?.collected || 0 },
            { label: 'Purchases', value: kpis?.purchasesThisMonth?.amount || 0 },
            { label: 'Expenses', value: kpis?.expenses?.amount || 0 },
            ...(org?.gstin ? [{ label: 'GST on sales', value: kpis?.gstLiability || 0 }] : []),
          ].map(row => (
            <div key={row.label} className="flex justify-between text-sm">
              <span className="text-gray-500">{row.label}</span>
              <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(row.value)}</span>
            </div>
          ))}
          <Link href="/reports" className="block pt-2 text-sm text-orange-600 hover:text-orange-700">Full reports →</Link>
        </Card>
      </div>

      {experience !== 'simple' && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">Sales, last 6 months</h2>
            <Link href="/analytics" className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">Analytics <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {isLoading ? <div className="h-56 flex items-center justify-center"><LoadingSpinner size="lg" /></div> : chartData.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
              <BarChart3 className="w-8 h-8 opacity-30" />
              <p>Your sales trend will appear here after your first sale.</p>
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
      )}
    </div>
  );
}

