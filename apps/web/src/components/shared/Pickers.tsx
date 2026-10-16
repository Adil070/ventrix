'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { SearchSelect, type SelectOption } from './SearchSelect';
import { useDues } from '@/hooks/useDues';

function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const errMsg = (e: any, fallback: string) => e?.response?.data?.message || fallback;

interface PartyPickerProps {
  kind: 'customer' | 'supplier';
  value: string | null;
  selectedLabel?: string;
  onChange: (option: SelectOption | null) => void;
  allowWalkIn?: boolean;
  autoFocus?: boolean;
  error?: string;
}

// Pick a customer/supplier, or type a new name to save one on the spot.
export function PartyPicker({ kind, value, selectedLabel, onChange, allowWalkIn, autoFocus, error }: PartyPickerProps) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
  const resource = kind === 'customer' ? api.customers : api.suppliers;
  const dues = useDues(kind);

  const { data = [], isFetching } = useQuery({
    queryKey: [`${kind}-picker`, search],
    queryFn: () => resource.list({ search: search || undefined, limit: 20 }),
    select: r => (r.data.data?.[`${kind}s`] || []) as any[],
    staleTime: 30_000,
  });

  const options: SelectOption[] = data.map(p => {
    const owes = dues.get(p.id) || 0;
    const phone = p.mobile || p.phone;
    const balance = owes > 0 ? (kind === 'customer' ? `owes you ${formatCurrency(owes)}` : `you owe ${formatCurrency(owes)}`) : '';
    return { id: p.id, label: p.name, sublabel: [phone, balance].filter(Boolean).join(' · ') || undefined, data: p };
  });

  const create = async (name: string) => {
    try {
      const res = await resource.create({ name });
      const p = res.data.data;
      qc.invalidateQueries({ queryKey: [`${kind}s`] });
      qc.invalidateQueries({ queryKey: [`${kind}-picker`] });
      toast.success(`${name} saved as a new ${kind}`);
      return { id: p.id, label: p.name, data: p };
    } catch (e) {
      toast.error(errMsg(e, `Could not add ${kind}`));
    }
  };

  return (
    <SearchSelect
      value={value}
      selectedLabel={selectedLabel}
      options={options}
      onSelect={onChange}
      onQueryChange={setQuery}
      onCreate={create}
      createLabel={q => `Add “${q}” as a new ${kind}`}
      nullOption={allowWalkIn ? { label: 'Walk-in customer', sublabel: 'Counter sale, no name needed' } : undefined}
      placeholder={kind === 'customer' ? 'Type customer name or mobile…' : 'Type supplier name…'}
      loading={isFetching}
      autoFocus={autoFocus}
      error={error}
    />
  );
}

export function itemPrice(product: any, priceField: 'sellingPrice' | 'purchasePrice') {
  return Number((priceField === 'purchasePrice' ? (product.costPrice ?? product.purchasePrice) : product.sellingPrice) || 0);
}

interface ItemPickerProps {
  value: string | null;
  selectedLabel?: string;
  onChange: (option: SelectOption | null) => void;
  priceField: 'sellingPrice' | 'purchasePrice';
  trackInventory: boolean;
  error?: string;
}

// Pick an item, or type a new name to save it as an item right away.
export function ItemPicker({ value, selectedLabel, onChange, priceField, trackInventory, error }: ItemPickerProps) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const search = useDebounced(query);

  const { data = [], isFetching } = useQuery({
    queryKey: ['item-picker', search],
    queryFn: () => api.products.list({ search: search || undefined, limit: 20 }),
    select: r => (r.data.data?.products || []) as any[],
    staleTime: 30_000,
  });

  const options: SelectOption[] = data.map(p => {
    const price = itemPrice(p, priceField);
    // The API keeps the running stock count in openingStock (sales and purchases adjust it).
    const stock = p.trackInventory ? `${Number(p.openingStock || 0)} in stock` : '';
    return { id: p.id, label: p.name, sublabel: [price ? formatCurrency(price) : '', stock, p.sku].filter(Boolean).join(' · ') || undefined, data: p };
  });

  const create = async (name: string) => {
    try {
      const res = await api.products.create({ name, type: 'PRODUCT', trackInventory });
      const p = res.data.data;
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['item-picker'] });
      toast.success(`${name} saved as a new item. Enter its price below.`);
      return { id: p.id, label: p.name, data: { ...p, __new: true } };
    } catch (e) {
      toast.error(errMsg(e, 'Could not add item'));
    }
  };

  return (
    <SearchSelect
      value={value}
      selectedLabel={selectedLabel}
      options={options}
      onSelect={onChange}
      onQueryChange={setQuery}
      onCreate={create}
      createLabel={q => `Add “${q}” as a new item`}
      placeholder="Type item name or code…"
      loading={isFetching}
      error={error}
    />
  );
}
