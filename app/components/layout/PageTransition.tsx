'use client'

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target =
        document.getElementById('page-main-heading') ??
        document.getElementById('main-content');
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const offset = shouldReduceMotion ? 0 : 4;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{
          opacity: 0,
          y: offset,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        exit={{
          opacity: 0,
          y: -offset,
        }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.15,
          ease: [0.23, 1, 0.32, 1],
        }}
        style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
