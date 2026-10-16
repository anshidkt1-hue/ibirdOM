-- WhatsApp enquiries: automatic answers, hand-over to staff, and a dashboard inbox. Safe to re-run.

-- Conversation state per customer
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS needs_reply boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz;  -- staff are handling the chat
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;   -- WhatsApp allows free replies for 24 h after this
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS last_welcome_at timestamptz;   -- the welcome is not repeated within minutes
ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS profile_name text;             -- name shown in the customer's WhatsApp
CREATE INDEX IF NOT EXISTS whatsapp_sessions_inbox_idx
  ON public.whatsapp_sessions (needs_reply, last_inbound_at DESC);

-- Readable messages for the inbox (inbound and outbound, bot or staff)
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS kind text;        -- text, button, image, audio, catalog, ...
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by uuid;     -- employee who replied (null = bot)
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by_name text;
CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_created_idx
  ON public.whatsapp_messages (phone_number, created_at DESC);

-- Body text for messages logged before this change
UPDATE public.whatsapp_messages
SET body = coalesce(
      message_content::jsonb #>> '{text,body}',
      message_content::jsonb #>> '{interactive,button_reply,title}',
      message_content::jsonb #>> '{interactive,list_reply,title}',
      message_content::jsonb #>> '{button,text}',
      '[' || coalesce(message_content::jsonb ->> 'type', 'message') || ']'
    ),
    kind = coalesce(message_content::jsonb ->> 'type', 'text')
WHERE body IS NULL AND message_type = 'inbound' AND message_content LIKE '{%';

-- The dashboard reads the inbox like the other tables
DROP POLICY IF EXISTS "demo open access whatsapp_sessions" ON public.whatsapp_sessions;
CREATE POLICY "demo open access whatsapp_sessions" ON public.whatsapp_sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "demo open access whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "demo open access whatsapp_messages" ON public.whatsapp_messages FOR SELECT TO anon, authenticated USING (true);

-- Editable bot answers (Settings → WhatsApp replies); placeholders until the store fills them in (E'' = real line breaks)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_replies jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE public.settings
SET whatsapp_replies = jsonb_build_object(
  'delivery', E'🚚 *Delivery*\nWe deliver across [your delivery area] in [2–4] working days.\nDelivery charge: [₹ amount / free above ₹ amount].',
  'store', E'📍 *Visit our store*\n[Store address]\nOpen [Mon–Sat, 10 am – 8 pm]\nMap: [Google Maps link]\nCall: [store phone number]',
  'handoff', E'Thanks for your message! 🙏 Our team will reply shortly.\nTo place an order now, tap *Start order*.',
  'pause_hours', 4
) || whatsapp_replies
WHERE NOT (whatsapp_replies ? 'delivery');

-- Existing chats: time of the last customer message
UPDATE public.whatsapp_sessions s SET last_inbound_at = m.last
FROM (SELECT phone_number, max(created_at) AS last FROM public.whatsapp_messages WHERE message_type = 'inbound' GROUP BY phone_number) m
WHERE m.phone_number = s.phone_number AND s.last_inbound_at IS NULL;
