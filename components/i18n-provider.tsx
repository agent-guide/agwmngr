"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  localeCookie,
  translate,
  type Locale,
  type MessageKey,
  type MessageValues,
} from "@/lib/i18n";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    document.cookie = localeCookie(next);
    document.documentElement.lang = next;
    setLocaleState(next);
    router.refresh();
  }, [router]);
  const t = useCallback(
    (key: MessageKey, values?: MessageValues) => translate(locale, key, values),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
