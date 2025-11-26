import { ChatConfig } from "@/lib/utils/validation";
import { getHistory } from "@/lib/utils/history";
import {
  getCustomerByPhone,
  createCustomer,
} from "@/lib/db/repositories/customers";
import { saveConversationMessage } from "@/lib/db/repositories/conversations";
import { getUserConfig } from "@/lib/db/repositories/users";
import { getTenantByPhone } from "@/lib/db/repositories/tenants";

// Import guideline system
import { GuidelineAgent } from "../guideline-agent";
import { tenantGuidelines } from "../guidelines/tenant-guidelines";
import { realEstateGlossary } from "../glossary/real-estate-terms";
import type { ConversationContext } from "../types/context";

// Import tenant tools
import {
  receivePaymentReceiptTool,
  getPaymentRemindersTool,
  getTenantHelpTool,
} from "../tools/tenant-tools";

import { AI_CONFIG } from "../config";
import { getUserMessage } from "@/lib/utils/message-queue";

export interface TenantWorkflowResult {
  message: string;
  needsHelp?: boolean;
  question?: string;
  metadata?: {
    selectedGuidelines: string[];
    executedAgents: number;
    errors?: string;
  };
}

/**
 * Workflow específico para inquilinos (tenants)
 */
export async function tenantWorkflow(
  uid: string,
  session: string,
  body: ChatConfig
): Promise<TenantWorkflowResult | null> {
  const {
    userPhone,
    message,
    messages,
    userName,
    assistantMessage,
    hasMedia,
    media,
  } = body;

  // Si no hay mensaje, ni mensajes, ni assistantMessage, ni media, no hay nada que procesar
  if (
    !message &&
    (!messages || messages.length === 0) &&
    !assistantMessage &&
    !hasMedia
  ) {
    console.log(
      "[TenantWorkflow] No message, messages array, assistantMessage, or media provided"
    );
    return null;
  }

  console.log("\n========== TENANT WORKFLOW START ==========");
  console.log(`Tenant: ${userName} (${userPhone})`);
  console.log(
    `Message: ${message || (messages ? `${messages.length} messages` : "(activating agent)")}`
  );
  console.log(`Has media: ${hasMedia || false}`);
  console.log(`AssistantMessage: ${assistantMessage || "none"}`);

  // Verificar que el usuario es realmente un tenant
  const tenant = await getTenantByPhone(uid, userPhone);
  if (!tenant) {
    console.log("[TenantWorkflow] User is not a tenant:", userPhone);
    return {
      message:
        "No encontré tu registro como inquilino. Por favor contacta con la administración.",
    };
  }

  console.log("[TenantWorkflow] Tenant verified:", tenant.id);

  // Obtener o crear el cliente
  let customer = await getCustomerByPhone(uid, userPhone);
  if (!customer) {
    customer = await createCustomer(uid, userPhone, {
      name: userName,
      phone: userPhone,
    });
  }

  // Obtener configuración del usuario
  const userConfig = await getUserConfig(uid);

  if (!userConfig) {
    console.log("[TenantWorkflow] User config not found");
    return null;
  }

  const businessName = userConfig.business.businessName || "Inmobiliaria";

  // Si hay assistantMessage, guardarlo primero como mensaje del asistente
  if (assistantMessage) {
    console.log("[TenantWorkflow] Saving assistant message from owner response");
    await saveConversationMessage(uid, userPhone, "assistant", assistantMessage);
  }

  // Si hay array de mensajes, guardar cada uno individualmente con su ID
  if (messages && messages.length > 0) {
    console.log(
      `[TenantWorkflow] Saving ${messages.length} individual messages with IDs`
    );
    for (const msg of messages) {
      await saveConversationMessage(
        uid,
        userPhone,
        "user",
        getUserMessage(msg.body, msg.replyTo ?? null, null, userName),
        msg.id
      );
    }
  }
  // Si hay mensaje único (compatibilidad), guardarlo
  else if (message) {
    await saveConversationMessage(uid, userPhone, "user", message);
  }

  // Get conversation history
  const history = await getHistory(uid, userPhone);

  // Build conversational context
  const conversationContext: ConversationContext = {
    messages: history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
    userId: uid,
    sessionId: session,
  };

  console.log(`[TenantWorkflow] History loaded: ${history.length} messages`);

  // Create guideline agent for tenants
  const agent = new GuidelineAgent(tenantGuidelines, realEstateGlossary, {
    streaming: AI_CONFIG?.ENABLE_STREAMING ?? false,
    enableCritique: AI_CONFIG?.ENABLE_CRITIQUE ?? false,
    maxSteps: AI_CONFIG?.MAX_STEPS ?? 3,
    guidelineThreshold: AI_CONFIG?.GUIDELINE_THRESHOLD ?? 0.7,
  });

  // Register tenant-specific tools
  agent.registerTool(
    "receive_payment_receipt",
    "Procesar comprobante de pago enviado por el inquilino",
    receivePaymentReceiptTool(uid, userPhone, userName),
    ["tenant_receive_payment_receipt"]
  );

  agent.registerTool(
    "get_payment_reminders",
    "Obtener información sobre recordatorios de pago del inquilino",
    getPaymentRemindersTool(uid, userPhone),
    ["tenant_payment_inquiry"]
  );

  agent.registerTool(
    "get_help",
    "Solicitar ayuda de la administración o propietario",
    getTenantHelpTool(uid, userPhone, userName),
    ["tenant_get_help", "tenant_maintenance_request", "tenant_contract_inquiry"]
  );

  // Register context variables
  agent.registerVariable(
    "fecha_actual",
    () => {
      const now = new Date();
      const days = [
        "domingo",
        "lunes",
        "martes",
        "miércoles",
        "jueves",
        "viernes",
        "sábado",
      ];
      const months = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
      ];

      const dayName = days[now.getDay()];
      const monthName = months[now.getMonth()];
      const dateStr = `${dayName}, ${now.getDate()} de ${monthName} de ${now.getFullYear()}`;
      const isoDate = now.toISOString().split("T")[0];

      return `Hoy es ${dateStr} (${isoDate})`;
    },
    "Fecha actual en formato legible para el agente"
  );

  agent.registerVariable(
    "nombre_usuario",
    () => "El inquilino se llama: " + userName
  );

  agent.registerVariable(
    "nombre_negocio",
    () => "El agente trabaja para la inmobiliaria: " + businessName
  );

  agent.registerVariable(
    "tenant_id",
    () => `ID del inquilino: ${tenant.id}`
  );

  console.log("[TenantWorkflow] Registered context variables and tools");

  // Determinar el mensaje a procesar
  let messageToProcess: string;

  if (hasMedia && media) {
    // Si el mensaje contiene un archivo, procesar como comprobante de pago
    console.log("[TenantWorkflow] Processing media file:", media.mimetype);

    // Verificar que sea un tipo de archivo válido (imagen o PDF)
    const validMimetypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    if (validMimetypes.includes(media.mimetype)) {
      // Mensaje especial para indicar que hay un archivo adjunto
      const userMessage = message || messages?.[0]?.body || "Comprobante de pago";
      messageToProcess = `[ARCHIVO_ADJUNTO] ${userMessage}\n\nEl usuario envió un archivo: ${media.filename || "archivo"} (${media.mimetype})\nURL: ${media.url}\n\nPor favor, procesa este archivo como un comprobante de pago usando la herramienta receive_payment_receipt.`;
    } else {
      console.warn("[TenantWorkflow] Unsupported media type:", media.mimetype);
      messageToProcess =
        message ||
        messages?.[0]?.body ||
        "El tipo de archivo enviado no es compatible. Por favor envía una imagen (JPG, PNG) o un PDF.";
    }
  } else if (messages && messages.length > 0) {
    // Si hay array de mensajes, combinarlos para el procesamiento del agente
    messageToProcess = messages.map((m) => m.body).join(" ");
    console.log(`[TenantWorkflow] Processing ${messages.length} combined messages`);
  } else if (message) {
    // Si hay mensaje único, usarlo
    messageToProcess = message;
    console.log("[TenantWorkflow] Processing single user message");
  } else if (assistantMessage) {
    // Si solo hay assistantMessage (sin mensaje del usuario), usar mensaje especial
    messageToProcess = "[AGENT_ACTIVATION_AFTER_OWNER_RESPONSE]";
    console.log("[TenantWorkflow] Processing agent activation");
  } else {
    // No debería llegar aquí por las validaciones anteriores
    messageToProcess = "";
  }

  // Process message with guideline agent
  const result = await agent.process(
    messageToProcess,
    conversationContext,
    3 // maxSteps
  );

  console.log(
    "[TenantWorkflow] Guidelines activas:",
    result.state.activeGuidelines.map((g) => g.guideline.id)
  );
  console.log(
    "[TenantWorkflow] Execution trace:",
    JSON.stringify(result.executionTrace, null, 2)
  );

  // Save assistant response to history
  await saveConversationMessage(uid, userPhone, "assistant", result.response);

  return {
    message: result.response,
    metadata: {
      selectedGuidelines: result.state.activeGuidelines.map((g) => g.guideline.id),
      executedAgents: result.executionTrace.filter(
        (t) => t.step === "tool_execution"
      ).length,
    },
  };
}
