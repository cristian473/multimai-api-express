import { DateTime } from 'luxon'
import { queryProperties } from './search-properties';
import { db } from "../config/firebase";
import dbUtils from './db'
import { customersInteredtedCollection, propertyDoc, propertyVisitDoc, propertyVisits } from '../config/constants';
import { Timestamp } from 'firebase/firestore';
import { Propiedad } from './db.types';
import { ChatConfig } from './assistant/open-ai';
import axios from 'axios';

const getVisitsCollection = (uid: string) => db.collection(propertyVisits(uid));

interface Property {
  id: string;
  nombre: string;
  ubicacion: string;
}

interface PropertyVisit {
  id: string;
  propertyId: string;
  property: Property;
  date: Timestamp;
  startTime: string;
  endTime: string;
  maxInterested: number;
  currentInterested: number;
  status: 'programada' | 'cancelada' | 'completada';
  notes?: string;
}

interface VisitSchedule {
  property_visit_id: string;
}

interface NotificationRequest {
  property_visit_id: string
}

interface ToolResponse {
  success: boolean;
  error?: string;
  visits?: { property_visit_id: string, visit_date: string, note?: string}[];
  nota?: string
}

async function get_availability_to_visit_the_property(
  uid: string,
  params: { property_id:string }
): Promise<ToolResponse> {
  try {
    const { property_id } = params
    const visitsSnapshot = await getVisitsCollection(uid)
      .where('propertyId', '==', property_id)
      .where('status', '==', 'programada')
      .get();

    if (visitsSnapshot.empty) {
      return {
        success: true,
        visits: []
      };
    }

    const visits = visitsSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    })) as PropertyVisit[];

    // Filter visits from current time onwards
    const now = DateTime.now().setZone('America/Buenos_Aires');
    const futureVisits = visits.filter(visit => {
      const visitDate = DateTime.fromJSDate(visit.date.toDate());
      const visitDateTime = visitDate.set({
        hour: parseInt(visit.startTime.split(':')[0]),
        minute: parseInt(visit.startTime.split(':')[1])
      });
      return visitDateTime >= now;
    });

    return {
      success: true,
      visits: futureVisits.map((v) => {
        const date = DateTime.fromJSDate(v.date.toDate()).setLocale('es').toFormat("cccc dd/MM")
        return {
          property_visit_id: v.id,
          visit_date: `El día ${date}\n Empieza a las ${v.startTime} y finaliza a las ${v.endTime}`,
          note: v.notes || undefined
        }
      })
    };

  } catch (error) {
    console.error('Error fetching visits:', error);
    return {
      success: false,
      error: `Error al obtener visitas: ${String(error)}`
    };
  }
}

async function schedule_property_visit(
  uid: string,
  body: ChatConfig,
  params: VisitSchedule
): Promise<ToolResponse> {
  try {
    const { property_visit_id } = params;

    const visitRef = getVisitsCollection(uid).doc(property_visit_id);
    const visitDoc = await visitRef.get();

    if (!visitDoc.exists) {
      return {
        success: false,
        error: "La visita programada no existe"
      };
    }

    const visitData = visitDoc.data() as PropertyVisit;
    if (visitData.currentInterested >= visitData.maxInterested) {
      return {
        success: false,
        error: "La visita ha alcanzado el cupo máximo"
      };
    }

    const visitorData = {
      clientName: body.userName,
      clientPhone: body.userPhone,
      createdAt: new Date(),
      status: 'confirmado'
    };

    await db.runTransaction(async (transaction) => {
      // Referencia al documento que deseas actualizar
      const visitDoc = await transaction.get(visitRef);
    
      // Extraer datos actuales del documento
      const visitData = visitDoc.data();
    
      // Crear el array `visitors` si no existe
      const visitors = visitData?.visitors || [];
    
      // Agregar los nuevos datos al array
      visitors.push(visitorData);
    
      // Actualizar el documento con los datos nuevos
      transaction.update(visitRef, {
        currentInterested: (visitData?.currentInterested || 0) + 1, // Asegúrate de manejar valores nulos
        visitors: visitors
      });
    });
    

    return { success: true, nota: visitData.notes ?? undefined };

  } catch (error) {
    console.error('Error scheduling visit:', error);
    return {
      success: false,
      error: `Error al agendar la visita: ${String(error)}`
    };
  }
}

