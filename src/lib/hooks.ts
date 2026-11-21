"use client";

import * as React from "react";
import { api, ApiError, session, type Session } from "@/lib/api";

export function useSession() {
  const [s, setS] = React.useState<Session | null | undefined>(undefined);
  React.useEffect(() => setS(session.get()), []);
  return s;
}

/** Fetch on mount and whenever `reload()` is called. `key` changes also refetch. */
export function useApi<T>(path: string | null, opts: { asFamily?: boolean; key?: unknown } = {}) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [loading, setLoading] = React.useState(!!path);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path, { asFamily: opts.asFamily })
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, opts.asFamily, opts.key]);
  const reload = React.useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, reload, setData };
}

/** Run a write, toast the result, and return it. */
export function useAction() {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = React.useCallback(async <T,>(id: string, fn: () => Promise<T>, done?: (r: T) => void, fail?: (e: ApiError) => void) => {
    setBusy(id);
    try {
      const r = await fn();
      done?.(r);
      return r;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e));
      if (fail) fail(err);
      else {
        const { toast } = await import("sonner");
        toast.error(err.message, { description: err.code });
      }
      return null;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}

export const fmtPKR = (n: number | null | undefined) => (n == null ? "—" : `Rs ${n.toLocaleString("en-PK")}`);
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
