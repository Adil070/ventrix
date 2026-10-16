'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bell, CheckCheck, Trash2, Info, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader, Button, Card } from '@/components/shared';
import { cn } from '@/lib/utils';

// Notification rows: { id, type (IN_APP/EMAIL/SMS/WHATSAPP/PUSH = delivery channel), title, body, metadata, isRead, createdAt }.
// Severity is not a column, so an optional metadata.level (SUCCESS/WARNING/ERROR/INFO) picks the icon.
const typeConfig = {
  SUCCESS: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
  WARNING: { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
  ERROR:   { icon: XCircle,     color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  INFO:    { icon: Info,        color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // GET /notifications -> { data: { notifications, unreadCount, total } } (not paginatedResponse)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => api.notifications.list({ limit: 100, ...(filter === 'unread' && { isRead: false }) }),
    select: r => ({ notifications: (r.data.data?.notifications ?? []) as any[], unreadCount: Number(r.data.data?.unreadCount ?? 0) }),
  });
  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const onError = (e: any) => toast.error(e?.response?.data?.message || 'Something went wrong');
  const markAllMut = useMutation({ mutationFn: () => api.notifications.markAllRead(), onSuccess: refresh, onError });
  const markReadMut = useMutation({ mutationFn: (id: string) => api.notifications.markRead(id), onSuccess: refresh, onError });
  const deleteMut = useMutation({ mutationFn: (id: string) => api.notifications.delete(id), onSuccess: refresh, onError });

  const markAllRead = () => markAllMut.mutate();
  const markRead = (n: any) => { if (!n.isRead) markReadMut.mutate(n.id); };
  const deleteOne = (id: string) => deleteMut.mutate(id);

  const filtered = notifications;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title="Notifications"
        subtitle={isLoading ? 'Loading…' : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
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
              <Button variant="secondary" size="sm" onClick={markAllRead} loading={markAllMut.isPending}>
                <CheckCheck className="w-4 h-4" /> Mark all read
              </Button>
            )}
          </div>
        }
      />

      <Card>
        {isLoading ? (
          <div className="space-y-3 p-4">{Array(4).fill(0).map((_, i) => <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" />)}</div>
        ) : isError ? (
          <div className="py-16 text-center text-sm text-gray-500">Could not load notifications. Please refresh the page.</div>
        ) : filtered.length === 0 ? (
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
              const cfg = typeConfig[n.metadata?.level as keyof typeof typeConfig] || typeConfig.INFO;
              const Icon = cfg.icon;
              return (
                <li
                  key={n.id}
                  className={cn('flex gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition cursor-pointer group', !n.isRead && 'bg-orange-50/50 dark:bg-orange-900/5')}
                  onClick={() => markRead(n)}
                >
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                    <Icon className={cn('w-5 h-5', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm font-semibold', !n.isRead ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
                        {n.title}
                        {!n.isRead && <span className="ml-2 inline-block w-2 h-2 bg-orange-500 rounded-full align-middle" />}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteOne(n.id); }}
                        aria-label="Delete notification"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition text-gray-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
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
