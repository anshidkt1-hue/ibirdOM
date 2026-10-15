import { useSyncExternalStore } from "react";
import type { Product } from "@/lib/data";

export type CartLine = { product: Product; quantity: number };
export type DiscountType = "amount" | "percent";

export type PosDraft = {
  cart: CartLine[];
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  specialInstructions: string;
  payment: string;
  discountType: DiscountType;
  discountValue: number;
  notes: string;
};

export type HeldBill = { id: string; label: string; heldAt: string; draft: PosDraft };

type PosState = { draft: PosDraft; held: HeldBill[] };

const STORAGE_KEY = "ibird-pos-v1";

export const emptyDraft = (): PosDraft => ({
  cart: [],
  customerId: "walkin",
  customerName: "",
  customerPhone: "",
  deliveryAddress: "",
  specialInstructions: "",
  payment: "cash",
  discountType: "amount",
  discountValue: 0,
  notes: "",
});

const SERVER_STATE: PosState = { draft: emptyDraft(), held: [] };

// The open bill and held bills live here (not inside the Counter Sale page) so a barcode
// scanned on any page can add to the bill, and a refresh does not lose anything.
function load(): PosState {
  if (typeof window === "undefined") return SERVER_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return {
        draft: { ...emptyDraft(), ...saved.draft },
        held: Array.isArray(saved.held) ? saved.held : [],
      };
    }
  } catch {
    // storage unavailable or corrupt: start clean
  }
  return { draft: emptyDraft(), held: [] };
}

let state: PosState = load();
const listeners = new Set<() => void>();

function commit(next: PosState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // not critical: the bill still works for this page session
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePosStore(): PosState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export function updateDraft(patch: Partial<PosDraft> | ((d: PosDraft) => Partial<PosDraft>)) {
  const p = typeof patch === "function" ? patch(state.draft) : patch;
  commit({ ...state, draft: { ...state.draft, ...p } });
}

export function resetDraft() {
  commit({ ...state, draft: emptyDraft() });
}

export function addToPosCart(product: Product): { ok: boolean; message?: string } {
  const line = state.draft.cart.find((l) => l.product.id === product.id);
  const quantity = (line?.quantity ?? 0) + 1;
  if (quantity > product.stock) {
    return { ok: false, message: `Only ${product.stock} of ${product.name} in stock` };
  }
  const cart = line
    ? state.draft.cart.map((l) => (l.product.id === product.id ? { product, quantity } : l))
    : [...state.draft.cart, { product, quantity: 1 }];
  updateDraft({ cart });
  return { ok: true };
}

function billLabel(draft: PosDraft, at: Date) {
  return (
    draft.customerName.trim() ||
    `Bill ${at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
  );
}

function makeHeld(draft: PosDraft): HeldBill {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    label: billLabel(draft, now),
    heldAt: now.toISOString(),
    draft,
  };
}

export function holdCurrentBill(): HeldBill | null {
  if (!state.draft.cart.length) return null;
  const bill = makeHeld(state.draft);
  commit({ draft: emptyDraft(), held: [bill, ...state.held] });
  return bill;
}

// Resuming while another bill is open holds that one first, so nothing is lost.
export function resumeHeldBill(id: string): { resumed: HeldBill | null; heldCurrent: boolean } {
  const bill = state.held.find((b) => b.id === id);
  if (!bill) return { resumed: null, heldCurrent: false };
  let held = state.held.filter((b) => b.id !== id);
  const heldCurrent = state.draft.cart.length > 0;
  if (heldCurrent) held = [makeHeld(state.draft), ...held];
  commit({ draft: bill.draft, held });
  return { resumed: bill, heldCurrent };
}

export function deleteHeldBill(id: string) {
  commit({ ...state, held: state.held.filter((b) => b.id !== id) });
}
