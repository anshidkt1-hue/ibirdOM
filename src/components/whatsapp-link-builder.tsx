import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "wa-link-builder";
const DEFAULT_MESSAGE = "Hi! I want to order and take part in the Thar ROXX giveaway.";

function load(): { number: string; message: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { number: "", message: DEFAULT_MESSAGE, ...JSON.parse(raw) };
  } catch {
    // storage unavailable: fall back to defaults
  }
  return { number: "", message: DEFAULT_MESSAGE };
}

export function WhatsAppLinkBuilder() {
  const [number, setNumber] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  useEffect(() => {
    const saved = load();
    setNumber(saved.number);
    setMessage(saved.message);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ number, message }));
    } catch {
      // not critical
    }
  }, [number, message]);

  const digits = number.replace(/\D/g, "");
  const valid = digits.length >= 11 && digits.length <= 15;
  const link = useMemo(
    () => (valid ? `https://wa.me/${digits}?text=${encodeURIComponent(message.trim())}` : ""),
    [valid, digits, message],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.");
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">WhatsApp order link</h3>
        <p className="text-sm text-muted-foreground">
          When a customer taps this link, WhatsApp opens your chat with the message below already typed. They only
          press send, and the order bot takes over.
        </p>
      </div>

      <div>
        <Label>WhatsApp business number (with country code)</Label>
        <Input
          className="mt-1"
          inputMode="tel"
          placeholder="e.g. 91 80758 65179"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        {number && !valid && (
          <p className="mt-1 text-xs text-destructive">Enter the full number including country code, e.g. 91 for India.</p>
        )}
      </div>

      <div>
        <Label>Pre-filled message</Label>
        <Textarea className="mt-1" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>

      <div>
        <Label>Your link</Label>
        <div className="mt-1 break-all rounded-md border border-border bg-secondary p-3 font-mono text-sm">
          {link || "Enter the number to generate the link"}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!link} onClick={copy} className="gap-2">
            <Copy className="size-4" /> Copy link
          </Button>
          <Button variant="outline" disabled={!link} asChild={!!link} className="gap-2">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Test link
              </a>
            ) : (
              <span>
                <ExternalLink className="size-4" /> Test link
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="font-semibold">Where to use it</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Instagram bio link, story link sticker, and the influencer's posts and stories.</li>
          <li>
            Instagram / Facebook "Click to WhatsApp" ads don't use this link. Paste the same message into the ad's
            pre-filled message field in Meta Ads Manager.
          </li>
        </ul>
      </div>
    </div>
  );
}
