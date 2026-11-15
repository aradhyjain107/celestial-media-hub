import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import localFont from 'next/font/local';
import './globals.css';
import { Sidebar } from './components/layout/Sidebar';
import { PageTransition } from './components/layout/PageTransition';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { GlobalJobProvider } from './context/GlobalJobContext';
import { ServerGuard } from './components/ui/ServerGuard';
import { TooltipProvider } from './components/ui/Tooltip';
import { CursorGlowController } from './components/ui/CursorGlowController';
import { PRODUCT_KEYWORDS, getSiteIdentity, getSiteUrl } from '@/lib/agent/siteContent';

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

const siteUrl = getSiteUrl();
const identity = getSiteIdentity(siteUrl);

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: '%s // CELESTIAL',
    default: identity.headline,
  },
  description: identity.description,
  keywords: [...PRODUCT_KEYWORDS],
  authors: [{ name: identity.creatorName, url: identity.repoUrl }],
  creator: identity.creatorName,
  publisher: identity.name,
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: identity.name,
    title: identity.headline,
    description: identity.description,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: identity.headline,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: identity.headline,
    description: identity.description,
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
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

