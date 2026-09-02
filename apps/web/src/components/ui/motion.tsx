'use client';

import { motion, AnimatePresence } from 'framer-motion';

// Smooth fade + slide-up for page sections / cards
export const FadeIn = ({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, delay, ease: [0.16, 1, 0.3, 1] }}
    className={className}
  >
    {children}
  </motion.div>
);

// Tab panel with exit + enter animation keyed by active tab
export const TabPanel = ({
  children,
  tabKey,
  className = '',
}: {
  children: React.ReactNode;
  tabKey: string;
  className?: string;
}) => (
  <AnimatePresence mode="wait">
    <motion.div
      key={tabKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  </AnimatePresence>
);

// Slide in from right — for drawers / side panels
export const SlideInPanel = ({
  children,
  show,
  className = '',
}: {
  children: React.ReactNode;
  show: boolean;
  className?: string;
}) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ opacity: 0, x: 32, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 32, scale: 0.98 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);

// Animated list — wraps the table body or list container
export const AnimatedList = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <motion.tbody
    initial="hidden"
    animate="visible"
    variants={{ visible: { transition: { staggerChildren: 0.04 } }, hidden: {} }}
    className={className}
  >
    {children}
  </motion.tbody>
);

// Individual animated row
export const AnimatedRow = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <motion.tr
    variants={{
      hidden: { opacity: 0, y: -6 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
    }}
    className={className}
  >
    {children}
  </motion.tr>
);

// Scale-in for modals / popovers
export const ScaleIn = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.96 }}
    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    className={className}
  >
    {children}
  </motion.div>
);

export { motion, AnimatePresence };
