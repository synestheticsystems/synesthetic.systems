import { useEffect, useRef } from 'react';

type Props = { text: string; className?: string };

// Renders the wordmark one letter per inline-block span and warps each letter
// away from the pointer (push + scale + slight rotation) with a smooth falloff,
// so the name distorts as the cursor gets close. All transforms are GPU-
// composited; the text stays accessible via aria-label.
export default function DistortTitle({ text, className }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>('[data-letter]'));
    if (spans.length === 0) return;

    const centers = spans.map(() => ({ x: 0, y: 0 }));
    const state = spans.map(() => ({ env: 0, sk: 0, px: 0, py: 0 }));

    const measure = () => {
      for (let i = 0; i < spans.length; i++) {
        const r = spans[i].getBoundingClientRect();
        centers[i].x = r.left + r.width / 2;
        centers[i].y = r.top + r.height / 2;
      }
    };
    measure();
    // letter widths shift once the web font swaps in — re-measure then
    document.fonts?.ready.then(measure).catch(() => {});

    let mx = -1e6;
    let my = -1e6;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });

    const RADIUS = 185; // px around a letter where the cursor starts warping it
    let raf = 0;
    const frame = (now: number) => {
      const time = now * 0.001;
      for (let i = 0; i < spans.length; i++) {
        const c = centers[i];
        const dx = c.x - mx;
        const dy = c.y - my;
        const dist = Math.hypot(dx, dy) || 1;
        const fall = Math.max(0, 1 - dist / RADIUS);
        const e = fall * fall; // ease-in falloff
        const ux = dx / dist;
        const uy = dy / dist;
        const st = state[i];
        // smoothed envelope, a melty shear, and a faint pull toward the cursor
        st.env += (e - st.env) * 0.16;
        st.sk += (ux * e * 14 - st.sk) * 0.16;
        st.px += (-ux * e * 4 - st.px) * 0.16;
        st.py += (-uy * e * 4 - st.py) * 0.16;
        // live, organic quiver (incommensurate sines, per-letter phase) so the
        // letters tremble rather than bounce — uneasy, not playful
        const ph = i * 1.7;
        const wx = (Math.sin(time * 3.4 + ph) + 0.6 * Math.sin(time * 5.3 + ph * 1.7)) * 0.9 * st.env;
        const wy = (Math.cos(time * 4.1 + ph * 1.3) + 0.6 * Math.sin(time * 6.2 + ph * 0.7)) * 0.9 * st.env;
        // non-uniform stretch (taller + narrower) reads as distortion, not a pop
        const sx = 1 - st.env * 0.13;
        const sy = 1 + st.env * 0.32;
        spans[i].style.transform =
          `translate(${(st.px + wx).toFixed(2)}px,${(st.py + wy).toFixed(2)}px) skewX(${st.sk.toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [text]);

  return (
    <h1 className={className} ref={ref} aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span
          data-letter
          aria-hidden="true"
          key={i}
          style={{ display: 'inline-block', whiteSpace: 'pre', willChange: 'transform' }}
        >
          {ch}
        </span>
      ))}
    </h1>
  );
}
