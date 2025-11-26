import { generateObject } from "ai";
import { z } from "zod";
import { getOpenRouterModel } from "../openrouter";
import type { ExtractedPaymentData } from "@/lib/types/tenant";

/**
 * Extrae información de un comprobante de pago usando Google Gemini 2.5 Flash Lite con vision
 */
export async function extractPaymentReceiptData(
  imageUrl: string,
  mimetype: string
): Promise<ExtractedPaymentData> {
  try {
    console.log('[extractPaymentReceiptData] Processing receipt with Gemini Vision');
    console.log('[extractPaymentReceiptData] Image URL:', imageUrl);
    console.log('[extractPaymentReceiptData] Mimetype:', mimetype);

    // Usar Gemini 2.5 Flash Lite para vision
    const model = getOpenRouterModel('google/gemini-2.5-flash-lite');

    const result = await generateObject({
      model,
      schema: z.object({
        paymentDate: z.string().describe('Fecha del pago en formato YYYY-MM-DD'),
        paymentTime: z.string().optional().describe('Hora del pago en formato HH:MM (si está disponible)'),
        paymentType: z.string().describe('Tipo de pago detectado (ej: Alquiler, Luz, Agua, Gas, Expensas, etc.)'),
        amount: z.number().optional().describe('Monto del pago si está visible'),
        description: z.string().optional().describe('Descripción adicional del pago'),
        confidence: z.number().min(0).max(1).describe('Nivel de confianza en la extracción (0-1)'),
        raw_text: z.string().optional().describe('Texto completo extraído del comprobante'),
      }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Eres un experto en análisis de comprobantes de pago argentinos.

Analiza la imagen del comprobante y extrae la siguiente información:

1. **Fecha del pago**: En formato YYYY-MM-DD. Busca en el comprobante la fecha de la transacción.
2. **Hora del pago**: En formato HH:MM si está disponible.
3. **Tipo de pago**: Identifica qué tipo de servicio o concepto se está pagando. Los tipos comunes incluyen:
   - Alquiler / Alquiler mensual
   - Luz / Electricidad / EDESUR / EDENOR
   - Agua / Aguas Argentinas / AySA
   - Gas / Metrogas / Gas Natural
   - Expensas
   - Internet / Cable / Telefonía
   - Impuestos / ABL / ARBA
   - Otros servicios

4. **Monto**: El valor pagado en pesos argentinos (sin el signo $)
5. **Descripción**: Cualquier información adicional relevante
6. **Nivel de confianza**: Qué tan seguro estás de la extracción (0 = muy inseguro, 1 = muy seguro)

IMPORTANTE:
- Si el comprobante está en español argentino, identifica correctamente los conceptos locales
- Si no puedes determinar algún campo con certeza, indica un nivel de confianza bajo
- Intenta ser lo más preciso posible con las fechas y montos
- Si el tipo de pago no es claro, intenta inferirlo del contexto (empresa, concepto, etc.)

Analiza la imagen y proporciona los datos extraídos en formato JSON.`
            },
            {
              type: 'image',
              image: imageUrl
            }
          ]
        }
      ]
    });

    console.log('[extractPaymentReceiptData] Extraction successful');
    console.log('[extractPaymentReceiptData] Extracted data:', result.object);

    return result.object as ExtractedPaymentData;
  } catch (error) {
    console.error('[extractPaymentReceiptData] Error extracting data:', error);

    // Retornar datos por defecto en caso de error
    return {
      paymentDate: new Date().toISOString().split('T')[0],
      paymentType: 'Pago no identificado',
      confidence: 0,
      description: 'Error al procesar el comprobante. Por favor, verifica manualmente.'
    };
  }
}

/**
 * Valida que la fecha extraída sea razonable (no muy antigua ni en el futuro)
 */
export function validatePaymentDate(dateStr: string): boolean {
  try {
    const paymentDate = new Date(dateStr);
    const now = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const oneMonthAhead = new Date();
    oneMonthAhead.setMonth(now.getMonth() + 1);

    // La fecha debe estar entre 3 meses atrás y 1 mes adelante
    return paymentDate >= threeMonthsAgo && paymentDate <= oneMonthAhead;
  } catch {
    return false;
  }
}

/**
 * Genera un resumen legible del comprobante de pago
 */
export function generatePaymentSummary(data: ExtractedPaymentData): string {
  const date = new Date(data.paymentDate);
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  let summary = `Pago de ${data.paymentType}`;

  if (data.amount) {
    summary += ` - $${data.amount.toLocaleString('es-AR')}`;
  }

  summary += ` - ${month} ${year}`;

  if (data.paymentTime) {
    summary += ` a las ${data.paymentTime}`;
  }

  return summary;
}
