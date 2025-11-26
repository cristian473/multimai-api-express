// Database types for Firestore documents

export type User = {
  id: string;
  email: string;
  name: string;
  reports_number?: string;
  created_at?: any;
  updated_at?: any;
};

export type CustomerData = {
  id?: string;
  name: string;
  phone: string;
  chatId?: string;
  created_at?: any;
  updated_at?: any;
};

export type AgentConfigData = {
  isActive: boolean;
  agentName:string;
  contactList?: { name: string; phone: string }[];
  session?: string;
  reportsNumber?: string;
};

// export type AgentContextData = {
//   businessName: string;
//   description?: string;
//   address?: string;
//   phone?: string;
//   email?: string;
//   website?: string;
// };

export type AgentBusinessData = {
  businessContext: string;
  businessName?: string;
  updatedAt?: any;
};

export type Propiedad = {
  id?: string;
  nombre: string;
  descripcion: string;
  precio: number;
  precio_moneda?: string;
  tipo_operacion: "Compra" | "Alquiler";
  tipo_propiedad: "Casa" | "Departamento" | "Terreno";
  ubicacion: string;
  direccion?: string;
  ambientes?: number;
  dormitorios?: number;
  banos?: number;
  superficie?: number;
  superficie_cubierta?: number;
  imagenes?: string[];
  activo: boolean;
  deleted_at?: any;
  created_at?: any;
  updated_at?: any;
};

export type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: any;
  chat_message_id?: string;
  isContext?: boolean; // Flag to mark context messages (tool executions, internal logs)
};

export type CustomerInterest = {
  interested?: boolean;
  property_type?: string;
  interest_reason?: string;
  customer_requirement?: string;
  interest_level?: number;
  client_name?: string;
  client_phone?: string;
  vector?: any;
};

export type PropertyVisit = {
  id?: string;
  customer_phone: string;
  customer_name: string;
  property_id: string;
  visit_date: string;
  visit_time?: string;
  status: "scheduled" | "completed" | "cancelled";
  notes?: string;
  created_at?: any;
  updated_at?: any;
};

export type RAGDocument = {
  id?: string;
  keyIdentifiers: string[];
  embeddings: number[];
  metadata?: Record<string, any>;
  docRef?: string | null;
  propositions?: string[];
  originalText?: string;
  created_at?: any;
  updated_at?: any;
};
