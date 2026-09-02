'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, X, RotateCcw, FileText, CheckCircle } from 'lucide-react';

const ReturnSchema = z.object({
  type: z.enum(['SALES_RETURN', 'PURCHASE_RETURN']),
  invoiceId: z.string().optional(),
  purchaseId: z.string().optional(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  returnDate: z.string().min(1, 'Date required'),
  reason: z.string().min(1, 'Reason required'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product required'),
    quantity: z.coerce.number().min(0.01, 'Qty required'),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).default(18),
  })).min(1, 'At least one item required'),
  generateCreditNote: z.boolean().default(true),
  notes: z.string().optional(),
});

const CreditNoteSchema = z.object({
  type: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  noteDate: z.string().min(1, 'Date required'),
  reason: z.string().min(1, 'Reason required'),
  items: z.array(z.object({
    description: z.string().min(1, 'Description required'),
    quantity: z.coerce.number().min(0.01),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).default(18),
  })).min(1),
  notes: z.string().optional(),
});

type ReturnForm = z.infer<typeof ReturnSchema>;
type CreditNoteForm = z.infer<typeof CreditNoteSchema>;


export default function ReturnsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'returns' | 'credit-notes'>('returns');
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [showCNForm, setShowCNForm] = useState(false);

  const { data: returns, isLoading: retLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.returns.listReturns(),
    select: r => r.data.data,
    enabled: tab === 'returns',
  });

  const { data: creditNotes, isLoading: cnLoading } = useQuery({
    queryKey: ['credit-notes'],
    queryFn: () => api.returns.listCreditNotes(),
    select: r => r.data.data,
    enabled: tab === 'credit-notes',
  });

  const { data: customers } = useQuery({ queryKey: ['customers-simple'], queryFn: () => api.customers.list({ limit: 200 }), select: r => r.data.data?.customers || [] });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-simple'], queryFn: () => api.suppliers.list({ limit: 200 }), select: r => r.data.data?.suppliers || [] });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });
  const { data: invoices } = useQuery({ queryKey: ['invoices-simple'], queryFn: () => api.invoices.list({ limit: 100 }), select: r => r.data.data?.invoices || r.data.data?.data || [] });

  // Return form
  const { register: regRet, handleSubmit: handleRet, control: ctrlRet, reset: resetRet, watch: watchRet, formState: { errors: retErrors } } = useForm<ReturnForm>({
    resolver: zodResolver(ReturnSchema),
    defaultValues: { type: 'SALES_RETURN', returnDate: new Date().toISOString().split('T')[0], generateCreditNote: true, items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });
  const { fields: retFields, append: retAppend, remove: retRemove } = useFieldArray({ control: ctrlRet, name: 'items' });
  const retType = watchRet('type');
  const retItems = watchRet('items');

  // Credit Note form
  const { register: regCN, handleSubmit: handleCN, control: ctrlCN, reset: resetCN, watch: watchCN, formState: { errors: cnErrors } } = useForm<CreditNoteForm>({
    resolver: zodResolver(CreditNoteSchema),
    defaultValues: { type: 'CREDIT_NOTE', noteDate: new Date().toISOString().split('T')[0], items: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });
  const { fields: cnFields, append: cnAppend, remove: cnRemove } = useFieldArray({ control: ctrlCN, name: 'items' });
  const cnType = watchCN('type');
  const cnItems = watchCN('items');

  const createReturnMut = useMutation({
    mutationFn: (d: ReturnForm) => api.returns.createReturn(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); toast.success('Return order created'); setShowReturnForm(false); resetRet(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create return'),
  });

  const createCNMut = useMutation({
    mutationFn: (d: CreditNoteForm) => api.returns.createCreditNote(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-notes'] }); toast.success('Credit/Debit note created'); setShowCNForm(false); resetCN(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create note'),
  });

  const approveReturnMut = useMutation({
    mutationFn: (id: string) => api.returns.approveReturn(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); toast.success('Return approved'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const confirmCNMut = useMutation({
    mutationFn: (id: string) => api.returns.confirmCreditNote(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-notes'] }); toast.success('Note confirmed'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const retTotal = retItems?.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0) * (1 + (i.taxRate || 0) / 100), 0) || 0;
  const cnTotal = cnItems?.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0) * (1 + (i.taxRate || 0) / 100), 0) || 0;

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Returns & Credit Notes" subtitle="Manage sales returns, purchase returns, and credit/debit notes"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => { resetCN({ type: 'CREDIT_NOTE', noteDate: new Date().toISOString().split('T')[0], items: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] }); setShowCNForm(true); }}>
              <FileText className="w-4 h-4" /> Credit/Debit Note
            </Button>
            <Button size="sm" onClick={() => { resetRet({ type: 'SALES_RETURN', returnDate: new Date().toISOString().split('T')[0], generateCreditNote: true, items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18 }] }); setShowReturnForm(true); }}>
              <Plus className="w-4 h-4" /> New Return
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[['returns', 'Return Orders'], ['credit-notes', 'Credit/Debit Notes']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {/* Return Orders Tab */}
      {tab === 'returns' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                {['Return #', 'Type', 'Party', 'Date', 'Reason', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {retLoading && Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={8}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                {!retLoading && (returns?.returns || returns || []).map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{r.returnOrderNumber || r.returnNumber || `RET-${r.id?.slice(-6)}`}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.type} /></td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{r.customer?.name || r.supplier?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(r.returnDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{r.reason}</td>
                    <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(r.totalAmount || 0)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3">
                      {r.status === 'PENDING' && (
                        <Button variant="secondary" size="sm" onClick={() => approveReturnMut.mutate(r.id)} loading={approveReturnMut.isPending}>
                          <CheckCircle className="w-3.5 h-3.5" /> Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!retLoading && !(returns?.returns || returns || []).length && (
                  <tr><td colSpan={8}><EmptyState title="No return orders" description="Create a return order for sales or purchase returns" action={<Button size="sm" onClick={() => setShowReturnForm(true)}><Plus className="w-4 h-4" /> New Return</Button>} /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Credit/Debit Notes Tab */}
      {tab === 'credit-notes' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                {['Note #', 'Type', 'Party', 'Date', 'Reason', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {cnLoading && Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={8}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                {!cnLoading && (creditNotes?.notes || creditNotes || []).map((n: any) => (
                  <tr key={n.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{n.noteNumber || `CN-${n.id?.slice(-6)}`}</td>
                    <td className="px-4 py-3"><StatusBadge status={n.type} /></td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{n.customer?.name || n.supplier?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(n.noteDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{n.reason}</td>
                    <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(n.totalAmount || 0)}</td>
                    <td className="px-4 py-3"><StatusBadge status={n.status} /></td>
                    <td className="px-4 py-3">
                      {n.status === 'DRAFT' && (
                        <Button variant="secondary" size="sm" onClick={() => confirmCNMut.mutate(n.id)} loading={confirmCNMut.isPending}>
                          <CheckCircle className="w-3.5 h-3.5" /> Confirm
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!cnLoading && !(creditNotes?.notes || creditNotes || []).length && (
                  <tr><td colSpan={8}><EmptyState title="No credit/debit notes" description="Create notes for adjustments and returns" action={<Button size="sm" onClick={() => setShowCNForm(true)}><FileText className="w-4 h-4" /> Create Note</Button>} /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Return Order Form Modal */}
      {showReturnForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Return Order</h2>
              <button onClick={() => { setShowReturnForm(false); resetRet(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleRet(d => createReturnMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Return Type *</label>
                  <select {...regRet('type')} className={inputCls}>
                    <option value="SALES_RETURN">Sales Return</option>
                    <option value="PURCHASE_RETURN">Purchase Return</option>
                  </select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Return Date *</label>
                  <input type="date" {...regRet('returnDate')} className={inputCls} />
                </div>
                {retType === 'SALES_RETURN' && (
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer</label>
                    <select {...regRet('customerId')} className={inputCls}><option value="">Select customer</option>{(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  </div>
                )}
                {retType === 'PURCHASE_RETURN' && (
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label>
                    <select {...regRet('supplierId')} className={inputCls}><option value="">Select supplier</option>{(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  </div>
                )}
                {retType === 'SALES_RETURN' && (
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Original Invoice</label>
                    <select {...regRet('invoiceId')} className={inputCls}><option value="">Select invoice (optional)</option>{(invoices || []).map((inv: any) => <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {formatCurrency(inv.totalAmount)}</option>)}</select>
                  </div>
                )}
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason *</label>
                  <select {...regRet('reason')} className={inputCls}>
                    <option value="">Select reason</option>
                    <option value="DEFECTIVE">Defective Product</option>
                    <option value="WRONG_ITEM">Wrong Item Delivered</option>
                    <option value="DAMAGED">Damaged in Transit</option>
                    <option value="NOT_AS_DESCRIBED">Not as Described</option>
                    <option value="EXCESS_QUANTITY">Excess Quantity</option>
                    <option value="CUSTOMER_CHANGED_MIND">Customer Changed Mind</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Return Items</label>
                  <Button type="button" variant="secondary" size="sm" onClick={() => retAppend({ productId: '', quantity: 1, unitPrice: 0, taxRate: 18 })}><Plus className="w-4 h-4" /> Add Item</Button>
                </div>
                {retFields.map((field, i) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <div className="col-span-4">
                      <select {...regRet(`items.${i}.productId`)} className={inputCls}><option value="">Select product</option>{(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    </div>
                    <div className="col-span-2"><input type="number" step="0.01" {...regRet(`items.${i}.quantity`)} placeholder="Qty" className={inputCls} /></div>
                    <div className="col-span-3"><input type="number" step="0.01" {...regRet(`items.${i}.unitPrice`)} placeholder="Price" className={inputCls} /></div>
                    <div className="col-span-2"><select {...regRet(`items.${i}.taxRate`)} className={inputCls}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                    <div className="col-span-1">{retFields.length > 1 && <button type="button" onClick={() => retRemove(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>}</div>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold mt-2">Total: {formatCurrency(retTotal)}</div>
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" {...regRet('generateCreditNote')} id="genCN" className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500" />
                <label htmlFor="genCN" className="text-sm text-gray-700 dark:text-gray-300">Auto-generate Credit Note on approval</label>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea {...regRet('notes')} rows={2} className={inputCls} placeholder="Additional notes..." />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowReturnForm(false); resetRet(); }}>Cancel</Button>
                <Button type="submit" loading={createReturnMut.isPending}><RotateCcw className="w-4 h-4" /> Create Return</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit/Debit Note Form Modal */}
      {showCNForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Credit/Debit Note</h2>
              <button onClick={() => { setShowCNForm(false); resetCN(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleCN(d => createCNMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note Type *</label>
                  <select {...regCN('type')} className={inputCls}>
                    <option value="CREDIT_NOTE">Credit Note (issued to customer)</option>
                    <option value="DEBIT_NOTE">Debit Note (issued to supplier)</option>
                  </select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date *</label>
                  <input type="date" {...regCN('noteDate')} className={inputCls} />
                </div>
                {cnType === 'CREDIT_NOTE' && (
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer</label>
                    <select {...regCN('customerId')} className={inputCls}><option value="">Select customer</option>{(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  </div>
                )}
                {cnType === 'DEBIT_NOTE' && (
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label>
                    <select {...regCN('supplierId')} className={inputCls}><option value="">Select supplier</option>{(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  </div>
                )}
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason *</label>
                  <input {...regCN('reason')} className={inputCls} placeholder="Reason for issuing this note" />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Line Items</label>
                  <Button type="button" variant="secondary" size="sm" onClick={() => cnAppend({ description: '', quantity: 1, unitPrice: 0, taxRate: 18 })}><Plus className="w-4 h-4" /> Add</Button>
                </div>
                {cnFields.map((field, i) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <div className="col-span-4"><input {...regCN(`items.${i}.description`)} placeholder="Description" className={inputCls} /></div>
                    <div className="col-span-2"><input type="number" step="0.01" {...regCN(`items.${i}.quantity`)} placeholder="Qty" className={inputCls} /></div>
                    <div className="col-span-3"><input type="number" step="0.01" {...regCN(`items.${i}.unitPrice`)} placeholder="Price" className={inputCls} /></div>
                    <div className="col-span-2"><select {...regCN(`items.${i}.taxRate`)} className={inputCls}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                    <div className="col-span-1">{cnFields.length > 1 && <button type="button" onClick={() => cnRemove(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>}</div>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold mt-2">Total: {formatCurrency(cnTotal)}</div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea {...regCN('notes')} rows={2} className={inputCls} placeholder="Additional details..." />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowCNForm(false); resetCN(); }}>Cancel</Button>
                <Button type="submit" loading={createCNMut.isPending}><FileText className="w-4 h-4" /> Create Note</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
