'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { dropEmpty, today } from '@/lib/business';
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

const RETURN_REASONS: Record<string, string> = {
  DEFECTIVE: 'Defective product',
  WRONG_ITEM: 'Wrong item delivered',
  DAMAGED: 'Damaged in transit',
  NOT_AS_DESCRIBED: 'Not as described',
  EXCESS_QUANTITY: 'Excess quantity',
  CUSTOMER_CHANGED_MIND: 'Customer changed mind',
  OTHER: 'Other',
};
const TYPE_TEXT: Record<string, string> = {
  SALES_RETURN: 'Sales return', PURCHASE_RETURN: 'Purchase return',
  CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note',
};
// Credit/debit note statuses: DRAFT until confirmed, then OPEN (not yet adjusted against a bill).
// OPEN = credit still available; ADJUSTED = fully used against the bill it was raised on.
const NOTE_STATUS_TEXT: Record<string, string> = { DRAFT: 'Draft', OPEN: 'Open credit', ADJUSTED: 'Adjusted', CANCELLED: 'Cancelled' };

// API validation errors look like { message, details | errors: [{ field, message }] }.
const apiError = (e: any, fallback: string) => {
  const d = e?.response?.data;
  const detail = d?.details?.[0] ?? d?.errors?.[0];
  return detail ? `${detail.field}: ${detail.message}` : d?.message || d?.error || fallback;
};

// First message in a react-hook-form errors tree (fields, arrays and root errors).
const firstError = (errs: any): string | undefined => {
  if (!errs || typeof errs !== 'object') return undefined;
  if (typeof errs.message === 'string' && errs.message) return errs.message;
  for (const v of Object.values(errs)) { const m = firstError(v); if (m) return m; }
  return undefined;
};

// Paginated endpoints return rows directly in data (an array).
const rows = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : []);


