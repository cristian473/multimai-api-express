import { GeoPoint } from "firebase/firestore";

export interface CustomerData {
  id:string;
  name: string;
  phone: string;
  shows_interest: boolean | null;
  assistant_thread_id?: string;
}

export interface MessageData {
  id: string,
  sender: 'Cliente' | 'Vendedor',
  message: string
  messageReferencesTo?: string,
  timestamp: Date,
  whatsappUserData: {
    name: string,
    phone: string
  }
}

interface Coordenadas {
  lat: number;
  lng: number;
  geoPoint: GeoPoint
}

interface Foto {
  label: string,
  url: string
}

export interface Propiedad {
  id: string;
  id_propiedad: string;
  nombre: string;
  propiedad: string;
  deleted_at: null | undefined | Date,
  tipo_propiedad: string;
  ubicacion: string;
  ubicacion_url: string;
  ubicacion_simple: string;
  coordenadas: Coordenadas;
  precio: number;
  precio_moneda: string;
  contrato?: string; // Puede ser opcional si puede estar vacío
  tipo_operacion: string;
  requisitos?: string; // Puede ser opcional si puede estar vacío
  superficie: string;
  dormitorios: number;
  baños: number;
  descripcion: string;
  fotos?: Foto[];
  activo: boolean;
  created_at: Date
  extra_fields: {name:string, value: string}[]
}

export type AgentConfigData = {
  isActive:boolean,
  contactList: string[],
  general_assistant_id: string
  property_queries_assistant_id: string
  visit_scheduling_assistant_id: string
  port: number
  reports_number: string
}

export type AgentContextData = {
  businessInfo: string,
  businessName: string
}

export type User = {
  id: string,
  port: number
  name: string
}
