import { ChatConfig } from "./assistant/open-ai";
import db from "./db";


async function validateAiHasToResponse(uid: string, body:ChatConfig) {
  const { userPhone, message } = body

  if(!message || !userPhone){
    return {
      threadId: null,
      message: 'No hay mensaje'
    }
  }

  const userConfig = await db.getUserConfig(uid)
  
  if(!userConfig) {
    return null
  }

  if(userConfig.config.isActive === false) {
    return null
  }

  if(userConfig.config.contactList?.includes(userPhone)) {
    return null
  }

  return true
}

export default {
  validateAiHasToResponse,
} as const