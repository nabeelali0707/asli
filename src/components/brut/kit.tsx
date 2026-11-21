"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence, type HTMLMotionProps } from "motion/react";
import { ArrowUpRight, Volume2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { speak } from "@/lib/api";

// ───────── Buttons ─────────

type BtnVariant = "primary" | "secondary" | "lime" | "inverse";
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-[14px] text-base font-medium leading-[1.2] transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] disabled:pointer-events-none disabled:opacity-50 select-none";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-ink text-white border border-ink px-8 py-4 hover:bg-lime hover:text-black",
  secondary: "bg-transparent text-black border border-ink px-7 py-[14px] hover:bg-ink hover:text-white",
  lime: "bg-lime text-black border border-ink px-8 py-4 shadow-hard hover:-translate-y-0.5 hover:shadow-hard-lg",
  inverse: "bg-white text-black border border-white px-7 py-[14px] hover:bg-lime hover:border-lime on-dark",
};

type BtnProps = Omit<HTMLMotionProps<"button">, "children"> & { variant?: BtnVariant; size?: "md" | "sm"; loading?: boolean; children: React.ReactNode };

export function Btn({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.15 }}
      className={cn(btnBase, btnVariants[variant], size === "sm" && "px-4 py-2.5 text-[15px]", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </motion.button>
  );
}

export function BtnLink({ href, variant = "primary", className, children }: { href: string; variant?: BtnVariant; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(btnBase, btnVariants[variant], className)}>
      {children}
    </Link>
  );
}

// ───────── "Learn more" arrow link ─────────

export function ArrowLink({ href, onClick, children, tone = "light", className }: { href?: string; onClick?: () => void; children: React.ReactNode; tone?: "light" | "dark"; className?: string }) {
  const inner = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:rotate-45",
          tone === "light" ? "bg-ink text-lime" : "bg-white text-ink",
        )}
        aria-hidden
      >
        <ArrowUpRight className="size-5" strokeWidth={2.25} />
      </span>
      <span className={cn("text-base", tone === "dark" ? "text-white" : "text-black")}>{children}</span>
    </>
  );
  const cls = cn("group inline-flex items-center gap-3.5 rounded-full", tone === "dark" && "on-dark", className);
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

// ───────── Section header (lime title badge + supporting copy) ─────────

export function SectionHeader({ title, children, id, as = "h2" }: { title: string; children?: React.ReactNode; id?: string; as?: "h1" | "h2" }) {
  const H = as;
  return (
    <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:gap-8">
      <H id={id} className="text-h2 shrink-0">
        <span className="marker">{title}</span>
      </H>
      {children && <p className="max-w-[520px] text-[1.05rem] leading-[1.5] text-muted-ink">{children}</p>}
    </div>
  );
}

// ───────── Cards ─────────

export type CardTone = "light" | "mist" | "dark" | "lime";
const cardTones: Record<CardTone, string> = {
  light: "bg-white text-black",
  mist: "bg-mist text-black",
  dark: "bg-ink text-white on-dark",
  lime: "bg-lime text-black",
};

export function Card({ tone = "light", className, children, reveal = true, lift = false, ...rest }: HTMLMotionProps<"div"> & { tone?: CardTone; reveal?: boolean; lift?: boolean }) {
  return (
    <motion.div
      initial={reveal ? { opacity: 0, y: 24 } : false}
      whileInView={reveal ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.5 }}
      whileHover={lift ? { y: -4 } : undefined}
      className={cn("brut-card p-7 sm:p-12", cardTones[tone], lift && "transition-shadow duration-200 hover:shadow-hard-lg", className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Title badge on a card: lime on light cards, white on dark and lime cards. */
export function CardTitle({ children, tone = "light", as: As = "h3", className }: { children: React.ReactNode; tone?: CardTone; as?: "h2" | "h3" | "h4"; className?: string }) {
  return (
    <As className={cn("text-h3", className)}>
      <span className={tone === "light" || tone === "mist" ? "marker" : "marker-white"}>{children}</span>
    </As>
  );
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-[28px] border border-ink bg-white p-6 shadow-hard", className)}>{children}</div>;
}

// ───────── Small pieces ─────────

export function Tag({ children, tone = "mist", className }: { children: React.ReactNode; tone?: "mist" | "lime" | "dark" | "white"; className?: string }) {
  const tones = { mist: "bg-mist text-ink", lime: "bg-lime text-black", dark: "bg-ink text-white", white: "bg-white text-ink" };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-[7px] border border-ink px-2 py-0.5 font-mono text-[12px] uppercase tracking-wide", tones[tone], className)}>{children}</span>;
}

export const LANE_INFO: Record<string, { label: string; tone: "lime" | "white" | "mist" | "dark"; hint: string }> = {
  auto: { label: "Provisionally approved", tone: "lime", hint: "Money reserved, not sent. Cooling-off, then a person releases it." },
  fast: { label: "Pre-verified", tone: "white", hint: "Everything checks out. An officer approves with one tap." },
  ask_proof: { label: "Needs one more thing", tone: "mist", hint: "A gap the person can close — a photo, a document, a detail." },
  human: { label: "I am not sure", tone: "dark", hint: "Stopped and handed to a person with notes." },
};

export function LaneChip({ lane, className }: { lane?: string | null; className?: string }) {
  if (!lane) return <Tag className={className}>No decision</Tag>;
  const l = LANE_INFO[lane] ?? { label: lane, tone: "mist" as const };
  return (
    <Tag tone={l.tone} className={className}>
      {l.label}
    </Tag>
  );
}

export function UrduText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p lang="ur" dir="rtl" className={cn("urdu", className)}>
      {children}
    </p>
  );
}

/** Reads a bilingual message aloud — the primary way a non-reader gets information. */
export function SpeakButton({ text, label = "Listen", tone = "light", className }: { text: { en: string; ur: string }; label?: string; tone?: "light" | "dark"; className?: string }) {
  const [on, setOn] = React.useState(false);
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        const ok = speak(text, "ur");
        setOn(ok);
        if (ok) setTimeout(() => setOn(false), 2500);
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-medium transition-colors",
        tone === "light" ? "border-ink bg-lime text-black hover:bg-ink hover:text-white" : "border-white bg-white text-ink hover:bg-lime on-dark",
        className,
      )}
      aria-label={`${label}: read this message aloud`}
    >
      <Volume2 className={cn("size-[18px]", on && "animate-pulse")} aria-hidden />
      {label}
    </motion.button>
  );
}

