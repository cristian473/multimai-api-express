import { ChatConfig, gpt } from "./open-ai";
import db from "@/utils/db";
import aiHistoryResume from "./ai-history-resume";
import aiRouter, { AgentType } from "./ai-router";
import requestContext from "@/utils/request-context";
import validations from "@/utils/validations";

// idea de workflow:
// 1. validar que el usuario exista
// 2. generar el mensaje
// 3. guardar el mensaje en la base de datos
// 4. retornar el mensaje

const agentTypeIdFieldDictionary = {
  [AgentType.GENERAL_QUERIES]: 'general_assistant_id',
  [AgentType.PROPERTY_QUERIES]: 'property_queries_assistant_id',
  [AgentType.VISIT_SCHEDULING]: 'visit_scheduling_assistant_id' 
}

export async function aiWorkflow(uid: string, body: ChatConfig) {
  const aiHasToResponse = await validations.validateAiHasToResponse(uid, body)

  if(!aiHasToResponse) {
    return null
  }
  
  const customer = await db.getCustomerByPhone(uid, body.userPhone)
  const userConfig = await db.getUserConfig(uid)

  if(!userConfig){
    return null
  }

  console.log('customer')
  console.log(customer)

  if(!customer?.assistant_thread_id) {
    return gpt(uid, body, userConfig.config.general_assistant_id)
  }

  const lastMessages = await aiHistoryResume.getLastMessages(customer.assistant_thread_id, body.message)

  console.log('lastMessages')
  console.log(lastMessages)

  // await aiInterest.analyzeInterest(uid, body, lastMessages)
  
  // return {
  //   threadId: customer.assistant_thread_id,
  //   message: 'Ok esperame, en un momento estoy con vos.'
  // }
  const assistantToTakeConversation = await aiRouter.routeMessageToAgent(lastMessages)

  console.log('assistantToTakeConversation')
  console.log(assistantToTakeConversation)

  if(aiRouter.needsHumanIntervention(assistantToTakeConversation)) {
    requestContext.set({
      needsHelp: true,
      question: body.message
    })
    return {
      threadId: customer?.assistant_thread_id,
      message: 'Ok esperame, en un momento estoy con vos.'
    }
  }

  // @ts-ignore
  const assistantId = userConfig.config[agentTypeIdFieldDictionary[assistantToTakeConversation.agent_type]]

  return gpt(uid, body, assistantId)
}