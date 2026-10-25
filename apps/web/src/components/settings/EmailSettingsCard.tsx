'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Card, LoadingSpinner } from '@/components/shared';

type Provider = 'gmail' | 'custom';
interface Form { provider: Provider; username: string; password: string; fromName: string; fromEmail: string; host: string; port: string; secure: boolean }

const EMPTY: Form = { provider: 'gmail', username: '', password: '', fromName: '', fromEmail: '', host: '', port: '587', secure: false };
const errMsg = (e: any, fallback: string) => e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || fallback;

// The business's own sending account. Until it is set up and tested, emails go from the platform account
// under the business's name. The password is write-only: the API never sends it back.
export function EmailSettingsCard({ businessName }: { businessName?: string }) {
  const qc = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['email-settings'],
    queryFn: () => api.organization.emailSettings.get(),
    select: r => r.data.data,
    retry: false,
  });
  const [form, setForm] = useState<Form>(EMPTY);

  useEffect(() => {
    if (!settings?.configured) return;
    setForm({
      provider: settings.provider, username: settings.username, password: '', fromName: settings.fromName ?? '',
      fromEmail: settings.fromEmail ?? '', host: settings.host, port: String(settings.port), secure: settings.secure,
    });
  }, [settings]);

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  const done = (msg: string) => (r: any) => { qc.setQueryData(['email-settings'], r); toast.success(r?.data?.message || msg); };

  const saveMut = useMutation({
    mutationFn: () => api.organization.emailSettings.save({
      provider: form.provider,
      username: form.username.trim(),
      password: form.password || undefined,
      fromName: form.fromName.trim() || undefined,
      ...(form.provider === 'custom' && { host: form.host.trim(), port: Number(form.port), secure: form.secure, fromEmail: form.fromEmail.trim() }),
    }),
    onSuccess: r => { done('Saved')(r); set({ password: '' }); },
    onError: e => toast.error(errMsg(e, 'Could not save')),
  });
  const testMut = useMutation({
    mutationFn: () => api.organization.emailSettings.test(),
    onSuccess: done('Test email sent'),
    onError: e => { toast.error(errMsg(e, 'Test failed')); qc.invalidateQueries({ queryKey: ['email-settings'] }); },
  });
  const removeMut = useMutation({
    mutationFn: () => api.organization.emailSettings.remove(),
    onSuccess: r => { done('Removed')(r); setForm(EMPTY); },
    onError: e => toast.error(errMsg(e, 'Could not remove')),
  });

  if (isLoading) return <Card className="p-6 flex justify-center"><LoadingSpinner /></Card>;
  if ((error as any)?.response?.status === 403) {
    return <Card className="p-6 text-sm text-gray-500">Only the business owner or an admin can change email settings.</Card>;
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';
  const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const verified = settings?.configured && settings.verifiedAt;

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Email</h3>
        <p className="text-sm text-gray-500">Send sales reports (and later invoices and reminders to customers) from your own email address.</p>
      </div>

      {/* Where emails go from right now */}
      <div className={cn('rounded-lg p-3 text-sm flex gap-2', verified ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300' : settings?.lastError ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300')}>
        {verified ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : settings?.lastError ? <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
        <div>
          {verified
            ? <>Emails are sent from <strong>{settings.fromEmail}</strong>.</>
            : <>Emails are sent by Ventrix ({settings?.platformFrom}) under your business name{settings?.configured ? '. Send a test email to switch to your address.' : '.'}</>}
          {settings?.lastError && <p className="mt-1">{settings.lastError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 max-w-md">
        {(['gmail', 'custom'] as Provider[]).map(p => (
          <button key={p} type="button" onClick={() => set({ provider: p })}
            className={cn('py-2 rounded-lg border-2 text-sm font-medium transition', form.provider === p ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
            {p === 'gmail' ? 'Gmail' : 'Other provider'}
          </button>
        ))}
      </div>

      <form onSubmit={e => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4 max-w-xl">
        {form.provider === 'gmail' ? (
          <>
            <div><label className={label}>Gmail address</label><input value={form.username} onChange={e => set({ username: e.target.value })} type="email" className={inputCls} placeholder="yourshop@gmail.com" /></div>
            <div>
              <label className={label}>App password</label>
              <input value={form.password} onChange={e => set({ password: e.target.value })} type="password" autoComplete="new-password" className={inputCls} placeholder={settings?.configured ? 'Saved. Type a new one to change it' : 'xxxx xxxx xxxx xxxx'} />
              <p className="text-xs text-gray-500 mt-1">
                Not your Gmail password. Turn on 2-Step Verification, then create one at{' '}
                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-orange-600 hover:underline">myaccount.google.com/apppasswords</a>.
              </p>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1"><label className={label}>Mail server (SMTP)</label><input value={form.host} onChange={e => set({ host: e.target.value })} className={inputCls} placeholder="smtp-relay.brevo.com" /></div>
            <div><label className={label}>Port</label><input value={form.port} onChange={e => { const port = e.target.value; set({ port, secure: port === '465' }); }} inputMode="numeric" className={inputCls} /></div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={form.secure} onChange={e => set({ secure: e.target.checked })} /> Use SSL (usually on for port 465, off for 587)</label>
            <div><label className={label}>Username</label><input value={form.username} onChange={e => set({ username: e.target.value })} className={inputCls} /></div>
            <div><label className={label}>Password</label><input value={form.password} onChange={e => set({ password: e.target.value })} type="password" autoComplete="new-password" className={inputCls} placeholder={settings?.configured ? 'Saved. Type to change' : ''} /></div>
            <div className="col-span-2"><label className={label}>Send from (email)</label><input value={form.fromEmail} onChange={e => set({ fromEmail: e.target.value })} type="email" className={inputCls} placeholder="Leave blank to use the username" /></div>
          </div>
        )}
        <div><label className={label}>Sender name</label><input value={form.fromName} onChange={e => set({ fromName: e.target.value })} className={inputCls} placeholder={businessName || 'Your business name'} /></div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" loading={saveMut.isPending}>Save</Button>
          {settings?.configured && <Button type="button" variant="secondary" onClick={() => testMut.mutate()} loading={testMut.isPending}>Send test email</Button>}
          {settings?.configured && (
            <Button type="button" variant="ghost" onClick={() => { if (confirm('Stop using your own email? Emails will be sent by Ventrix again.')) removeMut.mutate(); }} loading={removeMut.isPending}>
              Use Ventrix instead
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-400">The test email goes to your own login email. Your password is stored encrypted and is never shown again.</p>
      </form>
    </Card>
  );
}
