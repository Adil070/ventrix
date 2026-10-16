'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Trash2, CheckCircle2, Info } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { PAYMENT_MODES, type PaymentMode, today } from '@/lib/business';
import { useOrgSettings } from '@/hooks/useOrganization';
import { Button, Card } from '@/components/shared';
import { PartyPicker, ItemPicker, itemPrice } from '@/components/shared/Pickers';
import type { SelectOption } from '@/components/shared/SearchSelect';

type Kind = 'sale' | 'purchase';
type PayStatus = 'full' | 'part' | 'none';

interface Line {
  key: number;
  productId: string | null;
  name: string;
  quantity: string;
  price: string;
  discount: string;
  taxRate: number;
  hsnCode?: string;
  isNew?: boolean;
}

const GST_RATES = [0, 5, 12, 18, 28];
const round2 = (n: number) => Math.round(n * 100) / 100;
let nextKey = 1;
const emptyLine = (taxRate: number): Line => ({ key: nextKey++, productId: null, name: '', quantity: '1', price: '', discount: '', taxRate });

const COPY = {
  sale: {
    title: 'New sale',
    who: 'Who is buying?',
    whoHint: 'Leave as walk-in for counter sales. Pick or type a name to sell on credit.',
    paidLabel: 'Did the customer pay?',
    full: 'Paid in full', part: 'Paid part', none: 'Not paid yet',
    noneHint: 'This amount will show under “Customers owe you” on Home.',
    save: 'Save sale',
  },
  purchase: {
    title: 'New purchase',
    who: 'Who did you buy from?',
    whoHint: 'Pick a supplier, or type a new name to add one.',
    paidLabel: 'Did you pay the supplier?',
    full: 'Paid in full', part: 'Paid part', none: 'Will pay later',
    noneHint: 'This amount will show under “You owe suppliers” on Home.',
    save: 'Save purchase',
  },
} as const;

function lineAmounts(l: Line, interState: boolean) {
  const qty = Number(l.quantity) || 0;
  const price = Number(l.price) || 0;
  const gross = round2(qty * price);
  const disc = round2((gross * (Number(l.discount) || 0)) / 100);
  const taxable = round2(gross - disc);
  // Mirror the API: intra-state splits into CGST + SGST, inter-state is IGST.
  const tax = interState
    ? round2((taxable * l.taxRate) / 100)
    : round2((taxable * l.taxRate) / 200) * 2;
  return { gross, disc, taxable, tax, total: round2(taxable + tax) };
}

