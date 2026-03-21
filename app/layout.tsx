import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from './components/layout/Sidebar';
import { ErrorBoundary } from './components/lib/ErrorBoundary';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const jbMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

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
        <div id="app-container">
          <Sidebar />
          <ErrorBoundary>
            <main className="content-area">
              {children}
            </main>
          </ErrorBoundary>
        </div>
      </body>
    </html>
  );
}
