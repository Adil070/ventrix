'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { useUIStore } from '@/store/ui.store';
import { NAV_SECTIONS, ACCOUNT_ITEMS, HOME_ITEM, QUICK_ACTIONS } from '@/lib/navigation';

const itemCls = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer text-gray-700 dark:text-gray-300 data-[selected=true]:bg-orange-50 data-[selected=true]:text-orange-700 dark:data-[selected=true]:bg-orange-900/30 dark:data-[selected=true]:text-orange-300';
const groupCls = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-400';

// One search box for everything: "what do I want to do?" and "where is that screen?".
export function CommandPalette() {
  const router = useRouter();
  const { commandPaletteOpen: open, setCommandPaletteOpen: setOpen } = useUIStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUIStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const pages = [HOME_ITEM, ...NAV_SECTIONS.flatMap(s => s.items), ...ACCOUNT_ITEMS];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search actions and pages"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="fixed z-50 left-1/2 top-[12vh] -translate-x-1/2 w-[calc(100%-2rem)] max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      <Dialog.Title className="sr-only">Search actions and pages</Dialog.Title>
      <div className="flex items-center gap-3 px-4 border-b border-gray-200 dark:border-gray-700">
        <Search className="w-4 h-4 text-gray-400" />
        <Command.Input
          autoFocus
          placeholder="What do you want to do? e.g. new sale, customers, GST"
          className="flex-1 py-4 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
        />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="py-8 text-center text-sm text-gray-500">Nothing found. Try “sale”, “stock” or “report”.</Command.Empty>
        <Command.Group heading="Do something" className={groupCls}>
          {QUICK_ACTIONS.map(a => (
            <Command.Item key={a.href} value={`${a.label} ${a.keywords ?? ''}`} onSelect={() => go(a.href)} className={itemCls}>
              <a.icon className="w-4 h-4 text-orange-500" />
              <span className="font-medium">{a.label}</span>
              <span className="ml-auto text-xs text-gray-400 truncate">{a.description}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Go to" className={groupCls}>
          {pages.map(p => (
            <Command.Item key={p.href} value={`go ${p.label} ${p.keywords ?? ''}`} onSelect={() => go(p.href)} className={itemCls}>
              <p.icon className="w-4 h-4 text-gray-400" />
              <span>{p.label}</span>
              {p.hint && <span className="ml-auto text-xs text-gray-400 truncate">{p.hint}</span>}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
