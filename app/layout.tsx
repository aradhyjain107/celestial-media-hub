import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import localFont from 'next/font/local';
import './globals.css';
import { Sidebar } from './components/layout/Sidebar';
import { PageTransition } from './components/layout/PageTransition';
import { ErrorBoundary } from './components/lib/ErrorBoundary';
import { GlobalJobProvider } from './context/GlobalJobContext';
import { ServerGuard } from './components/ui/ServerGuard';
import { TooltipProvider } from './components/ui/Tooltip';
import { CursorGlowController } from './components/ui/CursorGlowController';

const inter = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-sans',
  display: 'swap',
});

const jbMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: {
    template: '%s // CELESTIAL',
    default: 'CELESTIAL // Media Hub',
  },
  description: 'Local-first media processing toolkit',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable}`}>
      <body>
        <Script src="/bootstrap-guard.js" strategy="beforeInteractive" />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <GlobalJobProvider>
          <TooltipProvider delayMs={500} skipDelayMs={80}>
            <div id="app-container">
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>
              <ErrorBoundary>
                <main id="main-content" className="content-area" tabIndex={-1}>
                  <PageTransition>
                    {children}
                  </PageTransition>
                </main>
              </ErrorBoundary>
            </div>
          </TooltipProvider>
        </GlobalJobProvider>
        <ServerGuard />
        <CursorGlowController />
      </body>
    </html>
  );
}

