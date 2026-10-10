import { useId } from "react";

// Logos use theme CSS vars so they adapt to every theme.
//  - Gloss  (classic reader): light illuminating a page (annotation + illumination).
//  - GlossX (agent workbench, `x`): the same page with an X — two crossing strokes
//    that read as a four-point spark — in place of the light.
export function Logo({ size = 22, x = false }: { size?: number; x?: boolean }) {
  const id = useId();
  if (x) {
    const grad = `${id}-g`, cut = `${id}-m`;
    return (
      <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={grad} x1="52" y1="10" x2="88" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent2)" stopOpacity="0.72" />
            <stop offset="0.55" stopColor="var(--accent2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          {/* the page gives way around the X so the two never touch */}
          <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">
            <rect width="96" height="96" fill="#fff" />
            <circle cx="70" cy="28" r="21" fill="#000" />
          </mask>
        </defs>
        <g mask={`url(#${cut})`}>
          <rect x="14" y="22" width="50" height="62" rx="9"
            fill="var(--accent2)" fillOpacity="0.16" stroke="var(--accent)" strokeWidth={size < 28 ? 5 : 3.5} />
          <g stroke="var(--accent)" strokeWidth={size < 28 ? 4.5 : 3.5} strokeLinecap="round">
            <line x1="26" y1="44" x2="52" y2="44" />
            <line x1="26" y1="56" x2="52" y2="56" />
            <line x1="26" y1="68" x2="42" y2="68" />
          </g>
        </g>
        <g stroke={`url(#${grad})`} strokeWidth={size < 28 ? 9.5 : 8} strokeLinecap="round">
          <line x1="57" y1="15" x2="83" y2="41" />
          <line x1="83" y1="15" x2="57" y2="41" />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* page */}
      <rect x="4.5" y="6" width="11.5" height="15" rx="1.6"
        fill="var(--accent2)" fillOpacity="0.14" stroke="var(--accent)" strokeWidth="1.4" />
      <g stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round">
        <line x1="7.3" y1="11" x2="13.2" y2="11" />
        <line x1="7.3" y1="14" x2="13.2" y2="14" />
        <line x1="7.3" y1="17" x2="11" y2="17" />
      </g>
      {/* light illuminating the page */}
      <circle cx="17.4" cy="6.4" r="2.5" fill="var(--accent2)" />
      <g stroke="var(--accent2)" strokeWidth="1.3" strokeLinecap="round">
        <line x1="17.4" y1="1.6" x2="17.4" y2="3" />
        <line x1="21.4" y1="2.5" x2="20.4" y2="3.5" />
        <line x1="22.4" y1="6.4" x2="21" y2="6.4" />
        <line x1="21.2" y1="10.2" x2="20.2" y2="9.3" />
        <line x1="13.6" y1="2.6" x2="14.5" y2="3.5" />
      </g>
    </svg>
  );
}
