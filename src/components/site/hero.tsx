"use client";

import * as React from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { HeroArt } from "@/components/brut/illustrations";
import { BtnLink } from "@/components/brut/kit";

gsap.registerPlugin(useGSAP, DrawSVGPlugin);

export function Hero() {
  const scope = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from(".hero-line", { y: 28, opacity: 0, duration: 0.7, stagger: 0.08 })
          .from(".hero-cta", { y: 16, opacity: 0, duration: 0.5, stagger: 0.06 }, "-=0.35")
          .from(".hero-art .draw", { drawSVG: "0%", duration: 1.1, ease: "power2.inOut", stagger: 0.12 }, 0.15)
          .from(".hero-art .pop", { scale: 0, transformOrigin: "50% 50%", duration: 0.5, ease: "back.out(2.2)", stagger: 0.06 }, 0.35)
          .from(".hero-art .seal", { y: -90, rotate: -22, scale: 1.25, opacity: 0, duration: 0.55, ease: "power4.in" }, 1.05)
          .to(".hero-art .seal", { scale: 0.96, duration: 0.08, yoyo: true, repeat: 1, ease: "power1.out" });
      });
    },
    { scope },
  );

  return (
    <section ref={scope} className="container-page grid items-center gap-10 pb-16 pt-4 lg:grid-cols-[55fr_45fr] lg:gap-6 lg:pb-24">
      <div>
        <h1 className="text-h1 max-w-[16ch]">
          <span className="hero-line block">Know it&rsquo;s real</span>
          <span className="hero-line block">before you pay</span>
          <span className="hero-line block">
            <span className="marker">a single rupee.</span>
          </span>
        </h1>
        <p className="hero-line mt-7 max-w-[34rem] text-lead text-ink">
          Asli helps a widow who cannot read claim her relief by voice, checks every &ldquo;relief payment&rdquo; message against her real case, and never lets an algorithm move her money.
        </p>
        <p lang="ur" dir="rtl" className="hero-line urdu mt-3 max-w-[34rem] text-right text-lg text-muted-ink">
          رقم بھیجنے سے پہلے جانیں کہ پیغام اصلی ہے۔
        </p>
        <div className="mt-9 flex flex-wrap gap-4">
          <BtnLink href="#check" className="hero-cta">
            Check a message
          </BtnLink>
          <BtnLink href="/login" variant="secondary" className="hero-cta">
            Try the demo
          </BtnLink>
        </div>
      </div>
      <div className="hero-art relative mx-auto w-full max-w-[560px]">
        <HeroArt className="h-auto w-full overflow-visible" />
      </div>
    </section>
  );
}
