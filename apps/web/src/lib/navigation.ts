import {
  Home, FileText, Receipt, Wallet, Tag, Users, Truck, Package, Warehouse, BarChart3,
  ClipboardList, ShoppingCart, ArrowLeftRight, Building2, Calculator, CreditCard, Landmark,
  TrendingUp, Factory, UserCheck, FolderOpen, Star, Cog, PieChart,
  ShoppingBag, ArrowDownCircle, ArrowUpCircle, UserPlus, PackagePlus, type LucideIcon,
} from 'lucide-react';
import type { Experience } from './business';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Smallest experience level where this item shows in the main menu. Below it, the item moves to "More tools".
  minExperience: Experience;
  hint?: string;
  keywords?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Ordered by how often people use them: daily work first, setup and rarely used tools last.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Daily work',
    items: [
      { label: 'Sales', href: '/billing/invoices', icon: FileText, minExperience: 'simple', hint: 'Bills you gave to customers', keywords: 'invoice bill sell' },
      { label: 'Purchases', href: '/purchases', icon: Receipt, minExperience: 'simple', hint: 'Bills from your suppliers', keywords: 'buy purchase bill' },
      { label: 'Payments', href: '/payments', icon: Wallet, minExperience: 'simple', hint: 'Money received and paid', keywords: 'money receipt cash' },
      { label: 'Expenses', href: '/expenses', icon: Tag, minExperience: 'simple', hint: 'Rent, salary, electricity…', keywords: 'cost spend' },
    ],
  },
  {
    label: 'People & items',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, minExperience: 'simple', keywords: 'party client buyer' },
      { label: 'Suppliers', href: '/suppliers', icon: Truck, minExperience: 'simple', keywords: 'party vendor seller' },
      { label: 'Items', href: '/products', icon: Package, minExperience: 'simple', hint: 'Products and services you sell', keywords: 'product service sku' },
      { label: 'Stock', href: '/inventory', icon: Warehouse, minExperience: 'growing', keywords: 'inventory adjust' },
    ],
  },
  {
    label: 'Sales tools',
    items: [
      { label: 'Quotations', href: '/billing/quotations', icon: ClipboardList, minExperience: 'growing', keywords: 'estimate quote' },
      { label: 'Sales orders', href: '/billing/orders', icon: ShoppingCart, minExperience: 'growing', keywords: 'order' },
      { label: 'Returns', href: '/returns', icon: ArrowLeftRight, minExperience: 'growing', keywords: 'credit note refund' },
      { label: 'Leads', href: '/crm/leads', icon: TrendingUp, minExperience: 'warehouse', keywords: 'crm pipeline' },
    ],
  },
  {
    label: 'Accounts & tax',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3, minExperience: 'simple', hint: 'Profit, sales, who owes what', keywords: 'profit loss summary' },
      { label: 'GST', href: '/gst', icon: Star, minExperience: 'growing', keywords: 'gstr tax return' },
      { label: 'Bank accounts', href: '/banking', icon: Landmark, minExperience: 'growing', keywords: 'bank reconcile' },
      { label: 'Analytics', href: '/analytics', icon: PieChart, minExperience: 'warehouse', keywords: 'charts trends' },
      { label: 'Accounting', href: '/accounting', icon: Calculator, minExperience: 'warehouse', keywords: 'ledger journal chart of accounts' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Warehouses', href: '/warehouse', icon: Building2, minExperience: 'warehouse', keywords: 'location godown' },
      { label: 'Manufacturing', href: '/manufacturing', icon: Factory, minExperience: 'warehouse', keywords: 'bom production' },
      { label: 'Employees', href: '/employees', icon: UserCheck, minExperience: 'warehouse', keywords: 'staff attendance' },
      { label: 'Documents', href: '/documents', icon: FolderOpen, minExperience: 'warehouse', keywords: 'files upload' },
    ],
  },
];

export const ACCOUNT_ITEMS: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Cog, minExperience: 'simple', keywords: 'business details gstin address' },
  { label: 'Subscription', href: '/subscriptions', icon: CreditCard, minExperience: 'simple', keywords: 'plan billing upgrade' },
];

export const HOME_ITEM: NavItem = { label: 'Home', href: '/dashboard', icon: Home, minExperience: 'simple', keywords: 'dashboard' };

export interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
}

// The everyday tasks. Shown on Home, in the header "+ New" menu and in the command palette.
export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'New sale', description: 'Make a bill for a customer', href: '/billing/invoices/new', icon: ShoppingBag, keywords: 'invoice bill sell' },
  { label: 'New purchase', description: 'Record stock or goods you bought', href: '/purchases/new', icon: Receipt, keywords: 'buy purchase bill' },
  { label: 'Receive money', description: 'A customer paid you', href: '/payments?new=in', icon: ArrowDownCircle, keywords: 'payment in receipt collect' },
  { label: 'Pay a supplier', description: 'You paid a supplier', href: '/payments?new=out', icon: ArrowUpCircle, keywords: 'payment out' },
  { label: 'Add expense', description: 'Rent, salary, electricity…', href: '/expenses?new=1', icon: Tag, keywords: 'cost spend' },
  { label: 'Add customer', description: 'Save a new customer', href: '/customers?new=1', icon: UserPlus, keywords: 'party client' },
  { label: 'Add supplier', description: 'Save a new supplier', href: '/suppliers?new=1', icon: Truck, keywords: 'party vendor' },
  { label: 'Add item', description: 'Save a product or service', href: '/products?new=1', icon: PackagePlus, keywords: 'product service' },
];

export function isActivePath(pathname: string, href: string) {
  const path = href.split('?')[0];
  return pathname === path || pathname.startsWith(path + '/');
}
