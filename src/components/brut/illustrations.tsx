/**
 * Geometric line art: 2px ink strokes, fills limited to #FFFFFF, #191A23, #F3F3F3, #B9FF66.
 * Elements with class "draw" are stroked on by the hero GSAP timeline; "pop" elements scale in.
 */
const INK = "#191A23";
const LIME = "#B9FF66";
const MIST = "#F3F3F3";

export function Sparkle({ x, y, s = 1, fill = INK, className = "pop twinkle" }: { x: number; y: number; s?: number; fill?: string; className?: string }) {
  return (
    <path
      className={className}
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -22 C3 -6 6 -3 22 0 C6 3 3 6 0 22 C-3 6 -6 3 -22 0 C-6 -3 -3 -6 0 -22 Z"
      fill={fill}
      stroke={INK}
      strokeWidth={2 / s}
      strokeLinejoin="round"
    />
  );
}

/** Hero: a phone receiving a "relief" SMS, a verification seal stamping it, orbit rings. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 460" className={className} role="img" aria-label="A phone receives a relief message and a seal checks whether it is real">
      <g className="orbit" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse className="draw" cx="262" cy="232" rx="230" ry="88" transform="rotate(-14 262 232)" />
        <ellipse className="draw" cx="262" cy="232" rx="196" ry="66" transform="rotate(-14 262 232)" strokeDasharray="2 9" />
      </g>
      {/* phone */}
      <g className="pop float">
        <rect x="150" y="70" width="168" height="318" rx="28" fill="#fff" stroke={INK} strokeWidth="2" />
        <rect x="164" y="98" width="140" height="262" rx="14" fill={MIST} stroke={INK} strokeWidth="2" />
        <rect x="208" y="80" width="52" height="8" rx="4" fill={INK} />
        {/* message bubble */}
        <rect x="176" y="126" width="112" height="64" rx="12" fill="#fff" stroke={INK} strokeWidth="2" />
        <path d="M188 144h76M188 158h88M188 172h52" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <rect x="176" y="204" width="86" height="40" rx="12" fill={LIME} stroke={INK} strokeWidth="2" />
        <path d="M188 220h52M188 232h34" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        {/* keypad dots */}
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={204 + c * 30} cy={280 + r * 22} r="5" fill="#fff" stroke={INK} strokeWidth="2" />),
        )}
      </g>
      {/* seal */}
      <g className="seal" style={{ transformOrigin: "382px 214px" }}>
        <circle cx="382" cy="214" r="64" fill={LIME} stroke={INK} strokeWidth="2" />
        <circle cx="382" cy="214" r="50" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 6" />
        <path className="draw" d="M356 214l18 18 34-38" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M352 284l-10 36 20-10 12 18 8-38" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M412 284l10 36-20-10-12 18-8-38" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      </g>
      {/* scam bubble being rejected */}
      <g className="pop float">
        <rect x="24" y="268" width="124" height="54" rx="14" fill={INK} stroke={INK} strokeWidth="2" />
        <path d="M44 286h58M44 302h40" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="132" cy="268" r="16" fill="#fff" stroke={INK} strokeWidth="2" />
        <path d="M125 261l14 14M139 261l-14 14" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      {/* cursor */}
      <path className="pop float" d="M452 360l10 40 8-14 16 16 8-8-16-16 14-8z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <Sparkle x={86} y={118} s={1.2} fill={INK} />
      <Sparkle x={468} y={92} s={0.9} fill={LIME} />
      <Sparkle x={104} y={404} s={0.75} fill="#fff" />
      <circle className="pop" cx="476" cy="210" r="10" fill={INK} />
      <circle className="pop" cx="54" cy="210" r="7" fill={LIME} stroke={INK} strokeWidth="2" />
    </svg>
  );
}

export function ArtSeal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={className} aria-hidden>
      <rect x="18" y="28" width="118" height="86" rx="14" fill="#fff" stroke={INK} strokeWidth="2" />
      <path d="M36 52h66M36 68h80M36 84h50" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="150" cy="96" r="40" fill={LIME} stroke={INK} strokeWidth="2" />
      <path d="M134 96l11 11 21-24" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={196} y={36} s={0.7} fill={INK} className="" />
    </svg>
  );
}

