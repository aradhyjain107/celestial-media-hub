'use client'

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { SidebarSupportTrigger } from '../ui/SupportDonate';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/tools/muter', label: 'Video Muter' },
  { path: '/tools/hevc', label: 'Universal Compressor' },
  { path: '/tools/converter', label: 'Universal Converter' },
  { path: '/tools/youtube', label: 'YouTube Downloader' },
  { path: '/tools/trimmer', label: 'Audio Trimmer' },
  { path: '/tools/spotify', label: 'Spotify Converter' },
];


export function Sidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileOpenRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mq = window.matchMedia('(max-width: 768px)');
    const syncViewport = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) {
        setMobileOpen(false);
      }
    };
    syncViewport();

    mq.addEventListener('change', syncViewport);
    return () => mq.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    const isModalOpen = isMobile && mobileOpen;
    const mainEl = typeof document !== 'undefined' ? document.getElementById('main-content') : null;

    if (isModalOpen) {
      mainEl?.setAttribute('inert', '');
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMobileOpen(false);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      const focusFrame = window.requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
      wasMobileOpenRef.current = true;
      return () => {
        window.cancelAnimationFrame(focusFrame);
        document.removeEventListener('keydown', handleKeyDown);
        mainEl?.removeAttribute('inert');
      };
    }

    mainEl?.removeAttribute('inert');
    if (wasMobileOpenRef.current) {
      wasMobileOpenRef.current = false;
      toggleButtonRef.current?.focus();
    }
  }, [isMobile, mobileOpen]);

  const isDrawerDialog = isMobile && mobileOpen;

  return (
    <>
      <button
        ref={toggleButtonRef}
        type="button"
        className="mobile-sidebar-toggle"
        onClick={() => setMobileOpen(prev => !prev)}
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
        aria-controls="primary-sidebar"
      >
        <span className="tiny-label" style={{ color: 'var(--accent)', fontWeight: 800 }}>SYS.CORE //</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {mobileOpen ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="primary-sidebar"
        className={`sidebar grid-line-right ${mobileOpen ? 'mobile-open' : ''}`}
        role={isDrawerDialog ? 'dialog' : undefined}
        aria-modal={isDrawerDialog ? 'true' : undefined}
        aria-label={isDrawerDialog ? 'Navigation menu' : 'Sidebar'}
      >
        <div className="sidebar-header grid-line-bottom" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="sidebar-brand">SYS.CORE//</span>
          {mobileOpen && (
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              className="tiny-label"
              aria-label="Close navigation menu"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontWeight: 700,
                minWidth: '44px',
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              [ CLOSE ]
            </button>
          )}
        </div>

        <nav aria-label="Primary" className="nav-list" data-lenis-prevent>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
            {NAV_ITEMS.map((item, i) => {
              const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
              const num = String(i + 1).padStart(2, '0');

              return (
                <li key={item.path} style={{ width: '100%' }}>
                  <Link
                    href={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                    onClick={() => setMobileOpen(false)}
                  >
                    <motion.div
                      className={`nav-item ${isActive ? 'active' : ''} grid-line-bottom`}
                      style={{ position: 'relative' }}
                      whileHover={shouldReduceMotion ? undefined : { x: 4 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    >
                      {mounted && isActive && (
                        <motion.div
                          layoutId="activeIndicator"
                          className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--accent)]"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: '4px',
                            background: 'var(--accent)',
                            zIndex: 10,
                          }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={shouldReduceMotion ? { duration: 0 } : {
                            type: 'spring',
                            duration: 0.35,
                            bounce: 0.15,
                          }}
                        />
                      )}
                      <div className="nav-index">{num}</div>
                      <div className="nav-name">{item.label}</div>
                    </motion.div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <SidebarSupportTrigger />

        <div className="sidebar-footer grid-line-top">
          <span className="tiny-label">SYS.STATUS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="mono-data">ONLINE</span>
            <span className="status-dot" aria-hidden="true" />
          </div>
        </div>
      </aside>
    </>
  );
}

