'use client';

import {createContext, type ReactNode, useCallback, useContext, useMemo, useState} from 'react';

type CtaContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const CtaContext = createContext<CtaContextValue | null>(null);

export function CtaProvider({children}: {children: ReactNode}) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({isOpen, open, close}), [isOpen, open, close]);
  return <CtaContext.Provider value={value}>{children}</CtaContext.Provider>;
}

export function useCta() {
  const ctx = useContext(CtaContext);
  if (!ctx) throw new Error('useCta must be used within <CtaProvider>');
  return ctx;
}
