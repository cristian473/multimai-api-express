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

export async function shouldProcessWorkflow(uid: string, userPhone: string): Promise<boolean> {
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
  console.log('userConfig.config.contactList', userConfig.config.contactList);

  // If enableFor list exists and is not empty, only allow those numbers
  const enabledForList = userConfig.config.enabledFor;

  console.log('enabledForList', enabledForList);
  if (enabledForList && enabledForList.length > 0) {
    const isAllowed = enabledForList.some(contact => contact.phone === userPhone);
    if (!isAllowed) {
      console.log('[Validation] User not in enabledFor whitelist');
      return false;
    }
  }

  return true;
}

export async function validateAiHasToResponse(uid: string, body: ChatConfig): Promise<boolean> {
  const { userPhone, message, messages } = body;

  // Validar que haya mensaje o mensajes
  if (!userPhone || (!message && (!messages || messages.length === 0))) {
    return false;
  }

  const isValid = await shouldProcessWorkflow(uid, userPhone);
  if (!isValid) {
    return false;
  }

  return true;
}