async function schedule_client_for_next_visit(
  uid: string,
  body: ChatConfig,
  params: NotificationRequest
): Promise<ToolResponse> {
  try {
    const { property_visit_id } = params;

    const visitDocRef = await db.doc(propertyVisitDoc(uid, property_visit_id)).get()

    if(!visitDocRef.exists) {
      return {
        success: false,
        error: "La visita programada no existe"
      };
    }
    const visit = visitDocRef.data() as PropertyVisit

    const propertyDocRef = await db.doc(propertyDoc(uid, visit.propertyId)).get()

    if(!propertyDocRef.exists) {
      return {
        success: false,
        error: "La propiedad de la visita no existe"
      };
    }

    const property = propertyDocRef.data() as Propiedad

    await db.collection(customersInteredtedCollection(uid)).add({
      clientName: body.userName,
      clientPhone: body.userPhone,
      createdAt: new Date(),
      property,
      wantsReceiveAlerts: true
    })

    return { success: true };
  } catch (error) {
    console.error('Error scheduling notification:', error);
    return {
      success: false,
      error: `Error al registrar notificación: ${String(error)}`
    };
  }
}

function formatPropertyAsText(property: Propiedad) {
  const { nombre, descripcion, precio, precio_moneda, tipo_propiedad, tipo_operacion, ubicacion, ubicacion_url, ubicacion_simple, contrato, dormitorios, baños, requisitos, superficie, fotos, id, extra_fields} = property;
  const operacion = tipo_operacion === "Alquiler" ? "por mes" : "";
  const superficieInfo = tipo_operacion === 'Venta' ? `*Superficie:* ${superficie}.\n` : ''
  const requisitosInfo = tipo_operacion === 'Alquiler' ? `*Requisitos:* ${requisitos}.\n` : ''
  const fotosText = fotos?.map(f => `Foto de ${f.label}: ${f.url}`)?.join('\n') ?? '(No se encontraron fotos)'
  const extraFieldsInfo = extra_fields?.map((field) => `*${field.name}*: ${field.value}`) ?? ''

  const address = ubicacion_simple || ubicacion
  const addressUrl = `${ubicacion_url}\n` || ''
  return `
    ${fotosText??''}\n\n
    ${tipo_propiedad} "${nombre}":\n
    ${descripcion}.\n
    - *Precio:* ${precio} ${precio_moneda} ${operacion}.\n
    ${superficieInfo}
    *Ubicación:* ${address}.\n
    ${addressUrl}
    *Contrato:* ${contrato}.\n
    *Dormitorios:* ${dormitorios}.\n
    *Baños:* ${baños}.\n
    ${requisitosInfo}\n
    ${extraFieldsInfo}\n
    property_id: ${id}
    ---\n
  `;
}

export interface SearchPropertiesParams {
  id?: string;
  ubicacion?: string;
  precio?: string[];
  tipo_operacion: string,
  tipo_propiedad?: string,
  ambientes?: number;
  otro?: string;
}

// Función para buscar propiedades en Firebase según criterios
async function search_properties(uid:string, params: SearchPropertiesParams) {
  const {result, additionalText} = await queryProperties(uid, params)
  const textResult = result.map(formatPropertyAsText)
  return [additionalText, textResult].filter(Boolean).join('\n\n');
}

async function get_help( 
  uid: string,
  body: ChatConfig,
  { question }: { question: string }, 
) {
  const userConfig = await dbUtils.getUserConfig(uid)

  if(!userConfig) {
    return 'Ok esperame, ya lo consulto y te digo'
  }
  let userBotPort = userConfig.config.port

  if(process.env.ENVIROMENT === 'development') {
    userBotPort = Number(process.env.BOT_BASE_PORT);
  }
  
  const baseUrl = `${process.env.BOT_BASE_URL}:${userBotPort}/v1`

  const headers = {
    ['ps-token']: process.env.BOT_PS_TOKEN
  }

  const customerPhone = body.userPhone;
  const reportsNumber = userConfig.config.reports_number

  //envio un mensaje al usuario avisando que un cliente necesita ayuda
  await axios.post(`${baseUrl}/messages`, {
    message: `Hola!, el número ${customerPhone} necesita ayuda con la pregunta: \n *${question}*`,
    number: reportsNumber,
  }, { headers });

  //pauso ese cliente por un dia hasta que el usuario le responda
  await axios.post(`${baseUrl}/pause-contact`, {
    number: customerPhone,
    time: 24 * 60000
  }, { headers });

  return 'Ok esperame, ya lo consulto y te digo'
}

export default {
  search_properties,
  get_availability_to_visit_the_property,
  schedule_property_visit,
  schedule_client_for_next_visit,
  get_help
} as const;