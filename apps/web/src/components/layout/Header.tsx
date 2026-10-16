'use client';

import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { useRouter } from 'next/navigation';
import { Menu, Bell, Search, ChevronDown, Sun, Moon, LogOut, Settings, Building2, Plus, SlidersHorizontal } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { generateInitials } from '@/lib/utils';
import { QUICK_ACTIONS } from '@/lib/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';

export function Header() {
  const { user, currentOrganization, logout } = useAuthStore();
  const { toggleSidebar, setCommandPaletteOpen } = useUIStore();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    logout();
    router.push('/auth/login');
    toast.success('Logged out successfully');
  };

  const menuLink = 'flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';

  return (
    <header className="no-print flex items-center gap-3 px-4 md:px-6 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-10 min-h-[65px]">
      <button onClick={toggleSidebar} aria-label="Toggle menu" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
        <Menu className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </button>

      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="flex-1 max-w-xl flex items-center gap-3 px-3 py-2 text-sm text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200/70 dark:hover:bg-gray-600 rounded-lg transition text-left"
      >
        <Search className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">Search or jump to… <span className="hidden sm:inline">(new sale, customers, GST)</span></span>
        <kbd className="ml-auto hidden md:inline text-[11px] font-sans px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-500 text-gray-500">Ctrl K</kbd>
      </button>

      <div className="flex items-center gap-2 ml-auto">
        <div className="relative">
          <button
            onClick={() => setNewMenuOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New</span>
            <ChevronDown className="w-3.5 h-3.5 hidden sm:block" />
          </button>
          {newMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNewMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-2">
                {QUICK_ACTIONS.map(a => (
                  <Link key={a.href} href={a.href} onClick={() => setNewMenuOpen(false)} className="flex items-start gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <a.icon className="w-4 h-4 mt-0.5 text-orange-500 flex-shrink-0" />
                    <span>
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{a.label}</span>
                      <span className="block text-xs text-gray-500">{a.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          {theme === 'dark' ? <Sun className="w-5 h-5 text-gray-400" /> : <Moon className="w-5 h-5 text-gray-600" />}
        </button>

        <Link href="/notifications" aria-label="Notifications" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </Link>

        <div className="relative">
          <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
              {generateInitials(user?.firstName || 'U', user?.lastName)}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate max-w-[120px]">{currentOrganization?.name}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 hidden md:block" />
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-2">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <p className="font-medium text-gray-900 dark:text-white">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
                <Link href="/settings" onClick={() => setUserMenuOpen(false)} className={menuLink}>
                  <Building2 className="w-4 h-4" /> Business details
                </Link>
                <Link href="/settings?tab=experience" onClick={() => setUserMenuOpen(false)} className={menuLink}>
                  <SlidersHorizontal className="w-4 h-4" /> App setup
                </Link>
                <Link href="/settings?tab=security" onClick={() => setUserMenuOpen(false)} className={menuLink}>
                  <Settings className="w-4 h-4" /> Password &amp; security
                </Link>
                <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-2">
                  <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
