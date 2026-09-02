'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, StatusBadge } from '@/components/shared';
import { Star, Check, Zap, Crown } from 'lucide-react';

const plans = [
  { key: 'FREE', name: 'Free', price: '₹0', period: '/month', features: ['1 User', 'Up to 100 invoices/month', 'Basic GST filing', 'Basic reports', '500MB storage'], icon: Star, color: 'gray' },
  { key: 'BASIC', name: 'Basic', price: '₹599', period: '/month', features: ['3 Users', 'Unlimited invoices', 'Full GST (GSTR-1, 3B)', 'Advanced reports', '5GB storage', 'Email support'], icon: Zap, color: 'blue', popular: false },
  { key: 'PREMIUM', name: 'Premium', price: '₹1,499', period: '/month', features: ['10 Users', 'Everything in Basic', 'CRM & Lead management', 'Manufacturing', 'Employee management', '25GB storage', 'Priority support', 'API access'], icon: Star, color: 'orange', popular: true },
  { key: 'ENTERPRISE', name: 'Enterprise', price: '₹4,999', period: '/month', features: ['Unlimited Users', 'Everything in Premium', 'Custom integrations', 'Dedicated account manager', 'Unlimited storage', 'White-labeling', 'SLA guarantee'], icon: Crown, color: 'purple' },
];

export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['subscription'], queryFn: () => api.subscription.get(), select: r => r.data.data });

  const upgradeMut = useMutation({
    mutationFn: (plan: string) => api.subscription.upgrade({ plan }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscription'] }); toast.success('Plan upgraded!'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Upgrade failed'),
  });

  const cancelMut = useMutation({
    mutationFn: () => api.subscription.cancel(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscription'] }); toast.success('Subscription cancelled'); },
  });

  const currentPlan = data?.subscription?.plan || 'FREE';

  return (
    <div className="space-y-8">
      <PageHeader title="Subscription" subtitle="Manage your plan and billing" />

      {/* Current Plan */}
      {!isLoading && data?.subscription && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Current Plan</p>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{currentPlan}</h3>
              {data.subscription.validUntil && <p className="text-sm text-gray-500 mt-1">Valid until {formatDate(data.subscription.validUntil)}</p>}
            </div>
            <StatusBadge status={data.subscription.status || 'ACTIVE'} />
          </div>
          {currentPlan !== 'FREE' && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="danger" size="sm" onClick={() => { if (confirm('Cancel subscription?')) cancelMut.mutate(); }}>Cancel Subscription</Button>
            </div>
          )}
        </Card>
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map(plan => {
          const Icon = plan.icon;
          const isCurrent = currentPlan === plan.key;
          return (
            <div key={plan.key} className={`relative rounded-2xl border-2 p-6 flex flex-col ${plan.popular ? 'border-orange-500 shadow-lg shadow-orange-100 dark:shadow-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'} ${isCurrent ? 'bg-gray-50 dark:bg-gray-800' : 'bg-white dark:bg-gray-800'}`}>
              {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-bold px-4 py-1 rounded-full">Most Popular</div>}
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${plan.color === 'orange' ? 'bg-orange-100 dark:bg-orange-900/30' : plan.color === 'blue' ? 'bg-blue-100 dark:bg-blue-900/30' : plan.color === 'purple' ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                <Icon className={`w-6 h-6 ${plan.color === 'orange' ? 'text-orange-600' : plan.color === 'blue' ? 'text-blue-600' : plan.color === 'purple' ? 'text-purple-600' : 'text-gray-600'}`} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{plan.price}</span>
                <span className="text-gray-500 text-sm">{plan.period}</span>
              </div>
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="w-full py-2 text-center text-sm font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-lg">Current Plan</div>
              ) : plan.key !== 'FREE' ? (
                <Button className="w-full" variant={plan.popular ? 'primary' : 'secondary'} loading={upgradeMut.isPending} onClick={() => upgradeMut.mutate(plan.key)}>
                  Upgrade to {plan.name}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
