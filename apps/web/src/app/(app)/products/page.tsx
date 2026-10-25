'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, X, Edit2, Trash2, AlertCircle, Package, Filter } from 'lucide-react';
import { SlideInPanel, AnimatedList, AnimatedRow } from '@/components/ui/motion';
import { useOpenFromUrl } from '@/hooks/useOpenFromUrl';

const ProductSchema = z.object({
  name: z.string().min(1, 'Name required'),
  sku: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE', 'COMPOSITE']).default('PRODUCT'),
  categoryId: z.string().optional(),
  unitId: z.string().optional(),
  hsnCode: z.string().optional(),
  sellingPrice: z.coerce.number().min(0).default(0),
  purchasePrice: z.coerce.number().min(0).default(0),
  mrp: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).default(18),
  trackInventory: z.boolean().default(true),
  openingStock: z.coerce.number().default(0),
  reorderLevel: z.coerce.number().default(0),
});

type ProductForm = z.infer<typeof ProductSchema>;

export default function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loadedStock, setLoadedStock] = useState<number | null>(null);
  const [tab, setTab] = useState<'all' | 'low-stock'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['products', tab === 'low-stock' ? '' : search, tab],
    queryFn: () => tab === 'low-stock' ? api.products.getLowStock() : api.products.list({ search, limit: 50 }),
    select: r => r.data.data,
  });

  const { data: categories } = useQuery({ queryKey: ['product-categories'], queryFn: () => api.products.listCategories(), select: r => r.data.data });
  const { data: units } = useQuery({ queryKey: ['product-units'], queryFn: () => api.products.listUnits(), select: r => r.data.data });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ProductForm>({ resolver: zodResolver(ProductSchema) });
  const productType = watch('type');

  const saveMut = useMutation({
    mutationFn: (raw: ProductForm) => {
      const d = { ...raw, unitId: raw.unitId || undefined }; // "No unit" is sent as absent, not ""
      if (!editId) return api.products.create(d);
      // Send the stock count only when the user changed it. The value loaded into the form goes stale as soon
      // as a sale or purchase is saved, and sending it back would undo that stock movement.
      const { openingStock, ...rest } = d;
      return api.products.update(editId, openingStock === loadedStock ? rest : d);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['products-simple'] }); qc.invalidateQueries({ queryKey: ['inventory-summary'] }); toast.success(editId ? 'Updated' : 'Product created'); setShowForm(false); reset(); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.products.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['products-simple'] }); qc.invalidateQueries({ queryKey: ['inventory-summary'] }); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  // New items default to pieces, the most common unit for a shop.
  const pcsUnitId = (units || []).find((u: any) => u.abbreviation === 'PCS')?.id ?? '';
  const openCreate = () => { reset({ type: 'PRODUCT', taxRate: 18, sellingPrice: 0, purchasePrice: 0, mrp: 0, openingStock: 0, reorderLevel: 0, trackInventory: true, unitId: pcsUnitId }); setEditId(null); setShowForm(true); };
  useOpenFromUrl(openCreate);

  // /products returns { products, total }; /products/low-stock returns a plain array and ignores search, so filter it here.
  const q = search.trim().toLowerCase();
  const products: any[] = tab === 'low-stock'
    ? (Array.isArray(data) ? data : []).filter((p: any) => !q || [p.name, p.sku, p.barcode, p.hsnCode].some(v => v && String(v).toLowerCase().includes(q)))
    : (data?.products || []);
  const total = tab === 'low-stock' ? products.length : Number(data?.total || 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Items" subtitle="Products and services you sell or buy. Tip: you can also add items while making a bill."
        actions={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> Add item</Button>}
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {['all', 'low-stock'].map(t => (
          <button key={t} onClick={() => setTab(t as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'all' ? 'All items' : 'Running low'}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search by name, SKU, barcode, HSN..." />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Item', 'Type', 'Selling price', 'Purchase price', 'In stock', 'GST', ''].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <AnimatedList>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-5 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" /></td></tr>)}
              {!isLoading && products.map((p: any) => (
                <AnimatedRow key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center"><Package className="w-4 h-4 text-gray-400" /></div>
                      <div><p className="font-medium text-gray-900 dark:text-white">{p.name}</p>{p.sku && <p className="text-xs text-gray-400">SKU: {p.sku}</p>}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.type || 'PRODUCT'} /></td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(p.sellingPrice || 0)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatCurrency(p.costPrice ?? p.purchasePrice ?? 0)}</td>
                  <td className="px-4 py-3">
                    {p.trackInventory === false || p.type === 'SERVICE' ? <span className="text-gray-400">-</span> : (() => {
                      // The API keeps the running stock count in openingStock.
                      const stock = Number(p.openingStock || 0);
                      const low = Number(p.reorderPoint || 0) > 0 && stock <= Number(p.reorderPoint);
                      return <>
                        <span className={`font-semibold ${low || stock < 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{stock}</span>
                        {low && <AlertCircle className="w-4 h-4 text-red-500 inline ml-1" />}
                      </>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{Number(p.taxRate || 0)}%</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setEditId(p.id); setLoadedStock(Number(p.openingStock) || 0); reset({ name: p.name, sku: p.sku || '', description: p.description || '', type: p.type, hsnCode: p.hsnCode || '', sellingPrice: Number(p.sellingPrice) || 0, purchasePrice: Number(p.costPrice) || 0, mrp: Number(p.mrp) || 0, taxRate: Number(p.taxRate) || 18, trackInventory: p.trackInventory ?? true, openingStock: Number(p.openingStock) || 0, reorderLevel: Number(p.reorderPoint) || 0, unitId: p.unitId || '' }); setShowForm(true); }}><Edit2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete?')) deleteMut.mutate(p.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </div>
                  </td>
                </AnimatedRow>
              ))}
              {!isLoading && !products.length && (tab === 'low-stock'
                ? <tr><td colSpan={7}><EmptyState title={q ? 'No matching items running low' : 'Nothing is running low'} description="Items show up here when their stock falls to the low-stock alert level you set on the item." /></td></tr>
                : <tr><td colSpan={7}><EmptyState title={q ? 'No matching items' : 'No items yet'} description={q ? 'Try a different name, SKU or HSN code.' : 'Add the things you sell, or just type a new item name while making a sale.'} action={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> Add item</Button>} /></td></tr>)}
            </AnimatedList>
          </table>
        </div>
        {tab === 'all' && !isLoading && total > products.length && <p className="px-4 py-3 text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700">Showing {products.length} of {total} items. Search to find the rest.</p>}
      </Card>

      <SlideInPanel show={showForm} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editId ? 'Edit item' : 'Add item'}</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item name</label><input {...register('name')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" placeholder="e.g. Basmati rice 5kg" autoFocus />{errors.name && <p className="text-red-500 text-xs mt-1">Enter a name</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selling price (₹)</label><input {...register('sellingPrice')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase price (₹)</label><input {...register('purchasePrice')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GST rate</label><select {...register('taxRate')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                {productType !== 'SERVICE' && <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{editId ? 'Stock count' : 'Stock you have now'}</label><input {...register('openingStock')} type="number" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>}
                {productType !== 'SERVICE' && <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit</label><select {...register('unitId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">No unit</option>{(units || []).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}</select></div>}
              </div>
              <details className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">More details: type, code, HSN, MRP, low-stock alert</summary>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label><select {...register('type')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="PRODUCT">Product</option><option value="SERVICE">Service</option><option value="COMPOSITE">Combo / kit</option></select></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item code (SKU)</label><input {...register('sku')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">HSN / SAC code</label><input {...register('hsnCode')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MRP (₹)</label><input {...register('mrp')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                  {productType !== 'SERVICE' && <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warn me when stock falls to</label><input {...register('reorderLevel')} type="number" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" placeholder="e.g. 5" /></div>}
                </div>
              </details>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Save' : 'Add item'}</Button>
              </div>
            </form>
          </div>
        </SlideInPanel>
    </div>
  );
}
