// WhatsApp inbox: customer conversations, staff replies (sent through the WhatsApp backend, which holds
// the access token) and the bot's automatic answers.
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as { from: (table: string) => any };

export const WHATSAPP_BACKEND_URL = (
  (import.meta.env["VITE_WHATSAPP_BACKEND_URL"] as string | undefined) || "https://ibird-whatsapp.onrender.com"
).replace(/\/$/, "");

export const REPLY_WINDOW_MS = 24 * 3600_000;

export type Conversation = {
  phone: string;
  name: string;
  needsReply: boolean;
  botPausedUntil: string | null;
  lastInboundAt: string | null;
  lastMessage: string;
  lastAt: string;
  lastFromCustomer: boolean;
  state: string;
};

export type InboxMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  kind: string | null;
  at: string;
  sentByName: string | null; // staff member; null = bot
};

export const botPaused = (c: Pick<Conversation, "botPausedUntil">) =>
  Boolean(c.botPausedUntil && new Date(c.botPausedUntil).getTime() > Date.now());

export const canReply = (c: Pick<Conversation, "lastInboundAt">) =>
  Boolean(c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() < REPLY_WINDOW_MS);

export async function fetchConversations(filter: "needs_reply" | "all", search = ""): Promise<Conversation[]> {
  let q = db
    .from("whatsapp_sessions")
    .select("phone_number, profile_name, form_data, customer_id, needs_reply, bot_paused_until, last_inbound_at, session_state")
    .not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: false })
    .limit(200);
  if (filter === "needs_reply") q = q.eq("needs_reply", true);
  const { data, error } = await q;
  if (error) throw error;
  const sessions = (data ?? []) as any[];
  if (!sessions.length) return [];

  const phones = sessions.map((s) => s.phone_number);
  const customerIds = sessions.map((s) => s.customer_id).filter(Boolean);
  const [{ data: messages }, { data: customers }] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("phone_number, body, message_type, created_at")
      .in("phone_number", phones)
      .not("body", "is", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(2000, phones.length * 15)),
    customerIds.length ? db.from("customers").select("id, name").in("id", customerIds) : Promise.resolve({ data: [] }),
  ]);
  const lastByPhone = new Map<string, any>();
  for (const m of (messages ?? []) as any[]) if (!lastByPhone.has(m.phone_number)) lastByPhone.set(m.phone_number, m);
  const customerName = new Map(((customers ?? []) as any[]).map((c) => [c.id, c.name]));

  const term = search.trim().toLowerCase();
  return sessions
    .map((s) => {
      const last = lastByPhone.get(s.phone_number);
      return {
        phone: s.phone_number,
        name: customerName.get(s.customer_id) || s.form_data?.name || s.profile_name || `+${s.phone_number}`,
        needsReply: Boolean(s.needs_reply),
        botPausedUntil: s.bot_paused_until,
        lastInboundAt: s.last_inbound_at,
        lastMessage: last?.body ?? "",
        lastAt: last?.created_at ?? s.last_inbound_at,
        lastFromCustomer: last ? last.message_type === "inbound" : true,
        state: s.session_state,
      } as Conversation;
    })
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term.replace(/\D/g, "") || "\u0000"));
}

export async function fetchThread(phone: string): Promise<InboxMessage[]> {
  const { data, error } = await db
    .from("whatsapp_messages")
    .select("id, message_type, body, kind, created_at, sent_by_name")
    .eq("phone_number", phone)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as any[])
    .map((m) => ({
      id: m.id,
      direction: m.message_type === "inbound" ? ("in" as const) : ("out" as const),
      body: m.body,
      kind: m.kind,
      at: m.created_at,
      sentByName: m.sent_by_name,
    }))
    .reverse();
}

export async function sendInboxReply(phone: string, text: string, employeeId: string) {
  const res = await fetch(`${WHATSAPP_BACKEND_URL}/api/whatsapp/inbox/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, text, employeeId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not send (${res.status})`);
}

// Done: no reply needed and the bot answers this customer again
export async function resolveConversation(phone: string) {
  const { error } = await db
    .from("whatsapp_sessions")
    .update({ needs_reply: false, bot_paused_until: null, updated_at: new Date().toISOString() })
    .eq("phone_number", phone);
  if (error) throw error;
}

// Staff take over without replying yet: the bot stays quiet for the given hours
export async function pauseBot(phone: string, hours: number) {
  const { error } = await db
    .from("whatsapp_sessions")
    .update({ bot_paused_until: new Date(Date.now() + hours * 3600_000).toISOString(), updated_at: new Date().toISOString() })
    .eq("phone_number", phone);
  if (error) throw error;
}

export async function fetchNeedsReplyCount(): Promise<number> {
  const { count } = await db
    .from("whatsapp_sessions")
    .select("phone_number", { count: "exact", head: true })
    .eq("needs_reply", true);
  return count ?? 0;
}

export type WhatsAppReplies = { delivery: string; store: string; handoff: string; pause_hours: number };
