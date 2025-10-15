import OpenAI from "openai";
import db from "@/utils/db";
import handleOpenAiTools from "@/utils/handle-openai-tools";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ChatConfig = {
  userPhone: string,
  message: string,
  userName: string,
  messageReferencesTo?: string,
  messageReferencesToProduct?: {
    title: string,
    description: string
  }
}

export async function gpt(uid: string, body: ChatConfig, assistantId: string) {
  const {userPhone, message, userName, messageReferencesTo, messageReferencesToProduct } = body

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

  let customer = await db.getCustomerByPhone(uid, userPhone)
  if(!customer){
    customer = await db.createCustomer(uid, userPhone, { name: userName, phone: userPhone })
  }
  let threadId = customer?.assistant_thread_id

  console.log(`Chat function called with userPhone: ${userPhone}, message: ${message}, userName: ${userName}`);

  // Buscar el thread del usuario en Supabase
  if (!threadId) {
    // Crear un nuevo thread si no existe
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create()
    threadId = thread.id
    console.log(`New thread created with ID: ${threadId}`);
    await db.updateCustomer(uid, userPhone, { assistant_thread_id: threadId })
  }

  console.log('Checking for active runs...');
  const runs = await openai.beta.threads.runs.list(threadId);
  const activeRun = runs.data.find(run => ['in_progress', 'queued', 'requires_action'].includes(run.status));

  if (activeRun) {
    console.log(`Found active run: ${activeRun.id}. Cancelling...`);
    await openai.beta.threads.runs.cancel(threadId, activeRun.id);
    console.log('Active run cancelled.');
  }

  const userMessage = 
    messageReferencesTo 
      ? `(hace referencia al mensaje: "${messageReferencesTo}") ${message}` 
      : messageReferencesToProduct
        ? `(hace referencia al producto: "Titulo: ${messageReferencesToProduct?.title}, Descripción: ${messageReferencesToProduct?.description}") ${userName}: ${message}`
        : `${userName}: ${message}`

  // Add user message to the thread
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: userMessage
  });

  // Ejecutar el asistente
  console.log('Executing assistant...');
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
  })

  // Esperar a que el asistente complete la ejecución
  console.log('Waiting for assistant to complete execution...');
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
  while (runStatus.status !== 'completed') {
    console.log(`Current run status: ${runStatus.status}`);
    await new Promise(resolve => setTimeout(resolve, 1000))
    runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)

    if (runStatus.status === 'requires_action') {
      console.log('Run requires action, handling tool calls...');
      const toolCalls = runStatus.required_action?.submit_tool_outputs.tool_calls
      if(!toolCalls) break;
      const toolOutputs = await handleOpenAiTools(uid, toolCalls, body)
      await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
        tool_outputs: toolOutputs,
      })
    }
  }

  // Obtener la respuesta del asistente
  console.log('Retrieving assistant response...');
  const messages = await openai.beta.threads.messages.list(threadId)
  const assistantMessage = messages.data[0].content[0]

  if (assistantMessage.type === 'text') {
    console.log('Assistant response received:', assistantMessage.text.value);
    return {
      message: assistantMessage.text.value,
      threadId
    }
  }

  console.log('No valid response received from assistant.');
  return {
    message: 'No se pudo obtener una respuesta válida del asistente.',
    threadId
  }

}

export async function getEmbbVector(text: string) {
  const embedding = await openai.embeddings.create({
    input: text, 
    model: 'text-embedding-3-small'
  })
  return embedding.data[0].embedding
}