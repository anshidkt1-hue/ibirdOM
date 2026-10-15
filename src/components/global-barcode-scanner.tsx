import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRole } from "@/components/role-provider";
import { findCounterProductByCode } from "@/lib/data";
import { addToPosCart } from "@/lib/pos-store";

// A USB/Bluetooth barcode scanner "types" the code very fast and ends with Enter.
// Keys that arrive closer together than this are treated as a scan, not a person typing.
const MAX_KEY_GAP_MS = 50;
const MIN_CODE_LENGTH = 3;

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// Listens on every page: a scan adds the product to the counter bill and opens Counter Sale.
// Scans into a text box are left alone (the Counter Sale search box handles its own scans).
export function GlobalBarcodeScanner() {
  const navigate = useNavigate();
  const { can } = useRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const latest = useRef({ navigate, can, pathname });
  latest.current = { navigate, can, pathname };

  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;

    const handleScan = async (code: string) => {
      const { can, navigate, pathname } = latest.current;
      if (!can("edit")) {
        toast.error("Your role cannot record counter sales");
        return;
      }
      try {
        const product = await findCounterProductByCode(code);
        if (!product) {
          toast.error(`No counter product with barcode or SKU "${code}"`);
          return;
        }
        const result = addToPosCart(product);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(`Added ${product.name} to the bill`);
        if (pathname !== "/pos") navigate({ to: "/pos" });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Scan failed");
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEditable(e.target)) {
        buffer = "";
        return;
      }

      const now = performance.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (e.key === "Enter") {
        const code = buffer;
        const isScan = code.length >= MIN_CODE_LENGTH && gap <= MAX_KEY_GAP_MS;
        buffer = "";
        if (isScan) {
          e.preventDefault();
          void handleScan(code);
        }
        return;
      }

      if (e.key.length !== 1) return;

      // A slow key starts a new run, so the buffer only ever holds one fast burst
      buffer = !buffer || gap > MAX_KEY_GAP_MS ? e.key : buffer + e.key;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}
