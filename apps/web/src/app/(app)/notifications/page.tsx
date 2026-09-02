'use client';

import { useState } from 'react';
import { Bell, CheckCheck, Trash2, Info, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { PageHeader, Button, Card } from '@/components/shared';
import { cn } from '@/lib/utils';

const mockNotifications = [
  { id: '1', type: 'SUCCESS', title: 'Invoice paid', message: 'INV-001 worth ₹25,000 has been marked as paid by Sharma Traders.', time: new Date(Date.now() - 5 * 60000).toISOString(), read: false },
  { id: '2', type: 'WARNING', title: 'Invoice overdue', message: 'INV-003 due to Patel Enterprises is 3 days overdue. Send a reminder?', time: new Date(Date.now() - 30 * 60000).toISOString(), read: false },
  { id: '3', type: 'INFO', title: 'Low stock alert', message: 'Product "A4 Paper Ream" has only 5 units remaining in stock.', time: new Date(Date.now() - 2 * 3600000).toISOString(), read: true },
  { id: '4', type: 'SUCCESS', title: 'New customer registered', message: 'Gupta Brothers has been added to your customer list.', time: new Date(Date.now() - 5 * 3600000).toISOString(), read: true },
  { id: '5', type: 'ERROR', title: 'Payment failed', message: 'Recurring payment for subscription could not be processed.', time: new Date(Date.now() - 24 * 3600000).toISOString(), read: true },
  { id: '6', type: 'INFO', title: 'GST return due', message: 'GSTR-1 for the month of May is due on 11th June 2026.', time: new Date(Date.now() - 2 * 24 * 3600000).toISOString(), read: true },
];

const typeConfig = {
  SUCCESS: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
  WARNING: { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
  ERROR:   { icon: XCircle,     color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  INFO:    { icon: Info,        color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(mockNotifications);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  const deleteOne = (id: string) => setNotifications(prev => prev.filter(n => n.id !== id));

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(['all', 'unread'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn('px-3 py-1.5 text-sm font-medium capitalize transition', filter === f ? 'bg-orange-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
                >
                  {f}
                </button>
              ))}
            </div>
            {unreadCount > 0 && (
              <Button variant="secondary" size="sm" onClick={markAllRead}>
                <CheckCheck className="w-4 h-4" /> Mark all read
              </Button>
            )}
          </div>
        }
      />

      <Card>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
              <Bell className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No notifications</h3>
            <p className="text-sm text-gray-500">{filter === 'unread' ? 'You have no unread notifications.' : 'Notifications will appear here.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((n) => {
              const cfg = typeConfig[n.type as keyof typeof typeConfig] || typeConfig.INFO;
              const Icon = cfg.icon;
              return (
                <li
                  key={n.id}
                  className={cn('flex gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition cursor-pointer group', !n.read && 'bg-orange-50/50 dark:bg-orange-900/5')}
                  onClick={() => markRead(n.id)}
                >
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                    <Icon className={cn('w-5 h-5', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm font-semibold', !n.read ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
                        {n.title}
                        {!n.read && <span className="ml-2 inline-block w-2 h-2 bg-orange-500 rounded-full align-middle" />}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteOne(n.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition text-gray-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.time)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
