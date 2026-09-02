import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Ventrix - Engineered for Scale', template: '%s | Ventrix' },
  description: 'Modular operational management ERP for mid-to-large businesses across any industry.',
  keywords: ['ERP', 'operations management', 'inventory', 'accounting', 'enterprise', 'multi-industry'],
  icons: { icon: '/ventrixDark.png', apple: '/ventrixDark.png' },
  openGraph: {
    title: 'Ventrix - Engineered for Scale',
    description: 'Modular operational management ERP for mid-to-large businesses across any industry.',
    images: ['/ventrixDark.png'],
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster position="top-right" toastOptions={{ duration: 4000, style: { borderRadius: '8px', background: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))', border: '1px solid hsl(var(--border))' } }} />
        </Providers>
      </body>
    </html>
  );
}
