'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, X, TrendingUp, Users, Target, CheckCircle } from 'lucide-react';
import Link from 'next/link';

const LeadSchema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email().optional().or(z.literal('')),
  mobile: z.string().optional(),
  company: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']).default('NEW'),
  value: z.coerce.number().optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

type LeadForm = z.infer<typeof LeadSchema>;

const PIPELINE_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const stageColors: Record<string, string> = {
  NEW: 'bg-blue-50 border-blue-200', CONTACTED: 'bg-purple-50 border-purple-200', QUALIFIED: 'bg-yellow-50 border-yellow-200',
  PROPOSAL: 'bg-orange-50 border-orange-200', NEGOTIATION: 'bg-pink-50 border-pink-200', WON: 'bg-green-50 border-green-200', LOST: 'bg-red-50 border-red-200',
};

export default function LeadsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'pipeline'>('list');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['leads', status], queryFn: () => api.crm.listLeads({ status: status || undefined, limit: 100 }), select: r => r.data.data });
  const { data: pipeline } = useQuery({ queryKey: ['pipeline'], queryFn: () => api.crm.getPipeline(), select: r => r.data.data, enabled: view === 'pipeline' });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<LeadForm>({ resolver: zodResolver(LeadSchema) });

  const saveMut = useMutation({
    mutationFn: (d: LeadForm) => editId ? api.crm.updateLead(editId, d) : api.crm.createLead(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); toast.success(editId ? 'Lead updated' : 'Lead created'); setShowForm(false); reset(); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.crm.deleteLead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Lead deleted'); },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="CRM — Leads & Pipeline" subtitle={`${data?.total || 0} leads`}
        actions={
          <div className="flex gap-3">
            <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <button onClick={() => setView('list')} className={`px-3 py-1.5 text-sm ${view === 'list' ? 'bg-orange-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>List</button>
              <button onClick={() => setView('pipeline')} className={`px-3 py-1.5 text-sm ${view === 'pipeline' ? 'bg-orange-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>Pipeline</button>
            </div>
            <Button size="sm" onClick={() => { reset({ status: 'NEW' }); setEditId(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Lead</Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {pipeline?.stages?.slice(0, 4).map((s: any) => (
          <Card key={s.status} className="p-4">
            <p className="text-xs text-gray-500 uppercase font-semibold">{s.status}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{s._count}</p>
            <p className="text-sm text-orange-600 font-medium">{formatCurrency(s._sum?.value || 0)}</p>
          </Card>
        ))}
      </div>

      {view === 'pipeline' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map(stage => {
            const stageLeads = (data?.leads || []).filter((l: any) => l.status === stage);
            return (
              <div key={stage} className={`flex-shrink-0 w-72 border rounded-xl p-3 ${stageColors[stage]}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">{stage}</h3>
                  <span className="text-xs bg-white px-2 py-0.5 rounded-full font-medium">{stageLeads.length}</span>
                </div>
                <div className="space-y-2">
                  {stageLeads.map((lead: any) => (
                    <div key={lead.id} className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition" onClick={() => { setEditId(lead.id); reset(lead); setShowForm(true); }}>
                      <p className="font-medium text-sm text-gray-900">{lead.name}</p>
                      {lead.company && <p className="text-xs text-gray-500">{lead.company}</p>}
                      {lead.value && <p className="text-sm font-semibold text-orange-600 mt-1">{formatCurrency(lead.value)}</p>}
                      {lead.expectedCloseDate && <p className="text-xs text-gray-400 mt-1">Close: {formatDate(lead.expectedCloseDate)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && (
        <>
          <Card className="p-4">
            <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
              <option value="">All Status</option>
              {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Card>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Lead', 'Contact', 'Status', 'Value', 'Close Date', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
                <tbody>
                  {isLoading && Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                  {!isLoading && data?.leads?.map((lead: any) => (
                    <tr key={lead.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-white">{lead.name}</p>{lead.company && <p className="text-xs text-gray-400">{lead.company}</p>}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{lead.mobile || lead.email || '-'}</td>
                      <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                      <td className="px-4 py-3 font-semibold text-sm">{lead.value ? formatCurrency(lead.value) : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(lead.expectedCloseDate)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => { setEditId(lead.id); reset(lead); setShowForm(true); }}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete?')) deleteMut.mutate(lead.id); }} className="text-red-500">Del</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && !data?.leads?.length && <tr><td colSpan={6}><EmptyState title="No leads" description="Add your first lead to start tracking" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Lead</Button>} /></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editId ? 'Edit' : 'Add'} Lead</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label><input {...register('name')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile</label><input {...register('mobile')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input {...register('email')} type="email" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company</label><input {...register('company')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source</label><input {...register('source')} placeholder="Website, Referral..." className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label><select {...register('status')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">{PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deal Value (₹)</label><input {...register('value')} type="number" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expected Close</label><input {...register('expectedCloseDate')} type="date" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label><textarea {...register('notes')} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update' : 'Add'} Lead</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
