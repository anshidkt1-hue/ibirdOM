import { Request, Response } from 'express';
import { supabase } from '../server';
import { sendTextMessage } from '../services/whatsappService';
import { getReplies } from '../services/enquiryService';

const REPLY_WINDOW_MS = 24 * 3600_000; // WhatsApp: free-form replies only within 24 h of the customer's last message
const MAX_PER_MINUTE = 20;
const recent = new Map<string, number[]>();

function rateLimited(phone: string) {
  const now = Date.now();
  const times = (recent.get(phone) ?? []).filter((t) => now - t < 60_000);
  times.push(now);
  recent.set(phone, times);
  return times.length > MAX_PER_MINUTE;
}

// Staff reply from the dashboard inbox. The bot stays paused while staff handle the chat.
export async function sendInboxReply(req: Request, res: Response) {
  const phone = String(req.body?.phone ?? '').replace(/\D/g, '');
  const text = String(req.body?.text ?? '').trim();
  const employeeId = String(req.body?.employeeId ?? '');

  if (!phone || !text) return res.status(400).json({ error: 'Phone and message are required' });
  if (text.length > 4096) return res.status(400).json({ error: 'Message is too long (max 4,096 characters)' });

  const { data: employee } = await supabase.from('employees').select('id, name').eq('id', employeeId).maybeSingle();
  if (!employee) return res.status(403).json({ error: 'Unknown staff member' });

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('last_inbound_at, bot_paused_until')
    .eq('phone_number', phone)
    .maybeSingle();
  if (!session?.last_inbound_at || Date.now() - new Date(session.last_inbound_at).getTime() > REPLY_WINDOW_MS) {
    return res.status(409).json({
      error: 'More than 24 hours since the customer last wrote. WhatsApp only allows a reply after they message again.',
    });
  }
  if (rateLimited(phone)) return res.status(429).json({ error: 'Too many messages. Wait a minute.' });

  try {
    await sendTextMessage(phone, text, { id: employee.id, name: employee.name });
  } catch (error: any) {
    const reason = error.response?.data?.error?.message ?? error.message;
    return res.status(502).json({ error: `WhatsApp did not accept the message: ${reason}` });
  }

  const { pause_hours } = await getReplies();
  const pausedUntil = Math.max(
    session.bot_paused_until ? new Date(session.bot_paused_until).getTime() : 0,
    Date.now() + pause_hours * 3600_000
  );
  await supabase
    .from('whatsapp_sessions')
    .update({ needs_reply: false, bot_paused_until: new Date(pausedUntil), updated_at: new Date() })
    .eq('phone_number', phone);

  return res.json({ ok: true });
}
