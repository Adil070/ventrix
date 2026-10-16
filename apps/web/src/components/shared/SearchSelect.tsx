'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  id: string;
  label: string;
  sublabel?: string;
  data?: any;
}

interface SearchSelectProps {
  value: string | null;
  selectedLabel?: string;
  options: SelectOption[];
  onSelect: (option: SelectOption | null) => void;
  onQueryChange?: (query: string) => void;
  onCreate?: (query: string) => Promise<SelectOption | void>;
  createLabel?: (query: string) => string;
  // A "none" choice shown first, e.g. "Walk-in customer".
  nullOption?: { label: string; sublabel?: string };
  placeholder?: string;
  loading?: boolean;
  autoFocus?: boolean;
  className?: string;
  error?: string;
}

export function SearchSelect({
  value, selectedLabel, options, onSelect, onQueryChange, onCreate, createLabel,
  nullOption, placeholder = 'Search…', loading, autoFocus, className, error,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
    : options;
  const exactMatch = options.some(o => o.label.toLowerCase() === q);

  type Row = { kind: 'null' } | { kind: 'option'; option: SelectOption } | { kind: 'create' };
  const rows: Row[] = [
    ...(nullOption && !q ? [{ kind: 'null' as const }] : []),
    ...filtered.slice(0, 50).map(option => ({ kind: 'option' as const, option })),
    ...(onCreate && q && !exactMatch ? [{ kind: 'create' as const }] : []),
  ];

  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => { onQueryChange?.(query); }, [query, onQueryChange]);
  // Keep the highlighted option visible by scrolling the list itself; scrollIntoView would also scroll the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [active]);

  const close = () => { setOpen(false); setQuery(''); };

  const choose = async (row: Row) => {
    if (row.kind === 'null') onSelect(null);
    else if (row.kind === 'option') onSelect(row.option);
    else if (onCreate) {
      setCreating(true);
      try {
        const created = await onCreate(query.trim());
        if (created) onSelect(created);
      } finally {
        setCreating(false);
      }
    }
    close();
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) choose(rows[active]); }
    else if (e.key === 'Escape') { close(); }
  };

  const display = open ? query : (value ? selectedLabel ?? '' : nullOption?.label ?? '');

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={display}
          placeholder={placeholder}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(close, 120)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full pl-3 pr-9 py-2.5 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent',
            error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600',
          )}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {loading || creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}

      {open && (
        <div
          ref={listRef}
          onMouseDown={e => e.preventDefault()}
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1"
        >
          {rows.length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-500">{loading ? 'Searching…' : 'No matches'}</p>
          )}
          {rows.map((row, i) => {
            const isActive = i === active;
            const base = cn('w-full flex items-center gap-2 px-3 py-2 text-left text-sm', isActive ? 'bg-orange-50 dark:bg-orange-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700');
            if (row.kind === 'create') {
              return (
                <button key="create" type="button" data-index={i} onMouseEnter={() => setActive(i)} onClick={() => choose(row)} className={cn(base, 'text-orange-600 font-medium border-t border-gray-100 dark:border-gray-700')}>
                  <Plus className="w-4 h-4" /> {createLabel ? createLabel(query.trim()) : `Add “${query.trim()}”`}
                </button>
              );
            }
            const label = row.kind === 'null' ? nullOption!.label : row.option.label;
            const sub = row.kind === 'null' ? nullOption!.sublabel : row.option.sublabel;
            const selected = row.kind === 'null' ? !value : row.option.id === value;
            return (
              <button key={row.kind === 'null' ? '__null' : row.option.id} type="button" data-index={i} onMouseEnter={() => setActive(i)} onClick={() => choose(row)} className={base}>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-gray-900 dark:text-white">{label}</span>
                  {sub && <span className="block truncate text-xs text-gray-500">{sub}</span>}
                </span>
                {selected && <Check className="w-4 h-4 text-orange-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
