'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { motion } from '@/components/ui/motion';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated) router.push('/auth/login');
  }, [isAuthenticated, _hasHydrated, router]);

  if (!_hasHydrated) return null;
  if (!isAuthenticated) return null;

  return (
    // overflow-clip (not just hidden): a hidden box can still be scrolled by focus() or scrollIntoView,
    // which shifts the whole shell and pushes the header off screen. Only <main> should scroll.
    <div className="flex h-screen overflow-hidden overflow-clip bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden overflow-clip transition-all duration-300">
        <Header />
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 overflow-y-auto p-4 md:p-6"
        >
          {/* Pages read ?new=… via useSearchParams, which needs a Suspense boundary. */}
          <Suspense fallback={null}>{children}</Suspense>
        </motion.main>
      </div>
      <CommandPalette />
    </div>
  );
}
