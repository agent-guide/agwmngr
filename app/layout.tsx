import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-context";

export const metadata: Metadata = {
  title: {
    default: "AGW Manager",
    template: "%s | AGW Manager",
  },
  description: "Management dashboard for the agent gateway",
};

// Applied before first paint to avoid a flash of the wrong theme (FOUC).
const themeInitScript = `(function(){try{var t=localStorage.getItem('dashboard.theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