export function ArtHelper({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={className} aria-hidden>
      <rect x="70" y="18" width="80" height="128" rx="16" fill="#fff" stroke={INK} strokeWidth="2" />
      <rect x="80" y="34" width="60" height="90" rx="8" fill={MIST} stroke={INK} strokeWidth="2" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx={94 + i * 16} cy={62} r="7" fill={i === 1 ? LIME : "#fff"} stroke={INK} strokeWidth="2" />
          <path d={`M${86 + i * 16} ${80}q8-8 16 0`} fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}
      <rect x="88" y="96" width="44" height="16" rx="6" fill={INK} />
      <circle cx="34" cy="70" r="22" fill="#fff" stroke={INK} strokeWidth="2" />
      <path d="M26 68v-6a8 8 0 0116 0v6M24 68h20v14H24z" fill={LIME} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="186" cy="96" r="22" fill={INK} />
      <path d="M176 96l7 7 13-14" fill="none" stroke={LIME} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArtHandoff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={className} aria-hidden>
      <ellipse cx="110" cy="84" rx="96" ry="36" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="2 8" />
      <circle cx="70" cy="80" r="30" fill="#fff" stroke="#fff" strokeWidth="2" />
      <text x="70" y="92" textAnchor="middle" fontFamily="var(--font-mono-face), monospace" fontSize="34" fill={INK}>?</text>
      <path d="M108 80h40" stroke="#fff" strokeWidth="2" strokeLinecap="round" markerEnd="url(#hand-arrow)" />
      <defs>
        <marker id="hand-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#fff" />
        </marker>
      </defs>
      <circle cx="174" cy="80" r="26" fill={LIME} stroke="#fff" strokeWidth="2" />
      <circle cx="174" cy="72" r="8" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M160 96q14-16 28 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <Sparkle x={34} y={30} s={0.6} fill={LIME} className="" />
    </svg>
  );
}

export function ArtVoice({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={className} aria-hidden>
      <rect x="20" y="40" width="72" height="84" rx="36" fill="#fff" stroke={INK} strokeWidth="2" />
      <rect x="44" y="58" width="24" height="40" rx="12" fill={LIME} stroke={INK} strokeWidth="2" />
      <path d="M36 92a20 20 0 0040 0M56 112v12" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={110 + i * 16} y={80 - [14, 26, 38, 22, 32, 12][i]! / 2} width="8" height={[14, 26, 38, 22, 32, 12][i]} rx="4" fill={i % 2 ? INK : LIME} stroke={INK} strokeWidth="2" />
      ))}
      <rect x="114" y="112" width="86" height="28" rx="10" fill={MIST} stroke={INK} strokeWidth="2" />
      <text x="157" y="131" textAnchor="middle" fontFamily="var(--font-mono-face), monospace" fontSize="14" fill={INK}>1 2 3 · 9</text>
    </svg>
  );
}

export function ArtCta({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 260" className={className} aria-hidden>
      <ellipse cx="180" cy="140" rx="150" ry="52" fill="none" stroke={INK} strokeWidth="2" transform="rotate(-10 180 140)" />
      <ellipse cx="180" cy="140" rx="118" ry="36" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="2 8" transform="rotate(-10 180 140)" />
      <circle cx="180" cy="124" r="58" fill={INK} />
      <circle cx="160" cy="114" r="8" fill="#fff" />
      <circle cx="200" cy="114" r="8" fill="#fff" />
      <path d="M156 140q24 22 48 0" fill="none" stroke={LIME} strokeWidth="4" strokeLinecap="round" />
      <Sparkle x={92} y={196} s={1.6} fill={LIME} className="" />
      <Sparkle x={290} y={70} s={1.1} fill={MIST} className="" />
      <Sparkle x={266} y={210} s={0.8} fill={INK} className="" />
    </svg>
  );
}
