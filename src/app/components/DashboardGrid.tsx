'use client'

import Link from 'next/link';
import { motion, Variants, useReducedMotion } from 'framer-motion';
import { useCursorGlowHandlers } from '../../lib/utils/useCursorGlow';

interface ToolItem {
  num: string;
  name: string;
  desc: string;
  path: string;
}

export function DashboardGrid({ tools }: { tools: ToolItem[] }) {
  const shouldReduceMotion = useReducedMotion();
  const glowHandlers = useCursorGlowHandlers<HTMLAnchorElement>();

  const container: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.05
      }
    }
  };

  const itemVariant: Variants = {
    hidden: { opacity: 0, transform: shouldReduceMotion ? 'translateY(0px)' : 'translateY(12px)' },
    show: { opacity: 1, transform: 'translateY(0px)', transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }
  };

  return (
    <motion.div 
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 w-full p-6"
      variants={container}
      initial={shouldReduceMotion ? false : "hidden"}
      animate="show"
    >
      {tools.map((t, idx) => (
        <motion.div
          key={t.path}
          className={idx < 2 ? 'lg:col-span-6' : 'lg:col-span-6 xl:col-span-3'}
          variants={itemVariant}
          whileHover={shouldReduceMotion ? undefined : { y: -3 }}
          whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
        >
          <Link 
            href={t.path} 
            {...glowHandlers}
            className="cel-glow-host glass-panel master-glass-card group flex flex-col justify-between p-6 h-48 hover:border-[var(--accent)] focus-visible:border-[var(--accent)] transition-[border-color,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] relative overflow-hidden cursor-pointer block" 
            style={{ textDecoration: 'none' }}
          >
            {/* Specular Top Edge Highlight */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '1px',
                background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.18) 50%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
            {/* Cursor-Following Radial Hover Glow */}
            <div aria-hidden="true" className="cel-glow-layer" />
            <div className="absolute top-0 left-0 w-1 h-full bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] z-[2]" />
            <div className="relative z-[3]">
              <span className="nav-index transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:text-[var(--accent)]">{t.num}{' //'}</span>
              <h2 className="nav-name mt-2" style={{ color: 'var(--text-main)', fontSize: '1rem' }}>{t.name}</h2>
              <p className="mt-2" style={{ color: 'var(--text-muted)', lineHeight: '1.4', fontSize: '13px' }}>{t.desc}</p>
            </div>
            <div className="flex justify-end relative z-[3]">
              <span className="tiny-label group-hover:text-[var(--accent)] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]">INITIALIZE &rarr;</span>
            </div>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
