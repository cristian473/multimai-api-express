// WhatsApp webhook payload interface based on WAHA structure
export interface WhatsAppWebhookPayload {
  id: string;
  timestamp: number;
  event: string;
  session: string;
  metadata: Record<string, any>;
  me: {
    id: string;
    pushName: string;
  };
  payload: {
    id: string;
    timestamp: number;
    from: string;
    fromMe: boolean;
    source: string;
    to: string;
    body: string;
    hasMedia: boolean;
    media: {
      url: string;
      filename: string | null;
      mimetype: string;
    } | null;
    ack: number;
    ackName: string;
    vCards: any[];
    _data: {
      id: {
        fromMe: boolean;
        remote: string;
        id: string;
        _serialized: string;
      };
      viewed: boolean;
      body: string;
      type: string;
      t: number;
      clientReceivedTsMillis: number;
      notifyName: string;
      from: string;
      to: string;
      ack: number;
      invis: boolean;
      isNewMsg: boolean;
      star: boolean;
      kicNotified: boolean;
      recvFresh: boolean;
      isFromTemplate: boolean;
      pollInvalidated: boolean;
      isSentCagPollCreation: boolean;
      latestEditMsgKey: string | null;
      latestEditSenderTimestampMs: number | null;
      mentionedJidList: any[];
      groupMentions: any[];
      isEventCanceled: boolean;
      eventInvalidated: boolean;
      isVcardOverMmsDocument: boolean;
      isForwarded: boolean;
      isQuestion: boolean;
      questionReplyQuotedMessage: any | null;
      questionResponsesCount: number;
      readQuestionResponsesCount: number;
      labels: any[];
      hasReaction: boolean;
      viewMode: string;
      messageSecret: Record<string, number>;
      productHeaderImageRejected: boolean;
      lastPlaybackProgress: number;
      isDynamicReplyButtonsMsg: boolean;
      isCarouselCard: boolean;
      parentMsgId: string | null;
      callSilenceReason: string | null;
      isVideoCall: boolean;
      callDuration: number | null;
      callCreator: string | null;
      callParticipants: any | null;
      isCallLink: boolean | null;
      callLinkToken: string | null;
      isMdHistoryMsg: boolean;
      stickerSentTs: number;
      isAvatar: boolean;
      lastUpdateFromServerTs: number;
      invokedBotWid: string | null;
      bizBotType: string | null;
      botResponseTargetId: string | null;
      botPluginType: string | null;
      botPluginReferenceIndex: number | null;
      botPluginSearchProvider: string | null;
      botPluginSearchUrl: string | null;
      botPluginSearchQuery: string | null;
      botPluginMaybeParent: boolean;
      botReelPluginThumbnailCdnUrl: string | null;
      botMessageDisclaimerText: string | null;
      botMsgBodyType: string | null;
      reportingTokenInfo: {
        reportingToken: Record<string, number>;
        version: number;
        reportingTag: Record<string, number>;
      };
      requiresDirectConnection: boolean | null;
      bizContentPlaceholderType: string | null;
      hostedBizEncStateMismatch: boolean;
      senderOrRecipientAccountTypeHosted: boolean;
      placeholderCreatedWhenAccountIsHosted: boolean;
      galaxyFlowDisabled: boolean;
      groupHistoryBundleMessageKey: string | null;
      groupHistoryBundleMetadata: any | null;
      links: any[];
    };
  };
  engine: string;
  environment: {
    version: string;
    engine: string;
    tier: string;
    browser: string;
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


