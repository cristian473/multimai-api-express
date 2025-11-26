// WhatsApp webhook payload interface based on WAHA NOWEB structure
export interface WhatsAppWebhookPayload {
  id: string;
  timestamp: number;
  event: string;
  session: string;
  metadata: {
    uid: string;
    email?: string;
    name?: string;
    // Allow extra metadata fields for forward compatibility
    [key: string]: unknown;
  };
  me: {
    id: string;
    pushName: string;
    lid?: string;
  };
  payload: {
    id: string;
    timestamp: number;
    from: string;
    fromMe: boolean;
    source: string;
    // WAHA NOWEB payload does not always include "to", keep it optional
    to?: string;
    body: string;
    hasMedia: boolean;
    media: {
      url: string;
      filename?: string | null;
      mimetype?: string;
    } | null;
    ack: number;
    ackName: string;
    location: unknown | null;
    vCards: unknown[] | null;
    replyTo?: {
      body: string;
    } | null;
    _data: {
      key: Record<string, unknown>;
      messageTimestamp: number;
      pushName: string;
      broadcast: boolean;
      message: Record<string, unknown>;
      status: number;
      // Keep legacy field for backward compatibility where available
      notifyName?: string;
      [key: string]: unknown;
    };
  };
  engine: string;
  environment: {
    version: string;
    engine: string;
    tier?: string;
    browser: string | null;
    [key: string]: unknown;
  };
}

// Tipos de mensajes soportados
export type MessageType = 'text' | 'file' | 'image';

// Payload para mensaje de texto
export interface TextPayload {
  content: string;
  reply_to?: string;
}

// Payload para archivo o imagen
export interface FilePayload {
  mimetype: string;
  filename: string;
  url: string;
  reply_to?: string;
  caption?: string;
}

// Mensaje individual
export interface MessageItem {
  type: MessageType;
  payload: TextPayload | FilePayload;
}

// Send message request DTO (texto simple - backward compatibility)
export interface SendMessageDto {
  chatId: string;
  text: string;
  session: string;
}

// Send messages batch request DTO (array de mensajes)
export interface SendMessagesDto {
  chatId: string;
  messages: MessageItem[];
  session: string;
}

// Send image request DTO
export interface SendImageDto {
  chatId: string;
  file: {
    mimetype: string;
    filename: string;
    url: string;
  };
  reply_to?: string | null;
  caption?: string;
  session: string;
}

// Send file request DTO
export interface SendFileDto {
  chatId: string;
  file: {
    mimetype: string;
    filename: string;
    url: string;
  };
  reply_to?: string | null;
  caption?: string;
  session: string;
}

// Send message response DTO
export interface SendMessageResponseDto {
  success: boolean;
  messageId?: string;
  error?: string;
}

// WAHA API response interface
export interface WahaApiResponse {
  id: string;
  success: boolean;
  message?: string;
}



// Activate agent request DTO
export interface ActivateAgentRequest {
  uid: string;
  session: string;
  userPhone: string;
  userName: string;
  assistantMessage: string;
  replyToMessageId?: string;
  reminderId?: string;
}
