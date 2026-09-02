'use client';

import { cn, getStatusColor } from '@/lib/utils';

interface BadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', getStatusColor(status), className)}>
      {label || status.replace(/_/g, ' ')}
    </span>
  );
}

interface LoadingSpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string; }
export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return (
    <div className={cn('animate-spin rounded-full border-2 border-orange-500 border-t-transparent', { 'w-4 h-4': size === 'sm', 'w-6 h-6': size === 'md', 'w-8 h-8': size === 'lg' }, className)} />
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
        <span className="text-2xl">📭</span>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      {description && <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Button({ children, variant = 'primary', size = 'md', loading, className, ...props }: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed gap-2',
        { 'bg-orange-500 hover:bg-orange-600 text-white': variant === 'primary', 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700': variant === 'secondary', 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300': variant === 'ghost', 'bg-red-500 hover:bg-red-600 text-white': variant === 'danger' },
        { 'px-3 py-1.5 text-sm': size === 'sm', 'px-4 py-2 text-sm': size === 'md', 'px-5 py-2.5': size === 'lg' },
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700', className)}>
      {children}
    </div>
  );
}
