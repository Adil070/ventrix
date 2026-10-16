'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Quick actions link to pages like /customers?new=1. This opens the page's form once
// and then strips the param, so the same link works again from the "+ New" menu.
export function useOpenFromUrl(onOpen: (value: string) => void, param = 'new') {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(param);

  useEffect(() => {
    if (!value) return;
    onOpen(value);
    const rest = new URLSearchParams(params.toString());
    rest.delete(param);
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
