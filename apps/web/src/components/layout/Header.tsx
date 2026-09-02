'use client';

import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { useRouter } from 'next/navigation';
import { Menu, Bell, Search, ChevronDown, Sun, Moon, LogOut, User, Settings, Building2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { generateInitials, cn } from '@/lib/utils';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';

export function Header() {
  const { user, currentOrganization, logout } = useAuthStore();
  const { toggleSidebar } = useUIStore();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    logout();
    router.push('/auth/login');
    toast.success('Logged out successfully');
  };

  return (
    <header className="flex items-center gap-4 px-4 md:px-6 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-10 min-h-[65px]">
      <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
        <Menu className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </button>

      {/* Search */}
      <div className="flex-1 max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" placeholder="Search invoices, customers, products... (Ctrl+K)"
            className="w-full pl-10 pr-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 border border-transparent focus:border-orange-300 focus:bg-white dark:focus:bg-gray-600 rounded-lg outline-none transition"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Theme toggle */}
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          {theme === 'dark' ? <Sun className="w-5 h-5 text-gray-400" /> : <Moon className="w-5 h-5 text-gray-600" />}
        </button>

        {/* Notifications */}
        <Link href="/notifications" className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full" />
        </Link>

        {/* User menu */}
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
                <Link href="/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <User className="w-4 h-4" /> Profile
                </Link>
                <Link href="/settings/organization" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <Building2 className="w-4 h-4" /> Organization
                </Link>
                <Link href="/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <Settings className="w-4 h-4" /> Settings
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
