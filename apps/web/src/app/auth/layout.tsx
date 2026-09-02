import { Logo } from '@/components/shared/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <Logo size={44} showWordmark className="mb-1" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Engineered for Scale</p>
        </div>
        {children}
      </div>
    </div>
  );
}
