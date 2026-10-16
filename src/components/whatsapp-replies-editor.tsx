import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/components/role-provider";
import { fetchSettings, saveSettings } from "@/lib/data";
import type { WhatsAppReplies } from "@/lib/inbox";

const EMPTY: WhatsAppReplies = { delivery: "", store: "", handoff: "", pause_hours: 4 };

const FIELDS: { key: "delivery" | "store" | "handoff"; label: string; hint: string; rows: number }[] = [
  {
    key: "delivery",
    label: "Delivery answer",
    hint: 'Sent when a customer asks about delivery ("delivery eppo kittum", "shipping charges", "COD?").',
    rows: 4,
  },
  {
    key: "store",
    label: "Store & timings answer",
    hint: 'Sent for "where is your shop", "timings", "kada evideya". Include the address, opening hours, map link and phone.',
    rows: 6,
  },
  {
    key: "handoff",
    label: "Hand-over message",
    hint: "Sent once when the bot passes a question to your team. The customer also gets a Start order button.",
    rows: 3,
  },
];

// Editable answers of the WhatsApp bot; the bot picks up changes within a minute
export function WhatsAppRepliesEditor() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings().catch(() => ({})) });
  const [form, setForm] = useState<WhatsAppReplies>(EMPTY);

  useEffect(() => {
    const saved = ((settings as any)?.whatsapp_replies ?? {}) as Partial<WhatsAppReplies>;
    setForm({ ...EMPTY, ...saved, pause_hours: Number(saved.pause_hours) || 4 });
  }, [settings]);

  const save = useMutation({
    mutationFn: () => saveSettings({ whatsapp_replies: form } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("WhatsApp replies saved. The bot uses them within a minute.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasPlaceholders = FIELDS.some((f) => /\[[^\]]+\]/.test(form[f.key]));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold">WhatsApp bot answers</h3>
        <p className="text-sm text-muted-foreground">
          The bot answers prices and order status by itself, and uses these texts for delivery, store and hand-over. Use{" "}
          <span className="font-mono">*bold*</span> and line breaks like in WhatsApp.
        </p>
        {hasPlaceholders && (
          <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            Replace the parts in [square brackets] with your real details. Customers see these texts as written.
          </p>
        )}
      </div>

      {FIELDS.map((f) => (
        <div key={f.key}>
          <Label htmlFor={`reply-${f.key}`}>{f.label}</Label>
          <p className="text-xs text-muted-foreground">{f.hint}</p>
          <Textarea
            id={`reply-${f.key}`}
            className="mt-2 font-mono text-sm"
            rows={f.rows}
            value={form[f.key]}
            disabled={!can("edit")}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
          />
        </div>
      ))}

      <div className="max-w-xs">
        <Label htmlFor="reply-pause">Bot stays quiet after hand-over (hours)</Label>
        <p className="text-xs text-muted-foreground">
          While your team handles a chat the bot does not answer that customer. "menu" or Start order brings it back.
        </p>
        <Input
          id="reply-pause"
          className="mt-2"
          type="number"
          min={1}
          max={72}
          value={form.pause_hours}
          disabled={!can("edit")}
          onChange={(e) => setForm({ ...form, pause_hours: Math.min(72, Math.max(1, Number(e.target.value) || 1)) })}
        />
      </div>

      {can("edit") && (
        <Button className="gap-2" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="size-4" /> {save.isPending ? "Saving…" : "Save replies"}
        </Button>
      )}
    </div>
  );
}
