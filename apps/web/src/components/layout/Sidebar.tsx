'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { Logo } from '@/components/shared/Logo';
import { ChevronDown, Plus, Grid2X2 } from 'lucide-react';
import { useOrgSettings } from '@/hooks/useOrganization';
import { EXPERIENCE_RANK } from '@/lib/business';
import { NAV_SECTIONS, ACCOUNT_ITEMS, HOME_ITEM, isActivePath, type NavItem } from '@/lib/navigation';

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const { setSidebarOpen } = useUIStore();
  const Icon = item.icon;
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : item.hint}
      onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { currentOrganization } = useAuthStore();
  const { experience } = useOrgSettings();
  const collapsed = !sidebarOpen;

  const rank = EXPERIENCE_RANK[experience];
  const visibleSections = NAV_SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => EXPERIENCE_RANK[i.minExperience] <= rank) }))
    .filter(s => s.items.length > 0);
  const moreTools = NAV_SECTIONS.flatMap(s => s.items).filter(i => EXPERIENCE_RANK[i.minExperience] > rank);

  // Keep "More tools" open when the current page lives in it, so people can see where they are.
  const inMoreTools = moreTools.some(i => isActivePath(pathname, i.href));
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = moreOpen || inMoreTools;

  // On phones the menu overlays the page, so start closed there.
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [setSidebarOpen]);

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={cn(
        'no-print fixed md:relative z-30 flex flex-col h-screen bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300',
        sidebarOpen ? 'w-64 translate-x-0' : 'w-0 md:w-16 -translate-x-full md:translate-x-0 overflow-hidden',
      )}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700 min-h-[65px]">
          <Logo size={36} className="flex-shrink-0" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 dark:text-white truncate text-sm">{currentOrganization?.name || 'Ventrix'}</p>
              <p className="text-xs text-gray-500 truncate">Engineered for Scale</p>
            </div>
          )}
        </div>

        {/* The one thing most people open the app to do */}
        <div className={cn('px-3 pt-4', collapsed && 'px-2')}>
          <Link
            href="/billing/invoices/new"
            title="New sale"
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 shadow-sm transition',
              collapsed && 'px-0',
            )}
          >
            <Plus className="w-4 h-4" />
            {!collapsed && 'New sale'}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-4">
          <NavLink item={HOME_ITEM} collapsed={collapsed} />

          {visibleSections.map(section => (
            <div key={section.label} className="space-y-0.5">
              {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p>}
              {section.items.map(item => <NavLink key={item.href} item={item} collapsed={collapsed} />)}
            </div>
          ))}

          {/* Collapsed rail stays short; hidden tools are still reachable from the search (Ctrl+K). */}
          {moreTools.length > 0 && !collapsed && (
            <div className="space-y-0.5">
              <button
                onClick={() => setMoreOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                <span className="flex items-center gap-3"><Grid2X2 className="w-4 h-4" /> More tools</span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', showMore && 'rotate-180')} />
              </button>
              {showMore && moreTools.map(item => <NavLink key={item.href} item={item} collapsed={false} />)}
              {showMore && (
                <Link href="/settings?tab=experience" className="block px-3 pt-1 text-xs text-gray-400 hover:text-orange-600">
                  Use these often? Switch your app setup →
                </Link>
              )}
            </div>
          )}
        </nav>

        <div className="p-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
          {ACCOUNT_ITEMS.map(item => <NavLink key={item.href} item={item} collapsed={collapsed} />)}
        </div>
      </aside>
    </>
  );
}
