'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Printer, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, Card } from '@/components/shared';
import { PAPER_OPTIONS, getPrintPrefs, setPrintPrefs, printInvoice, type PrintPrefs } from '@/lib/printing';

// Printer settings for this computer (stored on the device, since each counter has its own printer).
export function PrintSettingsCard() {
  const [prefs, setPrefs] = useState<PrintPrefs | null>(null);
  const [testing, setTesting] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setPrefs(getPrintPrefs()); setOrigin(window.location.origin); }, []);

  if (!prefs) return null;

  const save = (patch: Partial<PrintPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setPrintPrefs(next);
    toast.success('Printer setting saved on this computer');
  };

  const testPrint = async () => {
    setTesting(true);
    await printInvoice('sample', prefs.paper);
    setTesting(false);
  };

  const shortcut = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${origin}`;
  const copyShortcut = async () => {
    try { await navigator.clipboard.writeText(shortcut); toast.success('Copied'); } catch { toast.error('Select the text and copy it'); }
  };

  const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';
  const step = 'w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-xs font-bold flex items-center justify-center flex-shrink-0';

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Printing</h3>
        <p className="text-sm text-gray-500">Settings for this computer only. Other computers and phones keep their own.</p>
      </div>

      <div>
        <p className={label}>Which printer does this computer use?</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PAPER_OPTIONS.map(o => (
            <button key={o.value} type="button" onClick={() => save({ paper: o.value })}
              className={cn('p-3 rounded-lg border-2 text-left transition', prefs.paper === o.value ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300')}>
              <p className={cn('text-sm font-semibold', prefs.paper === o.value ? 'text-orange-700 dark:text-orange-300' : 'text-gray-800 dark:text-gray-200')}>{o.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{o.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" className="mt-1" checked={prefs.autoPrint} onChange={e => save({ autoPrint: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">Print the bill automatically after saving a sale</span>
          <span className="block text-xs text-gray-500">Saves a click at a busy counter. You can always reprint from the bill.</span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={testPrint} loading={testing}><Printer className="w-4 h-4" /> Print test receipt</Button>
        <a href={`/print/invoice/sample?paper=${prefs.paper}`} target="_blank" rel="noreferrer"><Button type="button" variant="secondary">Preview</Button></a>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-5 space-y-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Setting up a receipt printer (USB, Windows)</h4>
        <div className="flex gap-3"><span className={step}>1</span><p className="text-sm text-gray-600 dark:text-gray-300">Install the printer's Windows driver (from the box or the maker's website) and plug it in by USB. In Windows <b>Printers &amp; scanners</b>, make it the <b>default printer</b> and set its paper to the 80 mm (or 58 mm) roll.</p></div>
        <div className="flex gap-3"><span className={step}>2</span><p className="text-sm text-gray-600 dark:text-gray-300">Click <b>Print test receipt</b>. In Chrome's print window choose the receipt printer, set <b>Margins: None</b>, and print. Chrome remembers these choices.</p></div>
        <div className="flex gap-3"><span className={step}>3</span>
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2 min-w-0">
            <p><b>Optional: print with one click, no print window.</b> Make a desktop shortcut that opens Chrome in silent-print mode and use it for billing. Right-click the desktop → New → Shortcut, and paste:</p>
            <div className="flex items-start gap-2">
              <code className="flex-1 min-w-0 break-all text-xs bg-gray-100 dark:bg-gray-700 rounded p-2">{shortcut}</code>
              <button type="button" onClick={copyShortcut} aria-label="Copy shortcut" className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><Copy className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500">Close all Chrome windows first, then open Ventrix from this shortcut. Bills then go straight to the default printer.</p>
          </div>
        </div>
        <p className="text-xs text-gray-500">On an Android phone or tablet, Print opens Android's print screen. A Bluetooth receipt printer needs its maker's print app (or a print-service app) installed first.</p>
      </div>
    </Card>
  );
}
