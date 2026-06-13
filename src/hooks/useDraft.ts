import { useEffect, useRef, useState, useCallback } from "react";
import { saveDraft, deleteDraft, getDraft } from "@/lib/drafts";
import { useAuth } from "@/contexts/AuthContext";

export type DraftStatus = "idle" | "saving" | "saved" | "error";

type Options = {
  scope: string | null; // null disables the hook
  value: any;
  enabled?: boolean;
  debounceMs?: number;
  itemCount?: number;
  label?: string;
  isEmpty?: (value: any) => boolean; // when true, do not save and clear instead
};

export function useDraft({
  scope, value, enabled = true, debounceMs = 400, itemCount, label, isEmpty,
}: Options) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timerRef = useRef<number | null>(null);
  const firstRun = useRef(true);

  // beforeunload while saving
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (status === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [status]);

  useEffect(() => {
    if (!enabled || !scope || !userId) return;
    // skip the very first render so we don't overwrite a freshly restored draft
    if (firstRun.current) { firstRun.current = false; return; }

    if (timerRef.current) window.clearTimeout(timerRef.current);
    setStatus("saving");
    timerRef.current = window.setTimeout(async () => {
      try {
        if (isEmpty?.(value)) {
          await deleteDraft(userId, scope);
          setStatus("idle");
          setLastSaved(null);
          return;
        }
        await saveDraft(userId, scope, value, { itemCount, label });
        setStatus("saved");
        setLastSaved(new Date());
      } catch (e) {
        console.error("draft save failed", e);
        setStatus("error");
      }
    }, debounceMs);

    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [enabled, scope, userId, value, debounceMs, itemCount, label, isEmpty]);

  const clear = useCallback(async () => {
    if (!scope || !userId) return;
    try { await deleteDraft(userId, scope); } catch {}
    setStatus("idle");
    setLastSaved(null);
  }, [scope, userId]);

  const load = useCallback(async () => {
    if (!scope || !userId) return null;
    try { return await getDraft(userId, scope); } catch { return null; }
  }, [scope, userId]);

  return { status, lastSaved, clear, load };
}
