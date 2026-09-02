'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useUIStore } from '@/store/ui.store';
import { cn } from '@/lib/utils';
import { motion } from '@/components/ui/motion';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { sidebarOpen } = useUIStore();
  const router = useRouter();

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated) router.push('/auth/login');
  }, [isAuthenticated, _hasHydrated, router]);

  if (!_hasHydrated) return null;
  if (!isAuthenticated) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className={cn('flex flex-col flex-1 min-w-0 transition-all duration-300', sidebarOpen ? 'ml-0' : 'ml-0')}>
        <Header />
        <motion.main
          key={typeof window !== 'undefined' ? window.location.pathname : ''}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 overflow-y-auto p-4 md:p-6"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
