// GlossX logo — light illuminating a page (annotation + illumination).
// Uses theme CSS vars so it adapts to every theme.
export function Logo({ size = 22 }: { size?: number }) {
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
