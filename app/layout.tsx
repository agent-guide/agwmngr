import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-context";
import { I18nProvider } from "@/components/i18n-provider";
import { LOCALE_COOKIE, resolveLocale, translate } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    title: { default: "AGW Manager", template: "%s | AGW Manager" },
    description: translate(locale, "app.description"),
  };
}

// Applied before first paint to avoid a flash of the wrong theme (FOUC).
const themeInitScript = `(function(){try{var t=localStorage.getItem('dashboard.theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
