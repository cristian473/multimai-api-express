import { Timestamp } from "firebase-admin/firestore";

/**
 * Tenant (Inquilino) - Representa un inquilino que alquila una propiedad
 */
export interface Tenant {
  id?: string;
  nombre: string;
  telefono: string[]; // Array de teléfonos del inquilino
  email?: string;
  propiedad_id: string; // ID de la propiedad que alquila
  contrato_inicio: Date;
  contrato_fin?: Date;
  activo: boolean;
  created_at: Date;
  updated_at?: Date;
}

/**
 * Payment Reminder - Recordatorio de pago para un inquilino
 */
export interface PaymentReminder {
  id?: string;
  tenant_id: string;
  payment_types: string[]; // Tipos de pago a recordar (ej: "Alquiler", "Luz", "Agua")
  custom_payment_types?: string[]; // Tipos personalizados agregados
  frequency: 'weekly' | 'monthly' | 'bimonthly' | 'custom'; // Frecuencia del recordatorio
  custom_frequency_days?: number; // Para frecuencia custom (solo si frequency es 'custom')
  start_date: Date; // Empieza a recordar desde esta fecha
  active: boolean;
  created_at: Date;
  updated_at?: Date;
}

/**
 * Payment Receipt - Comprobante de pago recibido del inquilino
 */
export interface PaymentReceipt {
  id?: string;
  tenant_id: string;
  reminder_id: string;
  urlFile: string; // URL del archivo en Google Drive o storage
  tag: string; // Tag del tipo de pago (ej: "Alquiler mensual")
  summary: string; // Resumen del pago (ej: "Pago mes de enero 2025")
  payment_date?: Date; // Fecha del pago extraída del comprobante
  payment_time?: string; // Hora del pago extraída del comprobante
  payment_type?: string; // Tipo de pago detectado
  amount?: number; // Monto del pago (opcional)
  receivedAt: Timestamp; // Timestamp de cuándo se recibió el comprobante
  extracted_data?: {
    // Datos extraídos por el AI
    raw_text?: string;
    confidence?: number;
    [key: string]: any;
  };
  verified: boolean; // Si fue verificado por un humano
  created_at: Date;
}

/**
 * Extracted Payment Data - Datos extraídos de un comprobante de pago
 */
export interface ExtractedPaymentData {
  paymentDate: string; // Formato: YYYY-MM-DD
  paymentTime?: string; // Formato: HH:MM
  paymentType: string; // Tipo de pago detectado
  amount?: number;
  description?: string;
  confidence: number; // 0-1
  raw_text?: string;
}
