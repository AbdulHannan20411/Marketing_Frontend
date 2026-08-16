import type {
  Conversation,
  ConversationMessage,
  MediaAsset,
} from '@core/models/whatsapp.model';

/**
 * In-memory conversations for the inbox.
 *
 * Window states are expressed as offsets from *now* rather than fixed dates, so
 * the seed always shows one thread with hours left, one about to close and one
 * already shut — the three cases the composer has to handle.
 */

const minutes = (count: number): number => count * 60_000;
const hours = (count: number): number => count * 3_600_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

let nextMessageId = 500;

export const conversationStore: Conversation[] = [
  {
    id: 'cnv_1',
    contactId: 'con_1',
    contactName: 'Amara Okafor',
    phoneNumber: '+44 7700 900123',
    lastMessagePreview: 'Perfect, thank you! Could you send the receipt?',
    lastMessageAt: iso(-minutes(4)),
    unreadCount: 2,
    windowExpiresAt: iso(hours(23) + minutes(56)),
  },
  {
    id: 'cnv_2',
    contactId: 'con_2',
    contactName: 'Bilal Rahman',
    phoneNumber: '+92 300 1234567',
    lastMessagePreview: 'Is the offer still running?',
    lastMessageAt: iso(-hours(23) - minutes(18)),
    unreadCount: 0,
    // Deliberately close to the edge, so the "closing soon" warning shows.
    windowExpiresAt: iso(minutes(42)),
  },
  {
    id: 'cnv_3',
    contactId: null,
    contactName: 'Chen Wei',
    phoneNumber: '+65 8123 4567',
    lastMessagePreview: 'Thanks!',
    lastMessageAt: iso(-hours(52)),
    unreadCount: 0,
    windowExpiresAt: null,
  },
];

const VOICE_NOTE: MediaAsset = {
  id: 'med_voice_1',
  kind: 'audio',
  fileName: 'voice-note.ogg',
  mimeType: 'audio/ogg',
  sizeBytes: 48_210,
  // A real deployment serves this from the API; the mock has no audio bytes.
  url: '/whatsapp/media/med_voice_1',
  uploadedAt: iso(-minutes(6)),
};

export const messageStore: Record<string, ConversationMessage[]> = {
  cnv_1: [
    {
      id: 'msg_1',
      direction: 'outbound',
      kind: 'template',
      body: 'Hi Amara, your order NR-4821 has shipped and arrives Thursday.',
      media: null,
      status: 'read',
      failureReason: null,
      templateName: 'order_shipped_update',
      occurredAt: iso(-hours(2)),
    },
    {
      id: 'msg_2',
      direction: 'inbound',
      kind: 'text',
      body: 'Brilliant — is it going to the office address?',
      media: null,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-minutes(48)),
    },
    {
      id: 'msg_3',
      direction: 'outbound',
      kind: 'text',
      body: 'It is, yes. 14 Prince Street, arriving before 6pm.',
      media: null,
      status: 'read',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-minutes(40)),
    },
    {
      id: 'msg_4',
      direction: 'inbound',
      kind: 'audio',
      body: '',
      media: VOICE_NOTE,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-minutes(6)),
    },
    {
      id: 'msg_5',
      direction: 'inbound',
      kind: 'text',
      body: 'Perfect, thank you! Could you send the receipt?',
      media: null,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-minutes(4)),
    },
  ],
  cnv_2: [
    {
      id: 'msg_10',
      direction: 'inbound',
      kind: 'text',
      body: 'Is the offer still running?',
      media: null,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-hours(23) - minutes(18)),
    },
  ],
  cnv_3: [
    {
      id: 'msg_20',
      direction: 'outbound',
      kind: 'text',
      body: 'Glad we could help. Anything else?',
      media: null,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-hours(53)),
    },
    {
      id: 'msg_21',
      direction: 'inbound',
      kind: 'text',
      body: 'Thanks!',
      media: null,
      status: 'delivered',
      failureReason: null,
      templateName: null,
      occurredAt: iso(-hours(52)),
    },
  ],
};

export function findConversation(id: string): Conversation | undefined {
  return conversationStore.find((entry) => entry.id === id);
}

/** Replaced rather than mutated, so a signal `set()` is not a no-op. */
export function replaceConversation(updated: Conversation): Conversation {
  const index = conversationStore.findIndex((entry) => entry.id === updated.id);
  if (index !== -1) {
    conversationStore[index] = updated;
  }
  return updated;
}

export function appendMessage(
  conversationId: string,
  message: Omit<ConversationMessage, 'id' | 'occurredAt'>,
): ConversationMessage {
  const created: ConversationMessage = {
    ...message,
    id: `msg_${nextMessageId++}`,
    occurredAt: new Date().toISOString(),
  };

  messageStore[conversationId] = [...(messageStore[conversationId] ?? []), created];

  const conversation = findConversation(conversationId);
  if (conversation !== undefined) {
    replaceConversation({
      ...conversation,
      lastMessagePreview: created.body === '' ? `Sent a ${created.kind}` : created.body,
      lastMessageAt: created.occurredAt,
    });
  }

  return created;
}

let nextMediaId = 900;

export function createMediaAsset(file: File, kind: string): MediaAsset {
  const id = `med_${nextMediaId++}`;
  return {
    id,
    kind: kind as MediaAsset['kind'],
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    // Object URL so the preview shows the actual upload rather than a stand-in.
    url: URL.createObjectURL(file),
    uploadedAt: new Date().toISOString(),
  };
}
