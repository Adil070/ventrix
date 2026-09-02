import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  /** Pixel size of the logo mark (width & height). */
  size?: number;
  /** Show the "Ventrix" wordmark next to the mark. */
  showWordmark?: boolean;
  /** Optional tagline shown under the wordmark. */
  showTagline?: boolean;
  className?: string;
}

/**
 * Ventrix brand logo. Renders the logo mark and, optionally, the wordmark.
 */
export function Logo({ size = 36, showWordmark = false, showTagline = false, className }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className="relative flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-orange-500/20 shadow-sm"
        style={{ width: size, height: size }}
      >
        <Image
          src="/ventrixDark.png"
          alt="Ventrix"
          fill
          sizes={`${size}px`}
          className="object-cover"
          priority
        />
      </div>
      {showWordmark && (
        <div className="min-w-0">
          <span className="block truncate text-lg font-bold leading-tight text-gray-900 dark:text-white">
            Ventrix
          </span>
          {showTagline && (
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              Engineered for Scale
            </span>
          )}
        </div>
      )}
    </div>
  );
}
