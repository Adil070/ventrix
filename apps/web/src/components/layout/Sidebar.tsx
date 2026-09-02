'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { Logo } from '@/components/shared/Logo';
import {
  LayoutDashboard, Users, ShoppingCart, Package, Truck, FileText,
  BarChart3, Settings, CreditCard, Receipt, TrendingUp, Warehouse,
  UserCheck, FolderOpen, Bell, ChevronDown, Building2, Calculator,
  ClipboardList, DollarSign, Tag, Cog, Star, Factory, HelpCircle,
  X, Menu, ArrowLeftRight
} from 'lucide-react';
import { useState } from 'react';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Invoices', href: '/billing/invoices', icon: FileText },
      { label: 'Quotations', href: '/billing/quotations', icon: ClipboardList },
      { label: 'Sales Orders', href: '/billing/orders', icon: ShoppingCart },
      { label: 'Customers', href: '/customers', icon: Users },
      { label: 'Payments In', href: '/payments', icon: DollarSign },
      { label: 'Returns & CN', href: '/returns', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Purchases',
    items: [
      { label: 'Purchase Bills', href: '/purchases', icon: Receipt },
      { label: 'Suppliers', href: '/suppliers', icon: Truck },
      { label: 'Payments Out', href: '/payments?type=PAYMENT', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Products', href: '/products', icon: Package },
      { label: 'Stock Management', href: '/inventory', icon: Warehouse },
      { label: 'Warehouses', href: '/warehouse', icon: Building2 },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { label: 'Chart of Accounts', href: '/accounting', icon: Calculator },
      { label: 'Banking', href: '/banking', icon: CreditCard },
      { label: 'Expenses', href: '/expenses', icon: Tag },
      { label: 'GST', href: '/gst', icon: Star },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'CRM / Leads', href: '/crm/leads', icon: TrendingUp },
      { label: 'Manufacturing', href: '/manufacturing', icon: Factory },
      { label: 'Employees', href: '/employees', icon: UserCheck },
      { label: 'Documents', href: '/documents', icon: FolderOpen },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Sales Reports', href: '/reports?type=sales', icon: BarChart3 },
      { label: 'Purchase Reports', href: '/reports?type=purchases', icon: BarChart3 },
      { label: 'Analytics', href: '/analytics', icon: TrendingUp },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', href: '/settings', icon: Cog },
      { label: 'Subscription', href: '/subscriptions', icon: Star },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { currentOrganization } = useAuthStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleGroup = (label: string) => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={cn(
        'fixed md:relative z-30 flex flex-col h-screen bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300',
        sidebarOpen ? 'w-64 translate-x-0' : 'w-0 md:w-16 -translate-x-full md:translate-x-0 overflow-hidden',
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700 min-h-[65px]">
          <Logo size={36} className="flex-shrink-0" />
          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 dark:text-white truncate text-sm">{currentOrganization?.name || 'Ventrix'}</p>
              <p className="text-xs text-gray-500 truncate">Engineered for Scale</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navGroups.map(group => (
            <div key={group.label}>
              {sidebarOpen && (
                <button onClick={() => toggleGroup(group.label)} className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 transition">
                  {group.label}
                  <ChevronDown className={cn('w-3 h-3 transition-transform', collapsed[group.label] && 'rotate-180')} />
                </button>
              )}
              {!collapsed[group.label] && (
                <div className="space-y-0.5 mt-1">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link key={item.href} href={item.href} className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                        isActive ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white',
                        !sidebarOpen && 'justify-center px-2',
                      )}>
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {sidebarOpen && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
              {sidebarOpen && <div className="mt-2 mb-1" />}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          <Link href="/settings" className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition', !sidebarOpen && 'justify-center')}>
            <HelpCircle className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span>Help & Support</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
