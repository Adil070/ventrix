'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import { dropEmpty } from '@/lib/business';
import { useOrgSettings } from '@/hooks/useOrganization';
import { ExperiencePicker } from '@/components/home/HomeDashboard';
import { PageHeader, Button, Card, StatusBadge } from '@/components/shared';
import { Building2, Users, Lock, SlidersHorizontal } from 'lucide-react';

const OrgSchema = z.object({
  name: z.string().min(1),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  cin: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.object({ line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional() }).optional(),
  invoicePrefix: z.string().default('INV'),
  currency: z.string().default('INR'),
  timezone: z.string().default('Asia/Kolkata'),
});

type OrgForm = z.infer<typeof OrgSchema>;
type Tab = 'organization' | 'experience' | 'members' | 'security';
const TABS: Tab[] = ['organization', 'experience', 'members', 'security'];

// The API returns null for empty fields; the form needs strings.
function toFormValues(org: any): OrgForm | undefined {
  if (!org) return undefined;
  const a = org.address || {};
  return {
    name: org.name ?? '', gstin: org.gstin ?? '', pan: org.pan ?? '', cin: org.cin ?? '',
    email: org.email ?? '', phone: org.phone ?? '', website: org.website ?? '',
    address: { line1: a.line1 ?? '', city: a.city ?? '', state: a.state ?? '', pincode: a.pincode ?? '' },
    invoicePrefix: org.invoicePrefix ?? 'INV', currency: org.currency ?? 'INR', timezone: org.timezone ?? 'Asia/Kolkata',
  };
}

const PasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // Same rule the API enforces for every password.
  newPassword: z.string().min(8, 'Use at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Add a capital letter, a small letter, a number and a symbol (@$!%*?&)'),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export default function SettingsPage() {
  const qc = useQueryClient();
  const requested = useSearchParams().get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : 'organization');
  const { org, experience, hasChosenExperience, updateSettings, isSaving } = useOrgSettings();
  const { data: members } = useQuery({ queryKey: ['org-members'], queryFn: () => api.users.getOrgMembers(), select: r => r.data.data, enabled: tab === 'members' });

  const { register: regOrg, handleSubmit: handleOrg, reset: resetOrg } = useForm<OrgForm>({ resolver: zodResolver(OrgSchema), values: toFormValues(org) });
  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd, formState: { errors: pwdErrors } } = useForm<z.infer<typeof PasswordSchema>>({ resolver: zodResolver(PasswordSchema) });

  const updateOrgMut = useMutation({
    mutationFn: (d: OrgForm) => api.organization.update(dropEmpty({ ...d, gstin: d.gstin?.toUpperCase(), pan: d.pan?.toUpperCase() })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['organization'] }); toast.success('Business details saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const changePwdMut = useMutation({
    mutationFn: (d: any) => api.users.changePassword(d),
    onSuccess: () => { toast.success('Password changed. Other devices have been signed out.'); resetPwd(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const settingsTabs = [
    { key: 'organization', label: 'Business details', icon: Building2 },
    { key: 'experience', label: 'App setup', icon: SlidersHorizontal },
    { key: 'members', label: 'Team', icon: Users },
    { key: 'security', label: 'Password', icon: Lock },
  ];

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Set these up once. You rarely need to come back here." />

      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-48 flex-shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {settingsTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key as Tab)} className={`md:w-full whitespace-nowrap flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${tab === t.key ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                <t.icon className="w-4 h-4" />{t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {tab === 'experience' && (
            <Card className="p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-lg">How do you run your business?</h3>
                <p className="text-sm text-gray-500">This decides which tools show in the menu. Nothing is deleted. Hidden tools stay under “More tools” and in search (Ctrl+K).</p>
              </div>
              <ExperiencePicker
                current={hasChosenExperience ? experience : undefined}
                saving={isSaving}
                onPick={async e => {
                  try { await updateSettings({ experience: e }); toast.success('Menu updated'); }
                  catch { toast.error('Could not save. Please try again.'); }
                }}
              />
            </Card>
          )}

          {tab === 'organization' && (
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Business details</h3>
              <p className="text-sm text-gray-500 mb-5">These appear on your bills. Fill in what you have; everything except the name is optional.</p>
              <form onSubmit={handleOrg(d => updateOrgMut.mutate(d))} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business Name *</label><input {...regOrg('name')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GSTIN</label><input {...regOrg('gstin')} className={`${inputCls} uppercase`} maxLength={15} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PAN</label><input {...regOrg('pan')} className={`${inputCls} uppercase`} maxLength={10} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input {...regOrg('email')} type="email" className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label><input {...regOrg('phone')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Website</label><input {...regOrg('website')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Prefix</label><input {...regOrg('invoicePrefix')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label><select {...regOrg('currency')} className={inputCls}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option></select></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label><select {...regOrg('timezone')} className={inputCls}><option value="Asia/Kolkata">Asia/Kolkata (IST)</option><option value="UTC">UTC</option></select></div>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Address</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><input {...regOrg('address.line1')} className={inputCls} placeholder="Street Address" /></div>
                    <input {...regOrg('address.city')} className={inputCls} placeholder="City" />
                    <input {...regOrg('address.state')} className={inputCls} placeholder="State" />
                    <input {...regOrg('address.pincode')} className={inputCls} placeholder="Pincode" />
                  </div>
                </div>
                <div className="flex justify-end"><Button type="submit" loading={updateOrgMut.isPending}>Save Changes</Button></div>
              </form>
            </Card>
          )}

          {tab === 'members' && (
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg mb-4">Team Members</h3>
              <div className="space-y-3">
                {(members?.members || []).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-3 px-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold">
                        {m.user?.firstName?.[0]}{m.user?.lastName?.[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{m.user?.firstName} {m.user?.lastName}</p>
                        <p className="text-sm text-gray-500">{m.user?.email}</p>
                      </div>
                    </div>
                    <StatusBadge status={m.role} />
                  </div>
                ))}
                {!members?.members?.length && <p className="text-center py-8 text-gray-500">No team members yet</p>}
              </div>
            </Card>
          )}

          {tab === 'security' && (
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white text-lg mb-5">Change Password</h3>
              <form onSubmit={handlePwd(d => changePwdMut.mutate(d))} className="space-y-4 max-w-sm">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Password</label><input {...regPwd('currentPassword')} type="password" className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label><input {...regPwd('newPassword')} type="password" className={inputCls} />{pwdErrors.newPassword && <p className="text-red-500 text-xs mt-1">{pwdErrors.newPassword.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label><input {...regPwd('confirmPassword')} type="password" className={inputCls} />{pwdErrors.confirmPassword && <p className="text-red-500 text-xs mt-1">{pwdErrors.confirmPassword.message}</p>}</div>
                <Button type="submit" loading={changePwdMut.isPending}>Update Password</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
