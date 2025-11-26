import { ChatConfig } from '../../utils/validation';
import { getMultimaiHistory } from '../../utils/history';
import { runRequestsAgent } from '../agents/requests';
import { getCustomerByPhone, createCustomer } from '../../db/repositories/customers';
import { saveMultimaiMessage } from '../../db/repositories/conversations';
import { getUserConfig } from '../../db/repositories/users';
import { getUserByReportNumber } from '../../db/repositories/users';
import { identifyUserType } from '../utils/user-identifier';
import { tenantWorkflow } from './tenant-workflow';

export interface MultimaiWorkflowResult {
  message: string;
}

export async function multimaiWorkflow(body: ChatConfig): Promise<MultimaiWorkflowResult | null> {
  const { userPhone, message, userName, messageReferencesTo, messageReferencesToProduct } = body;

  if (!userPhone) {
    return {
      message: 'No hay destinatario para el mensaje.'
    };
  }

  // Obtener usuario por número de reporte
  const user = await getUserByReportNumber(userPhone);
  
  if (!user) {
    return null;
  }

  const uid = user.id;

  // === ROUTING: Identificar si el usuario es tenant o prospect ===
  console.log('[MultimaiWorkflow] Identifying user type...');
  const userType = await identifyUserType(uid, userPhone);
  console.log('[MultimaiWorkflow] User type:', userType);

  // Si es un tenant, usar el workflow especializado para inquilinos
  if (userType === 'tenant') {
    console.log('[MultimaiWorkflow] Routing to TENANT workflow');
    const session = process.env.MULTIMAI_WS_SESSION || '';
    const tenantResult = await tenantWorkflow(uid, session, body);

    if (!tenantResult) {
      return null;
    }

    return {
      message: tenantResult.message
    };
  }

  // Si es un prospect, continuar con el flujo normal (Multimai requests agent)
  console.log('[MultimaiWorkflow] Routing to PROSPECT workflow (requests agent)');
console.log({uid})
  const userConfig = await getUserConfig(uid);

  console.log('userConfig', userConfig);

  if (!userConfig) {
    console.log('User config not found');
    return null;
  }

  if (userConfig.config.isActive === false) {
    console.log('User config is not active');
    return null;
  }

  if (userConfig.config.contactList?.some(contact => contact.phone === userPhone)) {
    console.log('User is in contact list');
    return null;
  }

  let customer = await getCustomerByPhone(uid, userPhone);
  console.log('customer', customer, {uid, userPhone});
  if (!customer) {
    console.log('Customer not found, creating new customer');
    customer = await createCustomer(uid, userPhone, { name: userName, phone: userPhone });
    console.log('Customer created', customer);
  }

  console.log(`Multimai chat function called with userPhone: ${userPhone}, message: ${message}, userName: ${userName}`);

  // Get conversation history
  let conversationHistory = await getMultimaiHistory(userPhone);

  console.log('Executing Multimai assistant...');

  // Preparar mensajes para el agente (últimos 20 mensajes)
  const systemMessages = conversationHistory.filter(msg => msg.role === 'system');
  const conversationMessages = conversationHistory.filter(msg => msg.role !== 'system');

  const messages = conversationMessages.slice(-20).map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    chat_message_id: msg.chat_message_id
  }));

  messages.push({
    role: 'user',
    content: message ?? '(no message provided)',
    chat_message_id: undefined
  });

  console.log('[MultimaiWorkflow] Messages:', messages);

  const businessName = userConfig.business.businessName || "Inmobiliaria";

  // Ejecutar el agente de requests (Multimai)
  const aiResponse = await runRequestsAgent(messages, businessName, message || '');

  // Guardar mensajes en Firestore
  if (message) {
    await saveMultimaiMessage(userPhone, 'user', message);
  }
  await saveMultimaiMessage(userPhone, 'assistant', aiResponse);

  console.log('Multimai assistant response received:', aiResponse);

  return {
    message: aiResponse
  };
}
