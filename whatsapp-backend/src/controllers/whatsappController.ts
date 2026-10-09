import { Request, Response } from 'express';
import { supabase } from '../server';
import {
  processCustomerMessage,
  processButtonReply,
  processListSelection,
} from '../services/messageProcessor';

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
            for (const message of change.value.messages || []) {
              try {
                await handleMessage(message);
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

async function handleMessage(message: any) {
  const phoneNumber = message.from;
  const timestamp = new Date(parseInt(message.timestamp) * 1000);

  console.log(`📨 Message from ${phoneNumber}: ${JSON.stringify(message)}`);

  const { error: logError } = await supabase.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    message_type: 'inbound',
    message_content: JSON.stringify(message),
    created_at: timestamp,
  });
  if (logError) console.error('❌ Message log failed:', logError.message);

  const { data: existing } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  let session = existing;
  if (!session) {
    const { data: created, error } = await supabase
      .from('whatsapp_sessions')
      .insert({ phone_number: phoneNumber, session_state: 'welcome' })
      .select()
      .single();
    if (error) console.error('❌ Session create failed (are the WhatsApp tables migrated?):', error.message);
    session = created;
  }

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
