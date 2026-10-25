'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { PackagePlus, X } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/shared';

/** One short line from the API's 409 INSUFFICIENT_STOCK response (`details.shortages`). */
export interface StockShortage {
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  requested: number;
  available: number;
  shortBy: number;
}

const keyOf = (s: StockShortage) => `${s.productId}|${s.warehouseId}`;

// Sales are blocked on short stock. Stock often arrives while billing is going on, so the user can book it
// here in one step (a stock-in adjustment, visible in stock history) and the sale is saved again.
export function StockShortDialog({ shortages, onClose, onStockAdded }: {
  shortages: StockShortage[];
  onClose: () => void;
  onStockAdded: () => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(shortages.map(s => [keyOf(s), String(s.shortBy)])));
  // Lines already booked, so a retry after a failure doesn't add their stock twice.
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addStock = async () => {
    const tooLow = shortages.find(s => !added.has(keyOf(s)) && !(Number(qty[keyOf(s)]) >= s.shortBy));
    if (tooLow) { setError(`Add at least ${tooLow.shortBy} of “${tooLow.productName}” to complete this sale.`); return; }
    setSaving(true);
    setError('');
    const done = new Set(added);
    try {
      for (const s of shortages) {
        if (done.has(keyOf(s))) continue;
        await api.inventory.adjust({
          productId: s.productId,
          warehouseId: s.warehouseId,
          type: 'ADJUSTMENT_IN',
          quantity: Number(qty[keyOf(s)]),
          notes: 'Stock added while billing',
        });
        done.add(keyOf(s));
      }
      toast.success('Stock added');
      onStockAdded();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not add stock. Please try again.');
    } finally {
      setAdded(done);
      setSaving(false);
    }
  };

  const inputCls = 'w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="stock-short-title">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 id="stock-short-title" className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-orange-500" /> Not enough stock
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            The sale wasn&apos;t saved. If this stock has arrived, add it below and the sale will be saved straight away.
          </p>
          {shortages.map(s => (
            <div key={keyOf(s)} className="flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">{s.productName}</p>
                <p className="text-xs text-gray-500">Selling {s.requested}, only {s.available} in {s.warehouseName}</p>
              </div>
              {added.has(keyOf(s)) ? (
                <span className="text-sm text-green-600">Added</span>
              ) : (
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  Add
                  <input
                    aria-label={`Quantity of ${s.productName} to add`}
                    inputMode="decimal"
                    value={qty[keyOf(s)]}
                    onChange={e => setQty(q => ({ ...q, [keyOf(s)]: e.target.value }))}
                    className={inputCls}
                  />
                </label>
              )}
            </div>
          ))}
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end p-5 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Change quantities</Button>
          <Button onClick={addStock} loading={saving}>Add stock &amp; save sale</Button>
        </div>
      </div>
    </div>
  );
}
