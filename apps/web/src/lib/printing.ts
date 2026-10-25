/**
 * Bill printing.
 *
 * Bills print through the browser to whatever printer the computer has installed (an 80/58 mm USB thermal
 * receipt printer, or an ordinary A4 printer). The printable bill lives at /print/invoice/[id]; printInvoice()
 * loads it in a hidden iframe and prints it, so the user never leaves the page they are on.
 *
 * Preferences are per device, not per business: the counter PC has the thermal printer, the office laptop
 * may print A4. They live in localStorage and fall back to defaults when storage is unavailable.
 */

export type PaperSize = '80mm' | '58mm' | 'A4';

export interface PrintPrefs {
  paper: PaperSize;
  /** Print the bill as soon as a sale is saved. */
  autoPrint: boolean;
}

export const PAPER_OPTIONS: { value: PaperSize; label: string; hint: string }[] = [
  { value: '80mm', label: 'Receipt printer, 80 mm (3 inch)', hint: 'Most counter thermal printers' },
  { value: '58mm', label: 'Receipt printer, 58 mm (2 inch)', hint: 'Small and portable thermal printers' },
  { value: 'A4', label: 'Normal printer (A4)', hint: 'Laser or inkjet office printer' },
];

const KEY = 'ventrix.printPrefs';
const DEFAULTS: PrintPrefs = { paper: 'A4', autoPrint: false };

export function getPrintPrefs(): PrintPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      paper: PAPER_OPTIONS.some(o => o.value === p.paper) ? p.paper : DEFAULTS.paper,
      autoPrint: p.autoPrint === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setPrintPrefs(prefs: PrintPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // private mode / storage blocked: the choice simply isn't remembered
  }
}

/**
 * Prints a bill (or 'sample' for a test receipt) without leaving the current page. Resolves once the print
 * dialog closes, or after a timeout if the browser never reports it. With Chrome started with
 * --kiosk-printing there is no dialog: it goes straight to the default printer.
 */
export function printInvoice(invoiceId: string, paper: PaperSize = getPrintPrefs().paper): Promise<void> {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.src = `/print/invoice/${encodeURIComponent(invoiceId)}?paper=${paper}&auto=1`;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('message', onMessage);
      // Removing the frame while the dialog is still open cancels the print, so wait a moment.
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'ventrix:printed' && e.source === frame.contentWindow) finish();
    };
    window.addEventListener('message', onMessage);
    setTimeout(finish, 60_000);
    document.body.appendChild(frame);
  });
}
