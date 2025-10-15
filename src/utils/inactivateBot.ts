import { WhatsAppWebhookPayload } from "@/entities/ws/ws.dto";

export function hasToReply({payload, session, event}: WhatsAppWebhookPayload) {
  console.log('event', event);
  if(event !== 'message.any') {
    return false;
  }

  const isHumanContinuing = payload?.fromMe ?? false
  const conversationKey = `${session}:${payload.from}`
  // si cae aca habla es el dueño respondiendo
  if (isHumanContinuing) {
      setTemporallyBlock(conversationKey, Number(2) * 60000)
      //TODO: appendToChatHistory(currentThread, [{ role: 'assistant', content: message }])
      return false;
  }

  // si cae aca es un humano respondiendole a un humano
  if (isTalkingWithHuman(conversationKey)) {
      //TODO: // appendToChatHistory(currentThread, [{ role: 'user', content: message }])
      return false;
  }
  return true;
}

const timers:any = {}

// Function to start the inactivity timer for a user
const setTemporallyBlock = (key:string, ms: number) => {
    const currentTimeOut = timers[key]
    if(currentTimeOut && typeof currentTimeOut === 'number') {
        clearTimeout(currentTimeOut)
    }

    //bloqueado indefinidamente
    if(ms < 0) {
        timers[key] = true
    }

    timers[key] = setTimeout(() => {
      delete timers[key]
    }, ms);
}

const isTalkingWithHuman = (from:string) => {
    return Boolean(timers[from])
}

