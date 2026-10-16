import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, Clock, Loader2, MessageCircle, PauseCircle, Search, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/components/role-provider";
import {
  botPaused,
  canReply,
  fetchConversations,
  fetchThread,
  pauseBot,
  resolveConversation,
  sendInboxReply,
  type Conversation,
} from "@/lib/inbox";
import { timeAgo } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox")({
  // ?phone= opens that conversation (used by enquiry notifications)
  validateSearch: (search: Record<string, unknown>): { phone?: string } =>
    typeof search["phone"] === "string" ? { phone: search["phone"] } : {},
  head: () => ({
    meta: [
      { title: "WhatsApp Inbox — ibird" },
      { name: "description", content: "Customer enquiries from WhatsApp that need a reply from the team." },
    ],
  }),
  component: InboxPage,
});

const clockTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function InboxPage() {
  const { phone: selected } = Route.useSearch();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"needs_reply" | "all">("needs_reply");
  const [search, setSearch] = useState("");

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["inbox", "conversations", filter, search],
    queryFn: () => fetchConversations(filter, search),
    refetchInterval: 10_000,
  });
  const { data: needsReply = [] } = useQuery({
    queryKey: ["inbox", "conversations", "needs_reply", ""],
    queryFn: () => fetchConversations("needs_reply"),
    refetchInterval: 10_000,
  });

  // The open conversation may be outside the current filter (e.g. just marked done)
  const { data: allConversations = [] } = useQuery({
    queryKey: ["inbox", "conversations", "all", ""],
    queryFn: () => fetchConversations("all"),
    refetchInterval: 10_000,
    enabled: Boolean(selected),
  });
  const current = useMemo(
    () => conversations.find((c) => c.phone === selected) ?? allConversations.find((c) => c.phone === selected) ?? null,
    [conversations, allConversations, selected],
  );

  const open = (phone?: string) => navigate({ to: "/inbox", search: phone ? { phone } : {} });

  return (
    <AppShell
      title="WhatsApp Inbox"
      subtitle={
        needsReply.length
          ? `${needsReply.length} conversation${needsReply.length > 1 ? "s" : ""} waiting for a reply`
          : "No customer is waiting for a reply."
      }
    >
      <div className="grid h-[calc(100dvh-11rem)] min-h-[28rem] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Conversations */}
        <div className={cn("card-surface flex min-h-0 flex-col overflow-hidden", selected && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              {(
                [
                  ["needs_reply", `Needs reply (${needsReply.length})`],
                  ["all", "All chats"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
                    filter === value ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {conversations.map((c) => (
              <ConversationRow key={c.phone} c={c} active={c.phone === selected} onClick={() => open(c.phone)} />
            ))}
            {!conversations.length && (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
                {isLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <>
                    <MessageCircle className="size-6" />
                    {filter === "needs_reply" ? "All caught up. No customer is waiting." : "No WhatsApp chats yet."}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={cn("card-surface flex min-h-0 flex-col overflow-hidden", !selected && "hidden lg:flex")}>
          {selected && current ? (
            <Thread conversation={current} onBack={() => open()} />
          ) : selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading conversation…
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <MessageCircle className="size-8" />
              Choose a conversation to read and reply.
              <span className="max-w-sm text-xs">
                The bot answers prices, delivery, store timings and order status by itself. Everything else lands here.
              </span>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ConversationRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary",
        active && "bg-secondary",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
        {c.name.replace(/^\+/, "").slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", c.needsReply ? "font-bold" : "font-medium")}>{c.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {c.lastFromCustomer ? "" : "You: "}
            {c.lastMessage || "—"}
          </span>
          {c.needsReply && <span className="size-2 shrink-0 rounded-full bg-destructive" aria-label="Needs reply" />}
        </span>
        {botPaused(c) && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-warning">
            <PauseCircle className="size-3" /> Bot paused
          </span>
        )}
      </span>
    </button>
  );
}

function Thread({ conversation: c, onBack }: { conversation: Conversation; onBack: () => void }) {
  const { user } = useRole();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["inbox", "thread", c.phone],
    queryFn: () => fetchThread(c.phone),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, c.phone]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["inbox"] });

  const send = useMutation({
    mutationFn: () => {
      if (!user?.id) throw new Error("Log in again to reply");
      return sendInboxReply(c.phone, text.trim(), user.id);
    },
    onSuccess: () => {
      setText("");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const done = useMutation({
    mutationFn: () => resolveConversation(c.phone),
    onSuccess: () => {
      toast.success("Marked done. The bot answers this customer again.");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: () => pauseBot(c.phone, 4),
    onSuccess: () => {
      toast.success("Bot paused for 4 hours for this customer");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const replyOpen = canReply(c);
  const paused = botPaused(c);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Button size="icon" variant="ghost" className="lg:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{c.name}</p>
          <p className="text-xs text-muted-foreground">
            +{c.phone}
            {paused ? (
              <span className="ml-2 font-semibold text-warning">· Bot paused, your team is handling this chat</span>
            ) : (
              <span className="ml-2">· Bot is answering</span>
            )}
          </p>
        </div>
        {!paused && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={pause.isPending} onClick={() => pause.mutate()}>
            <PauseCircle className="size-4" /> Pause bot
          </Button>
        )}
        {(c.needsReply || paused) && (
          <Button size="sm" className="gap-1.5" disabled={done.isPending} onClick={() => done.mutate()}>
            <CheckCircle2 className="size-4" /> Mark done
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-secondary/40 px-3 py-4">
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
                m.direction === "in"
                  ? "rounded-bl-sm bg-card"
                  : m.sentByName
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-br-sm bg-success/15",
              )}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px]",
                  m.direction === "out" && m.sentByName ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {m.direction === "out" &&
                  (m.sentByName ? (
                    <>
                      <UserRound className="size-3" /> {m.sentByName} ·
                    </>
                  ) : (
                    <>
                      <Bot className="size-3" /> Bot ·
                    </>
                  ))}
                {clockTime(m.at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        {replyOpen ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) send.mutate();
            }}
          >
            <Textarea
              rows={2}
              className="min-h-0 flex-1 resize-none"
              placeholder="Type your reply… (Enter to send, Shift+Enter for a new line)"
              value={text}
              maxLength={4096}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim() && !send.isPending) send.mutate();
                }
              }}
            />
            <Button type="submit" className="gap-1.5" disabled={!text.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send
            </Button>
          </form>
        ) : (
          <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            <Clock className="size-4 shrink-0" />
            More than 24 hours since this customer last wrote. WhatsApp only allows a reply after they message again.
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Replies are sent from the ibird WhatsApp number. Sending a reply keeps the bot paused for this customer;
          tap <span className="font-semibold">Mark done</span> to hand them back to the bot.
        </p>
      </div>
    </>
  );
}