/** Signed verify links are hundreds of characters long — show a short label instead (the spoken text keeps the full message). */
const shortenLinks = (s: string) => s.replace(/https?:\/\/\S+/g, "[verify link]");

export function Bilingual({ text, className, tone = "light", speakable = true }: { text: { en: string; ur: string }; className?: string; tone?: "light" | "dark"; speakable?: boolean }) {
  return (
    <div className={cn("min-w-0 space-y-3 [overflow-wrap:anywhere]", className)}>
      <UrduText className="text-[1.15rem]">{shortenLinks(text.ur)}</UrduText>
      <p className={cn("text-base", tone === "dark" ? "text-white/85" : "text-muted-ink")}>{shortenLinks(text.en)}</p>
      {speakable && <SpeakButton text={{ en: shortenLinks(text.en), ur: shortenLinks(text.ur) }} tone={tone} />}
    </div>
  );
}

export function Stat({ value, label, tone = "light" }: { value: React.ReactNode; label: string; tone?: "light" | "dark" }) {
  return (
    <div>
      <div className={cn("font-mono text-[2rem] leading-none tracking-tight", tone === "dark" ? "text-lime" : "text-black")}>{value}</div>
      <div className={cn("mt-2 text-[15px]", tone === "dark" ? "text-white/80" : "text-muted-ink")}>{label}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[28px] border border-dashed border-ink bg-mist p-8 text-center">
      <p className="text-lg font-medium">{title}</p>
      {children && <div className="mt-2 text-muted-ink">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-8 text-muted-ink">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

// ───────── The verdict stamp (signature element) ─────────

export const VERDICT: Record<string, { word: string; ur: string; tone: "lime" | "dark" | "white" | "mist"; rotate: number }> = {
  genuine: { word: "Genuine", ur: "اصلی", tone: "lime", rotate: -6 },
  tampered: { word: "Tampered", ur: "ردوبدل", tone: "dark", rotate: 5 },
  scam: { word: "Fake", ur: "جعلی", tone: "dark", rotate: -4 },
  code_mismatch: { word: "Copied code", ur: "نقلی کوڈ", tone: "dark", rotate: 4 },
  not_linked: { word: "Not your case", ur: "آپ کا نہیں", tone: "dark", rotate: -5 },
  expired: { word: "Expired", ur: "پرانا", tone: "mist", rotate: 3 },
  suspicious: { word: "Not sure", ur: "یقین نہیں", tone: "white", rotate: -3 },
  unrelated: { word: "Not relief", ur: "غیر متعلق", tone: "white", rotate: 2 },
};

export function Stamp({ verdict, size = "lg" }: { verdict: string; size?: "lg" | "md" }) {
  const v = VERDICT[verdict] ?? VERDICT.suspicious!;
  const tones = { lime: "bg-lime text-black", dark: "bg-ink text-white", white: "bg-white text-black", mist: "bg-mist text-black" };
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={verdict}
        initial={{ scale: 2.4, opacity: 0, rotate: v.rotate * 3 }}
        animate={{ scale: 1, opacity: 1, rotate: v.rotate }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 22, mass: 0.9 }}
        className={cn(
          "inline-flex select-none flex-col items-center rounded-[18px] border-2 border-ink shadow-hard",
          tones[v.tone],
          size === "lg" ? "px-7 py-3" : "px-4 py-2",
        )}
        role="status"
        aria-live="polite"
      >
        <span className={cn("font-mono font-bold uppercase tracking-[0.12em]", size === "lg" ? "text-[1.7rem]" : "text-lg")}>{v.word}</span>
        <span lang="ur" className={cn("urdu leading-[1.6]", size === "lg" ? "text-xl" : "text-base")}>
          {v.ur}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}
