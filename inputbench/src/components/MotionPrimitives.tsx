import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
} from 'motion/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function ScrollProgressHairline({
  lowDetailMode,
}: {
  lowDetailMode: boolean;
}) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 360,
    damping: 36,
    restDelta: 0.001,
  });

  if (lowDetailMode) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] origin-left accent-bg opacity-85"
    />
  );
}

export function MouseAuraOverlay({
  lowDetailMode,
}: {
  lowDetailMode: boolean;
}) {
  const mouseX = useMotionValue(-1000);
  const mouseY = useMotionValue(-1000);
  const smoothX = useSpring(mouseX, { stiffness: 220, damping: 28, mass: 0.4 });
  const smoothY = useSpring(mouseY, { stiffness: 220, damping: 28, mass: 0.4 });
  const [hasMoved, setHasMoved] = useState(false);

  const background = useMotionTemplate`radial-gradient(520px circle at ${smoothX}px ${smoothY}px, var(--accent-glow), transparent 72%)`;

  useEffect(() => {
    if (lowDetailMode || typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
      setHasMoved(true);
    };

    const handleLeave = () => {
      setHasMoved(false);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    document.addEventListener('mouseleave', handleLeave);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      document.removeEventListener('mouseleave', handleLeave);
    };
  }, [lowDetailMode, mouseX, mouseY]);

  if (lowDetailMode || !hasMoved) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.9 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}

interface ClickPulse {
  id: number;
  x: number;
  y: number;
}

export function ClickPulseLayer({
  lowDetailMode,
}: {
  lowDetailMode: boolean;
}) {
  const [pulses, setPulses] = useState<ClickPulse[]>([]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    if (lowDetailMode || typeof window === 'undefined') return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-no-global-pulse="true"]')) return;

      const id = nextIdRef.current++;
      setPulses((prev) => [...prev.slice(-4), { id, x: e.clientX, y: e.clientY }]);

      window.setTimeout(() => {
        setPulses((prev) => prev.filter((p) => p.id !== id));
      }, 380);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [lowDetailMode]);

  if (lowDetailMode || pulses.length === 0) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pulses.map((p) => (
        <span
          key={p.id}
          style={{ left: p.x, top: p.y }}
          className="fixed -translate-x-1/2 -translate-y-1/2"
        >
          <motion.span
            initial={{ scale: 0.25, opacity: 0.65 }}
            animate={{ scale: 1.45, opacity: 0 }}
            transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
            style={{ borderColor: 'var(--accent-primary)' }}
            className="block w-10 h-10 rounded-full border-[1.5px]"
          />
        </span>
      ))}
    </div>
  );
}

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
  lowDetailMode: boolean;
  delay?: number;
  scrollReveal?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

export function SpotlightCard({
  children,
  className = '',
  lowDetailMode,
  delay = 0,
  scrollReveal = false,
  interactive = false,
  onClick,
  ariaLabel,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (lowDetailMode || e.pointerType !== 'mouse' || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      cardRef.current.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      cardRef.current.style.setProperty('--my', `${e.clientY - rect.top}px`);
    },
    [lowDetailMode]
  );

  const motionProps = lowDetailMode
    ? {}
    : scrollReveal
    ? {
        initial: { opacity: 0, y: 16 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.08 },
        transition: { duration: 0.28, delay, ease: EASE_OUT_EXPO },
      }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.24, delay, ease: EASE_OUT_EXPO },
      };

  const hoverTapProps =
    !lowDetailMode && (interactive || onClick)
      ? {
          whileHover: { y: -2 },
          whileTap: { scale: 0.99 },
        }
      : {};

  return (
    <motion.div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      {...motionProps}
      {...hoverTapProps}
      className={`group relative overflow-hidden ${
        !lowDetailMode ? 'spotlight-surface' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function ScrollRevealSection({
  children,
  className = '',
  lowDetailMode,
  delay = 0,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  lowDetailMode: boolean;
  delay?: number;
  ariaLabel?: string;
}) {
  if (lowDetailMode) {
    return (
      <section aria-label={ariaLabel} className={className}>
        {children}
      </section>
    );
  }

  return (
    <motion.section
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.3, delay, ease: EASE_OUT_EXPO }}
      className={className}
    >
      {children}
    </motion.section>
  );
}