export function BillForm({ kind }: { kind: Kind }) {
  const t = COPY[kind];
  const router = useRouter();
  const qc = useQueryClient();
  const { org, experience } = useOrgSettings();

  // Businesses without a GSTIN can't charge GST, so hide the tax column for them.
  const chargesGst = kind === 'purchase' || !!org?.gstin;
  const defaultTax = chargesGst ? 18 : 0;

  const [party, setParty] = useState<SelectOption | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [emptyLine(defaultTax)]);
  const [payStatus, setPayStatus] = useState<PayStatus>('full');
  const [payMode, setPayMode] = useState<PaymentMode>('CASH');
  const [partAmount, setPartAmount] = useState('');
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedPurchase, setSavedPurchase] = useState<{ total: number; supplier: string } | null>(null);

  const orgState = String(org?.address?.state || '').trim().toLowerCase();
  const partyState = String(party?.data?.billingAddress?.state || '').trim().toLowerCase();
  const interState = kind === 'sale' && !!orgState && !!partyState && orgState !== partyState;

  const filled = lines.filter(l => l.productId);
  const totals = filled.reduce((acc, l) => {
    const a = lineAmounts(l, interState);
    return { subtotal: acc.subtotal + a.taxable, tax: acc.tax + a.tax, total: acc.total + a.total, discount: acc.discount + a.disc };
  }, { subtotal: 0, tax: 0, total: 0, discount: 0 });
  const total = round2(totals.total);
  const paid = payStatus === 'full' ? total : payStatus === 'part' ? Math.min(Number(partAmount) || 0, total) : 0;

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: number, opt: SelectOption | null) => {
    if (!opt) return;
    const p = opt.data || {};
    const price = itemPrice(p, kind === 'sale' ? 'sellingPrice' : 'purchasePrice');
    setLines(ls => {
      const next = ls.map(l => l.key === key ? {
        ...l,
        productId: opt.id,
        name: opt.label,
        price: price ? String(price) : '',
        taxRate: chargesGst ? Number(p.taxRate ?? defaultTax) : 0,
        hsnCode: p.hsnCode || undefined,
        isNew: !!p.__new,
      } : l);
      // Always keep one empty row at the bottom, like a till.
      return next[next.length - 1].productId ? [...next, emptyLine(defaultTax)] : next;
    });
    setErrors(e => ({ ...e, items: '' }));
  };

  const removeLine = (key: number) =>
    setLines(ls => {
      const next = ls.filter(l => l.key !== key);
      return next.length && !next[next.length - 1].productId ? next : [...next, emptyLine(defaultTax)];
    });

  const validate = () => {
    const e: Record<string, string> = {};
    if (kind === 'purchase' && !party) e.party = 'Choose the supplier you bought from.';
    if (kind === 'sale' && !party && payStatus !== 'full') e.party = 'To sell on credit, choose who is buying, so you can track who owes you.';
    if (!filled.length) e.items = 'Add at least one item.';
    const bad = filled.find(l => !(Number(l.quantity) > 0));
    if (bad) e.items = `Enter a quantity for “${bad.name}”.`;
    if (filled.length && total <= 0) e.items = 'The bill total is zero. Enter a price for your items.';
    if (payStatus === 'part' && !(Number(partAmount) > 0)) e.paid = 'Enter how much was paid.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (andNew = false) => {
    if (!validate()) return;
    setSaving(true);
    try {
      let createdId: string | null = null;
      if (kind === 'sale') {
        const res = await api.invoices.create({
          customerId: party?.id,
          invoiceDate: date,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          autoConfirm: true,
          items: filled.map((l, i) => {
            const half = l.taxRate / 2;
            return {
              productId: l.productId!,
              description: l.name,
              hsnCode: l.hsnCode,
              quantity: Number(l.quantity),
              unitPrice: Number(l.price) || 0,
              discountType: 'PERCENTAGE',
              discountValue: Number(l.discount) || 0,
              taxRate: l.taxRate,
              cgstRate: interState ? 0 : half,
              sgstRate: interState ? 0 : half,
              igstRate: interState ? l.taxRate : 0,
              sortOrder: i,
            };
          }),
        });
        createdId = res.data.data.id;
        if (paid > 0) {
          try {
            await api.invoices.recordPayment(createdId!, { amount: paid, mode: payMode, paymentDate: date });
          } catch (e: any) {
            toast.error(`Sale saved, but the payment wasn't recorded: ${e?.response?.data?.message || 'please add it from the bill'}`);
          }
        }
      } else {
        await api.purchases.create({
          supplierId: party!.id,
          purchaseDate: date,
          dueDate: dueDate || undefined,
          billNumber: billNumber || undefined,
          notes: notes || undefined,
          paymentMode: paid > 0 ? payMode : 'CREDIT',
          amountPaid: paid,
          items: filled.map(l => ({
            productId: l.productId!,
            description: l.name,
            quantity: Number(l.quantity),
            unitPrice: Number(l.price) || 0,
            discountType: 'PERCENTAGE',
            discountValue: Number(l.discount) || 0,
            taxRate: l.taxRate,
            hsnCode: l.hsnCode,
          })),
        });
      }

      // Items added on the fly were saved without a price; remember the one just used.
      const priceKey = kind === 'sale' ? 'sellingPrice' : 'purchasePrice';
      filled.filter(l => l.isNew && Number(l.price) > 0).forEach(l => {
        api.products.update(l.productId!, { [priceKey]: Number(l.price), taxRate: l.taxRate }).catch(() => {});
      });

      ['dashboard', 'invoices', 'purchases', 'products', 'item-picker', 'customer-picker', 'supplier-picker', 'organization', 'dues', 'unpaid-bills', 'report-outstanding']
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }));

      toast.success(kind === 'sale' ? 'Sale saved' : 'Purchase saved');
      if (andNew) {
        reset();
      } else if (kind === 'sale' && createdId) {
        router.push(`/billing/invoices/${createdId}?created=1`);
      } else {
        setSavedPurchase({ total, supplier: party?.label || '' });
      }
    } catch (e: any) {
      const details = e?.response?.data?.details ?? e?.response?.data?.errors;
      const first = Array.isArray(details) && details[0] ? `${details[0].field}: ${details[0].message}` : '';
      toast.error(e?.response?.data?.message ? `${e.response.data.message}${first ? ` (${first})` : ''}` : 'Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setParty(null); setLines([emptyLine(defaultTax)]); setPayStatus('full'); setPartAmount('');
    setDueDate(''); setBillNumber(''); setNotes(''); setErrors({}); setSavedPurchase(null);
  };

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none';
  const label = 'block text-sm font-semibold text-gray-900 dark:text-white mb-1';
  const step = 'w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-xs font-bold flex items-center justify-center flex-shrink-0';

  if (savedPurchase) {
    return (
      <div className="max-w-xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Purchase saved</h1>
            <p className="text-gray-500 mt-1">{formatCurrency(savedPurchase.total)} from {savedPurchase.supplier}. Stock has been updated.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button onClick={reset}>Record another purchase</Button>
            <Link href="/purchases"><Button variant="secondary" className="w-full">See all purchases</Button></Link>
            <Link href="/dashboard"><Button variant="ghost" className="w-full">Back to Home</Button></Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Back" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.title}</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ml-auto px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" aria-label="Date" />
      </div>

      {/* 1. Party */}
      <Card className="p-5 space-y-2">
        <div className="flex items-center gap-2"><span className={step}>1</span><label className={cn(label, 'mb-0')}>{t.who}</label></div>
        <PartyPicker
          kind={kind === 'sale' ? 'customer' : 'supplier'}
          value={party?.id ?? null}
          selectedLabel={party?.label}
          onChange={opt => { setParty(opt); setErrors(e => ({ ...e, party: '' })); }}
          allowWalkIn={kind === 'sale'}
          autoFocus={kind === 'purchase'}
          error={errors.party}
        />
        <p className="text-xs text-gray-500">{t.whoHint}</p>
      </Card>

      {/* 2. Items */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className={step}>2</span><label className={cn(label, 'mb-0')}>Items</label>
          <button type="button" onClick={() => setShowDiscount(s => !s)} className="ml-auto text-xs text-gray-500 hover:text-orange-600">
            {showDiscount ? 'Hide discount' : '+ Add discount'}
          </button>
        </div>

        <div className="hidden md:grid gap-2 text-xs font-semibold text-gray-500 uppercase px-1" style={{ gridTemplateColumns: gridCols(chargesGst, showDiscount) }}>
          <span>Item</span><span>Qty</span><span>Price</span>{showDiscount && <span>Disc %</span>}{chargesGst && <span>GST</span>}<span className="text-right">Amount</span><span />
        </div>

        <div className="space-y-3 md:space-y-2">
          {lines.map(l => {
            const a = lineAmounts(l, interState);
            const empty = !l.productId;
            return (
              <div key={l.key} className="grid gap-2 items-start md:items-center border-b md:border-0 border-gray-100 dark:border-gray-700 pb-3 md:pb-0 grid-cols-2 md:[grid-template-columns:var(--cols)]" style={{ ['--cols' as any]: gridCols(chargesGst, showDiscount) }}>
                <div className="col-span-2 md:col-span-1">
                  <ItemPicker
                    value={l.productId}
                    selectedLabel={l.name}
                    onChange={opt => pickItem(l.key, opt)}
                    priceField={kind === 'sale' ? 'sellingPrice' : 'purchasePrice'}
                    trackInventory={experience !== 'simple'}
                  />
                </div>
                {!empty && <>
                  <input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={e => updateLine(l.key, { quantity: e.target.value })} className={inputCls} placeholder="Qty" />
                  <input aria-label="Price" inputMode="decimal" value={l.price} onChange={e => updateLine(l.key, { price: e.target.value })} className={cn(inputCls, l.isNew && !l.price && 'ring-2 ring-orange-300')} placeholder="Price ₹" autoFocus={l.isNew} />
                  {showDiscount && <input aria-label="Discount percent" inputMode="decimal" value={l.discount} onChange={e => updateLine(l.key, { discount: e.target.value })} className={inputCls} placeholder="Disc %" />}
                  {chargesGst && (
                    <select aria-label="GST rate" value={l.taxRate} onChange={e => updateLine(l.key, { taxRate: Number(e.target.value) })} className={inputCls}>
                      {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  )}
                  <p className="text-right font-semibold text-gray-900 dark:text-white text-sm py-2.5">{formatCurrency(a.total)}</p>
                  <button type="button" onClick={() => removeLine(l.key)} aria-label={`Remove ${l.name}`} className="p-2 justify-self-end rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>
                </>}
              </div>
            );
          })}
        </div>
        {errors.items && <p className="text-red-500 text-sm">{errors.items}</p>}
        {!chargesGst && kind === 'sale' && (
          <p className="text-xs text-gray-500 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> GST is off because your business has no GSTIN. <Link href="/settings" className="text-orange-600 hover:underline">Add GSTIN</Link></p>
        )}

        {filled.length > 0 && (
          <div className="flex justify-end pt-2">
            <div className="w-full sm:w-72 space-y-1.5 text-sm">
              {totals.discount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatCurrency(totals.discount)}</span></div>}
              {chargesGst && <div className="flex justify-between text-gray-500"><span>Before tax</span><span>{formatCurrency(totals.subtotal)}</span></div>}
              {chargesGst && <div className="flex justify-between text-gray-500"><span>{interState ? 'IGST' : 'GST (CGST + SGST)'}</span><span>{formatCurrency(totals.tax)}</span></div>}
              <div className="flex justify-between text-lg font-bold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700 pt-2"><span>Total</span><span>{formatCurrency(total)}</span></div>
            </div>
          </div>
        )}
      </Card>

      {/* 3. Payment */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2"><span className={step}>3</span><label className={cn(label, 'mb-0')}>{t.paidLabel}</label></div>
        <div className="grid grid-cols-3 gap-2">
          {(['full', 'part', 'none'] as PayStatus[]).map(s => (
            <button key={s} type="button" onClick={() => { setPayStatus(s); setErrors(e => ({ ...e, party: '', paid: '' })); }}
              className={cn('py-2.5 rounded-lg border-2 text-sm font-medium transition', payStatus === s ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
              {t[s]}
            </button>
          ))}
        </div>
        {payStatus !== 'none' && (
          <div className="flex flex-wrap items-center gap-2">
            {payStatus === 'part' && (
              <input inputMode="decimal" value={partAmount} onChange={e => setPartAmount(e.target.value)} placeholder="Amount paid ₹" className={cn(inputCls, 'w-40')} />
            )}
            <span className="text-sm text-gray-500">by</span>
            {PAYMENT_MODES.map(m => (
              <button key={m.value} type="button" onClick={() => setPayMode(m.value)}
                className={cn('px-3 py-1.5 rounded-full text-sm border transition', payMode === m.value ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400')}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {errors.paid && <p className="text-red-500 text-sm">{errors.paid}</p>}
        {payStatus !== 'full' && filled.length > 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400">Balance due: <strong>{formatCurrency(total - paid)}</strong>. {t.noneHint}</p>
        )}
      </Card>

      {/* Optional details */}
      <Card className="overflow-hidden">
        <button type="button" onClick={() => setShowMore(s => !s)} className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
          More details (optional): due date, {kind === 'purchase' ? 'supplier bill no., ' : ''}notes
          <ChevronDown className={cn('w-4 h-4 transition-transform', showMore && 'rotate-180')} />
        </button>
        {showMore && (
          <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Payment due by</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} /></div>
            {kind === 'purchase' && <div><label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Supplier&apos;s bill number</label><input value={billNumber} onChange={e => setBillNumber(e.target.value)} className={inputCls} placeholder="As printed on their bill" /></div>}
            <div className="md:col-span-2"><label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Note</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} placeholder={kind === 'sale' ? 'Printed on the bill, e.g. “Thank you for shopping!”' : 'For your reference only'} /></div>
          </div>
        )}
      </Card>

      {/* Sticky save bar, so the main action is always one tap away */}
      <div className="sticky bottom-0 -mb-4 md:-mb-6 z-20 bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-t-xl shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="px-4 md:px-5 py-3 flex items-center gap-3">
          <div>
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(total)}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => save(true)} disabled={saving} className="hidden sm:inline-flex">Save &amp; start new</Button>
            <Button size="lg" onClick={() => save(false)} loading={saving}>{t.save}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function gridCols(gst: boolean, discount: boolean) {
  return ['minmax(0,1fr)', '5rem', '7rem', discount && '5rem', gst && '5.5rem', '7rem', '2.5rem'].filter(Boolean).join(' ');
}
