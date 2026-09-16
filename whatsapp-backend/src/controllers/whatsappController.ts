import { Request, Response } from 'express';
import { supabase } from '../server';
import { processCustomerMessage } from '../services/messageProcessor';
import { sendProductList } from '../services/whatsappService';

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

  // Respond immediately
  res.status(200).json({ received: true });

  try {
    if (body.object === 'whatsapp_business_account') {
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          if (change.field === 'messages') {
            const messages = change.value.messages || [];
            const contacts = change.value.contacts || [];

            // Handle incoming messages
            for (const message of messages) {
              await handleMessage(message, contacts[0]);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Webhook error:', error);
  }
}

async function handleMessage(message: any, contact: any) {
  const phoneNumber = message.from;
  const messageId = message.id;
  const timestamp = new Date(parseInt(message.timestamp) * 1000);

  console.log(`📨 Message from ${phoneNumber}: ${JSON.stringify(message)}`);

  // Log message
  await supabase.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    message_type: 'inbound',
    message_content: JSON.stringify(message),
    created_at: timestamp,
  });

  // Get or create session
  let sessionData = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (sessionData.error) {
    // Create new session
    const { data: newSession } = await supabase
      .from('whatsapp_sessions')
      .insert({
        phone_number: phoneNumber,
        session_state: 'welcome',
      })
      .select()
      .single();

    sessionData.data = newSession;
  }

  // Process message based on type
  if (message.type === 'text') {
    await processCustomerMessage(phoneNumber, message.text.body, sessionData.data);
  } else if (message.type === 'button') {
    await handleButtonReply(phoneNumber, message.button.payload, sessionData.data);
  } else if (message.type === 'interactive') {
    await handleInteractiveReply(phoneNumber, message.interactive, sessionData.data);
  }
}

async function handleButtonReply(phoneNumber: string, payload: string, session: any) {
  console.log(`🔘 Button clicked - ${phoneNumber}: ${payload}`);

  if (payload === 'start_order') {
    await supabase
      .from('whatsapp_sessions')
      .update({
        session_state: 'catalog',
        updated_at: new Date(),
      })
      .eq('phone_number', phoneNumber);

    await sendProductList(phoneNumber);
  }
}

async function handleInteractiveReply(phoneNumber: string, interactive: any, session: any) {
  console.log(`⚡ Interactive reply - ${phoneNumber}:`, interactive);

  const type = interactive.type;

  if (type === 'form_response') {
    await processFormSubmission(phoneNumber, interactive.form_response, session);
  } else if (type === 'list_reply') {
    await processListSelection(phoneNumber, interactive.list_reply, session);
  }
}

async function processFormSubmission(phoneNumber: string, formData: any, session: any) {
  console.log(`📝 Form submitted from ${phoneNumber}:`, formData);

  // Update session with form data
  await supabase
    .from('whatsapp_sessions')
    .update({
      form_data: formData,
      session_state: 'catalog',
      updated_at: new Date(),
    })
    .eq('phone_number', phoneNumber);

  // Send product catalog
  await sendProductList(phoneNumber);
}

async function processListSelection(phoneNumber: string, listData: any, session: any) {
  console.log(`🛒 Product selected - ${phoneNumber}: ${listData.id}`);

  // Get product details
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', listData.id)
    .single();

  if (!product) {
    console.error('Product not found');
    return;
  }

  // Add to cart
  const currentCart = session?.cart_items || [];
  const existingItem = currentCart.find((item: any) => item.product_id === product.id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    currentCart.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
    });
  }

  await supabase
    .from('whatsapp_sessions')
    .update({
      cart_items: currentCart,
      updated_at: new Date(),
    })
    .eq('phone_number', phoneNumber);

  console.log(`✅ Added to cart: ${product.name}`);

  // Ask if they want more items
  // TODO: Send "add more items" message
}

export async function handleMessageStatus(req: Request, res: Response) {
  try {
    const { messageId, status } = req.body;

    if (!messageId || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await supabase
      .from('whatsapp_messages')
      .update({ status })
      .eq('id', messageId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}