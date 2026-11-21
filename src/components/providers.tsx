"use client";

import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        {children}
        <Toaster position="top-center" toastOptions={{ classNames: { toast: "!rounded-[14px] !border !border-ink !shadow-hard !font-sans" } }} />
      </TooltipProvider>
    </MotionConfig>
  );
}
