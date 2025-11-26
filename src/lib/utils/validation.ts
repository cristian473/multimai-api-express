import { getUserConfig } from '../db/repositories/users';

export interface ChatConfig {
  userPhone: string;
  message?: string; // Mensaje único (para compatibilidad)
  messages?: Array<{ // Array de mensajes con IDs (nuevo formato)
    id: string;
    body: string;
    timestamp: number;
    replyTo?: string | null;
  }>;
  assistantMessage?: string;
  senderName?: string;
  userName: string;
  messageReferencesTo?: string;
  messageReferencesToProduct?: {
    title: string;
    description: string;
  };
  // Media information (for file attachments like payment receipts)
  hasMedia?: boolean;
  media?: {
    url: string;
    filename: string | null;
    mimetype: string;
  } | null;
}

export async function validateAiHasToResponse(uid: string, body: ChatConfig): Promise<boolean> {
  const { userPhone, message, messages } = body;

  // Validar que haya mensaje o mensajes
  if (!userPhone || (!message && (!messages || messages.length === 0))) {
    return false;
  }
  
  console.log({uid})

  const userConfig = await getUserConfig(uid);

  console.log('userConfig', userConfig);

  if (!userConfig) {
    return false;
  }

  if (userConfig.config.isActive === false) {
    return false;
  }

  if (userConfig.config.contactList?.some(contact => contact.phone === userPhone)) {
    return false;
  }

  return true;
}
