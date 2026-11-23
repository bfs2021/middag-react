/**
 * FlashProvider — consumes Inertia flash messages and displays Sonner toasts.
 *
 * Flash messages are server-sent one-shot notifications (success/error/info/warning).
 * This provider listens to flash prop changes on each Inertia navigation and
 * fires the appropriate toast. Does not re-fire if flash is unchanged.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { usePage } from "@inertiajs/react";
import { toast } from "sonner";

import type { SharedProps } from "@/contracts/shared-props";

export function FlashProvider({ children }: { children: ReactNode }) {
  const { props } = usePage<SharedProps>();
  const flash = props.flash;

  // Track last processed flash to avoid duplicate toasts on re-renders
  // that are not caused by new navigation (e.g., state updates in parent).
  const lastFlashRef = useRef<typeof flash>(null);

  useEffect(() => {
    if (!flash) return;

    // Stringify comparison — only fire if flash content changed
    if (JSON.stringify(flash) === JSON.stringify(lastFlashRef.current)) return;
    lastFlashRef.current = flash;

    if (flash.success) toast.success(flash.success);
    if (flash.error) toast.error(flash.error);
    if (flash.info) toast.info(flash.info);
    if (flash.warning) toast.warning(flash.warning);
  }, [flash]);

  return <>{children}</>;
}
