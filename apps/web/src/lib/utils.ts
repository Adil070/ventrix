import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, currency = 'INR'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num || 0);
}

export function formatNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return new Intl.NumberFormat('en-IN').format(n || 0);
}

export function formatDate(date: string | Date | null | undefined, fmt = 'dd MMM yyyy'): string {
  if (!date) return '-';
  return format(new Date(date), fmt);
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '-';
  return format(new Date(date), 'dd MMM yyyy, hh:mm a');
}

export function timeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    CONFIRMED: 'bg-blue-100 text-blue-700',
    PAID: 'bg-green-100 text-green-700',
    PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700',
    OVERDUE: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-red-100 text-red-700',
    ACTIVE: 'bg-green-100 text-green-700',
    INACTIVE: 'bg-gray-100 text-gray-700',
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
    NEW: 'bg-blue-100 text-blue-700',
    WON: 'bg-green-100 text-green-700',
    LOST: 'bg-red-100 text-red-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}

export function truncate(str: string, length = 30): string {
  return str?.length > length ? `${str.slice(0, length)}...` : str;
}

export function generateInitials(firstName: string, lastName?: string): string {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>;
  return function (...args: Parameters<T>) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