export default function ReturnsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'returns' | 'credit-notes'>('returns');
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [showCNForm, setShowCNForm] = useState(false);

  const { data: returns, isLoading: retLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.returns.listReturns({ limit: 100 }),
    // Standalone credit/debit notes are backed by an internal ADJUSTMENT return order; those are not real returns.
    select: r => rows(r).filter((x: any) => x.status !== 'ADJUSTMENT'),
    enabled: tab === 'returns',
  });

  const { data: creditNotes, isLoading: cnLoading } = useQuery({
    queryKey: ['credit-notes'],
    queryFn: () => api.returns.listCreditNotes({ limit: 100 }),
    select: r => rows(r),
    enabled: tab === 'credit-notes',
  });

  const { data: customers } = useQuery({ queryKey: ['customers-simple'], queryFn: () => api.customers.list({ limit: 200 }), select: r => r.data.data?.customers || [] });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-simple'], queryFn: () => api.suppliers.list({ limit: 200 }), select: r => r.data.data?.suppliers || [] });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });
  const { data: invoices } = useQuery({ queryKey: ['invoices-simple'], queryFn: () => api.invoices.list({ limit: 100 }), select: r => rows(r) });

  // Return form
  const { register: regRet, handleSubmit: handleRet, control: ctrlRet, reset: resetRet, watch: watchRet, setValue: setRetValue, formState: { errors: retErrors } } = useForm<ReturnForm>({
    resolver: zodResolver(ReturnSchema),
    defaultValues: { type: 'SALES_RETURN', returnDate: today(), generateCreditNote: true, items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });
  const { fields: retFields, append: retAppend, remove: retRemove } = useFieldArray({ control: ctrlRet, name: 'items' });
  const retType = watchRet('type');
  const retItems = watchRet('items');

  // Credit Note form
  const { register: regCN, handleSubmit: handleCN, control: ctrlCN, reset: resetCN, watch: watchCN, formState: { errors: cnErrors } } = useForm<CreditNoteForm>({
    resolver: zodResolver(CreditNoteSchema),
    defaultValues: { type: 'CREDIT_NOTE', noteDate: today(), items: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });
  const { fields: cnFields, append: cnAppend, remove: cnRemove } = useFieldArray({ control: ctrlCN, name: 'items' });
  const cnType = watchCN('type');
  const cnItems = watchCN('items');

  const createReturnMut = useMutation({
    mutationFn: (d: ReturnForm) => {
      const isSale = d.type === 'SALES_RETURN';
      // Blank ids ('') are sent to the database as foreign keys and fail, so drop them; also drop the
      // fields that belong to the other return type (they stay in form state after switching type).
      return api.returns.createReturn(dropEmpty({
        type: d.type,
        returnDate: d.returnDate,
        reason: d.reason,
        notes: d.notes?.trim(),
        customerId: isSale ? d.customerId : undefined,
        invoiceId: isSale ? d.invoiceId : undefined,
        supplierId: isSale ? undefined : d.supplierId,
        purchaseId: isSale ? undefined : d.purchaseId,
        items: d.items.map(i => ({
          productId: i.productId,
          description: (products || []).find((p: any) => p.id === i.productId)?.name || 'Returned item',
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          taxRate: Number(i.taxRate ?? 0),
        })),
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); toast.success('Return order created'); setShowReturnForm(false); resetRet(); },
    onError: (e: any) => toast.error(apiError(e, 'Failed to create return')),
  });

  const createCNMut = useMutation({
    mutationFn: (d: CreditNoteForm) => {
      const isCredit = d.type === 'CREDIT_NOTE';
      return api.returns.createCreditNote(dropEmpty({
        type: d.type,
        noteDate: d.noteDate,
        reason: d.reason.trim(),
        notes: d.notes?.trim(),
        customerId: isCredit ? d.customerId : undefined,
        supplierId: isCredit ? undefined : d.supplierId,
        items: d.items.map(i => ({ description: i.description.trim(), quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate ?? 0) })),
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-notes'] }); toast.success('Credit/Debit note created'); setShowCNForm(false); resetCN(); },
    onError: (e: any) => toast.error(apiError(e, 'Failed to create note')),
  });

  const approveReturnMut = useMutation({
    mutationFn: (id: string) => api.returns.approveReturn(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['credit-notes'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Return approved, stock updated and note created');
    },
    onError: (e: any) => toast.error(apiError(e, 'Could not approve return')),
  });

  const confirmCNMut = useMutation({
    mutationFn: (id: string) => api.returns.confirmCreditNote(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-notes'] }); toast.success('Note confirmed'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not confirm note')),
  });

  // Inputs hold strings until zod coerces them on submit, so Number() each value.
  const lineTotal = (i: any) => (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * (1 + (Number(i.taxRate) || 0) / 100);
  const retTotal = retItems?.reduce((s, i) => s + lineTotal(i), 0) || 0;
  const cnTotal = cnItems?.reduce((s, i) => s + lineTotal(i), 0) || 0;

  // Picking a product fills its price (selling price for a sales return, purchase price for a purchase return) and GST rate.
  const onPickProduct = (i: number, productId: string) => {
    const p = (products || []).find((x: any) => x.id === productId);
    if (!p) return;
    const price = retType === 'PURCHASE_RETURN' ? p.costPrice : p.sellingPrice;
    setRetValue(`items.${i}.unitPrice`, Number(price ?? 0));
    if (p.taxRate != null) setRetValue(`items.${i}.taxRate`, Number(p.taxRate));
  };
  // Picking the original invoice fills in its customer.
  const onPickInvoice = (invoiceId: string) => {
    const inv = (invoices || []).find((x: any) => x.id === invoiceId);
    if (inv?.customerId) setRetValue('customerId', inv.customerId);
  };

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Returns & Credit Notes" subtitle="Manage sales returns, purchase returns, and credit/debit notes"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => { resetCN({ type: 'CREDIT_NOTE', noteDate: today(), items: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] }); setShowCNForm(true); }}>
              <FileText className="w-4 h-4" /> Credit/Debit Note
            </Button>
            <Button size="sm" onClick={() => { resetRet({ type: 'SALES_RETURN', returnDate: today(), generateCreditNote: true, items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18 }] }); setShowReturnForm(true); }}>
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
                {!retLoading && (returns ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{r.returnNumber || r.returnOrderNumber}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.returnType || r.type} label={TYPE_TEXT[r.returnType || r.type]} /></td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{r.customer?.name || r.supplier?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(r.returnDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{RETURN_REASONS[r.reason] || r.reason || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(Number(r.totalAmount ?? 0))}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3">
                      {r.status === 'PENDING' && (
                        <Button variant="secondary" size="sm" onClick={() => approveReturnMut.mutate(r.id)} loading={approveReturnMut.isPending && approveReturnMut.variables === r.id} disabled={approveReturnMut.isPending}>
                          <CheckCircle className="w-3.5 h-3.5" /> Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!retLoading && !(returns ?? []).length && (
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
                {!cnLoading && (creditNotes ?? []).map((n: any) => (
                  <tr key={n.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{n.noteNumber}</td>
                    <td className="px-4 py-3"><StatusBadge status={n.type} label={TYPE_TEXT[n.type]} /></td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{n.customer?.name || n.supplier?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(n.noteDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{RETURN_REASONS[n.reason] || n.reason || n.notes || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-sm">
                      {formatCurrency(Number(n.totalAmount ?? n.amount ?? 0))}
                      {Number(n.adjustedAmount) > 0 && <span className="block text-xs font-normal text-gray-500">{formatCurrency(Number(n.adjustedAmount))} used against the bill</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={n.status} label={NOTE_STATUS_TEXT[n.status]} /></td>
                    <td className="px-4 py-3">
                      {n.status === 'DRAFT' && (
                        <Button variant="secondary" size="sm" onClick={() => confirmCNMut.mutate(n.id)} loading={confirmCNMut.isPending && confirmCNMut.variables === n.id} disabled={confirmCNMut.isPending}>
                          <CheckCircle className="w-3.5 h-3.5" /> Confirm
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!cnLoading && !(creditNotes ?? []).length && (
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
                    <select {...regRet('invoiceId', { onChange: e => onPickInvoice(e.target.value) })} className={inputCls}><option value="">Select invoice (optional)</option>{(invoices || []).map((inv: any) => <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {formatCurrency(Number(inv.totalAmount ?? 0))}</option>)}</select>
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
                      <select {...regRet(`items.${i}.productId`, { onChange: e => onPickProduct(i, e.target.value) })} className={inputCls}><option value="">Select product</option>{(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    </div>
                    <div className="col-span-2"><input type="number" step="0.01" {...regRet(`items.${i}.quantity`)} placeholder="Qty" className={inputCls} /></div>
                    <div className="col-span-3"><input type="number" step="0.01" {...regRet(`items.${i}.unitPrice`)} placeholder="Price" className={inputCls} /></div>
                    <div className="col-span-2"><select {...regRet(`items.${i}.taxRate`)} className={inputCls}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                    <div className="col-span-1">{retFields.length > 1 && <button type="button" onClick={() => retRemove(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>}</div>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold mt-2">Total: {formatCurrency(retTotal)}</div>
              </div>

              {/* The API always restocks and creates the note on approval; it has no opt-out, so no checkbox here. */}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                When you approve this return, stock is {retType === 'SALES_RETURN' ? 'added back' : 'reduced'} and a {retType === 'SALES_RETURN' ? 'credit' : 'debit'} note is created automatically.
              </p>

              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea {...regRet('notes')} rows={2} className={inputCls} placeholder="Additional notes..." />
              </div>

              {firstError(retErrors) && <p className="text-xs text-red-500">{firstError(retErrors)}</p>}
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

              {firstError(cnErrors) && <p className="text-xs text-red-500">{firstError(cnErrors)}</p>}
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
