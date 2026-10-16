import { Request, Response } from 'express';
import { supabase } from '../server';
import {
  processCustomerMessage,
  processButtonReply,
  processListSelection,
  processCatalogOrder,
  processMediaMessage,
} from '../services/messageProcessor';
import { isBotPaused } from '../services/enquiryService';

export async function verifyWebhookToken(req: Request, res: Response) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verified!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
}

export async function handleIncomingMessage(req: Request, res: Response) {
  const body = req.body;

  res.status(200).json({ received: true });

  try {
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            // The name the customer uses on WhatsApp, shown in the dashboard inbox
            const names = new Map<string, string>(
              (change.value.contacts || []).map((c: any) => [c.wa_id, c.profile?.name])
            );
            for (const message of change.value.messages || []) {
              try {
                await handleMessage(message, names.get(message.from));
              } catch (error: any) {
                console.error('❌ Message handling failed:', error?.response?.data || error?.message || error);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Webhook error:', error);
  }
}

// Readable text of an incoming message for the inbox
function describe(message: any): { body: string; kind: string } {
  const kind = message.type ?? 'unknown';
  switch (kind) {
    case 'text':
      return { body: message.text?.body ?? '', kind };
    case 'interactive':
      return {
        body: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '[choice]',
        kind: message.interactive?.type ?? kind,
      };
    case 'button':
      return { body: message.button?.text ?? '[button]', kind };
    case 'order':
      return { body: `🛒 Sent cart (${(message.order?.product_items || []).length} products)`, kind };
    case 'image':
      return { body: `🖼️ Photo${message.image?.caption ? `: ${message.image.caption}` : ''}`, kind };
    case 'video':
      return { body: `🎬 Video${message.video?.caption ? `: ${message.video.caption}` : ''}`, kind };
    case 'audio':
      return { body: message.audio?.voice ? '🎤 Voice note' : '🎵 Audio', kind };
    case 'document':
      return { body: `📄 ${message.document?.filename ?? 'Document'}`, kind };
    case 'location':
      return { body: `📍 Location${message.location?.name ? `: ${message.location.name}` : ''}`, kind };
    case 'contacts':
      return { body: '👤 Contact card', kind };
    case 'sticker':
      return { body: '🙂 Sticker', kind };
    case 'reaction':
      return { body: `Reacted ${message.reaction?.emoji ?? ''}`, kind };
    default:
      return { body: `[${kind}]`, kind };
  }
}

async function handleMessage(message: any, profileName?: string) {
  const phoneNumber = message.from;
  const timestamp = new Date(parseInt(message.timestamp) * 1000);

  console.log(`📨 Message from ${phoneNumber}: ${JSON.stringify(message)}`);

  // Meta re-delivers events; the unique wa_message_id makes handling exactly-once.
  const { body, kind } = describe(message);
  const { error: logError } = await supabase.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    message_type: 'inbound',
    message_content: JSON.stringify(message),
    body,
    kind,
    wa_message_id: message.id,
    created_at: timestamp,
  });
  if (logError) {
    if (logError.code === '23505') {
      console.log(`↩️ Duplicate delivery ignored: ${message.id}`);
      return;
    }
    console.error('❌ Message log failed:', logError.message);
  }

  await supabase
    .from('whatsapp_sessions')
    .upsert(
      { phone_number: phoneNumber, session_state: 'welcome' },
      { onConflict: 'phone_number', ignoreDuplicates: true }
    );

  const { data: session, error: sessionError } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  if (sessionError) console.error('❌ Session load failed:', sessionError.message);

  // Last message time (WhatsApp allows free replies for 24 h after it) and the customer's WhatsApp name.
  // While staff are handling the chat, every new message waits for them in the inbox.
  const touch: Record<string, any> = { last_inbound_at: timestamp };
  if (profileName) touch.profile_name = profileName.slice(0, 80);
  if (isBotPaused(session) && kind !== 'reaction') touch.needs_reply = true;
  await supabase.from('whatsapp_sessions').update(touch).eq('phone_number', phoneNumber);

  if (message.type === 'text') {
    await processCustomerMessage(phoneNumber, message.text.body, session);
  } else if (message.type === 'interactive') {
    const interactive = message.interactive;
    if (interactive.type === 'button_reply') {
      await processButtonReply(phoneNumber, interactive.button_reply.id);
    } else if (interactive.type === 'list_reply') {
      await processListSelection(phoneNumber, interactive.list_reply.id);
    }
  } else if (message.type === 'button') {
    await processButtonReply(phoneNumber, message.button.payload);
  } else if (message.type === 'order') {
    await processCatalogOrder(phoneNumber, message.order?.product_items || [], session);
  } else {
    await processMediaMessage(phoneNumber, message.type, session);
  }
}

export async function handleMessageStatus(req: Request, res: Response) {
  try {
    const { messageId, status } = req.body;

    if (!messageId || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await supabase.from('whatsapp_messages').update({ status }).eq('id', messageId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}
