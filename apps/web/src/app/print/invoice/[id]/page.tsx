'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useOrganization } from '@/hooks/useOrganization';
import { getPrintPrefs, type PaperSize } from '@/lib/printing';
import { InvoicePrint, PRINT_CSS, SAMPLE_INVOICE } from '@/components/billing/InvoicePrint';

const PAPERS: PaperSize[] = ['80mm', '58mm', 'A4'];
const PX_PER_MM = 96 / 25.4;

// Printable bill, outside the app shell (no menu or header). Opened in a hidden iframe by printInvoice(), or
// directly in a tab (e.g. on a phone, to print through Android's print service). ?auto=1 prints on load.
export default function PrintInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const requested = params.get('paper') as PaperSize | null;
  const paper: PaperSize = requested && PAPERS.includes(requested) ? requested : getPrintPrefs().paper;
  const auto = params.get('auto') === '1';
  const isSample = id === 'sample';

  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { data: org } = useOrganization();
  const { data: invoice, isError } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.invoices.get(id),
    select: r => r.data.data?.invoice ?? r.data.data,
    enabled: _hasHydrated && isAuthenticated && !isSample,
  });
  const bill = isSample ? SAMPLE_INVOICE : invoice;

  const billRef = useRef<HTMLDivElement>(null);
  const [pageCss, setPageCss] = useState('');
  const printed = useRef(false);

  // Size the page to the bill: a receipt is exactly as long as its content, so the printer doesn't feed
  // a metre of blank paper. A4 keeps the normal page.
  useEffect(() => {
    if (!bill || !org || !billRef.current) return;
    if (paper === 'A4') {
      setPageCss('@page { size: A4; margin: 0; }');
      return;
    }
    const heightMm = Math.ceil(billRef.current.scrollHeight / PX_PER_MM) + 6;
    setPageCss(`@page { size: ${paper === '58mm' ? 58 : 80}mm ${heightMm}mm; margin: 0; }`);
  }, [bill, org, paper]);

  useEffect(() => {
    if (!auto || !pageCss || printed.current) return;
    printed.current = true;
    const done = () => window.parent?.postMessage({ type: 'ventrix:printed' }, window.location.origin);
    window.addEventListener('afterprint', done, { once: true });
    // Wait for fonts so the measured height matches what prints.
    Promise.resolve(document.fonts?.ready).then(() => setTimeout(() => window.print(), 100));
  }, [auto, pageCss]);

  if (_hasHydrated && !isAuthenticated) return <p style={{ padding: 16, fontFamily: 'Arial' }}>Please sign in to print bills.</p>;
  if (isError) return <p style={{ padding: 16, fontFamily: 'Arial' }}>This bill could not be loaded.</p>;
  if (!bill || !org) return <p style={{ padding: 16, fontFamily: 'Arial' }}>Preparing bill…</p>;

  return (
    <>
      <style>{PRINT_CSS + pageCss}</style>
      <div ref={billRef}>
        <InvoicePrint invoice={bill} org={org} paper={paper} />
      </div>
    </>
  );
}
