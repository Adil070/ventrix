'use client';

import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: 'orange' | 'blue' | 'green' | 'red' | 'purple';
  loading?: boolean;
}

const colorMap = {
  orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', icon: 'text-orange-600 dark:text-orange-400', ring: 'bg-orange-100 dark:bg-orange-900/40' },
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',   icon: 'text-blue-600 dark:text-blue-400',   ring: 'bg-blue-100 dark:bg-blue-900/40' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20', icon: 'text-green-600 dark:text-green-400', ring: 'bg-green-100 dark:bg-green-900/40' },
  red:    { bg: 'bg-red-50 dark:bg-red-900/20',     icon: 'text-red-600 dark:text-red-400',     ring: 'bg-red-100 dark:bg-red-900/40' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', icon: 'text-purple-600 dark:text-purple-400', ring: 'bg-purple-100 dark:bg-purple-900/40' },
};

export function StatCard({ title, value, subtitle, icon: Icon, trend, color = 'orange', loading }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 animate-pulse rounded mt-2" />
          ) : (
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
          )}
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          {trend && (
            <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', trend.value >= 0 ? 'text-green-600' : 'text-red-500')}>
              <span>{trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%</span>
              <span className="text-gray-400 font-normal">{trend.label}</span>
            </div>
          )}
        </div>
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', c.ring)}>
          <Icon className={cn('w-5 h-5', c.icon)} />
        </div>
      </div>
    </div>
  );
}
