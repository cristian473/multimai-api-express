import { FieldValue, VectorQuery, VectorQuerySnapshot } from "@google-cloud/firestore";
import { agentConfigDoc, customerInterestsCollection, customersCollection, propertiesCollection, userDocument } from "@/config/constants";
import { db } from "@/config/firebase";
import { AgentConfigData, AgentContextData, CustomerData, Propiedad, User } from "@/utils/db.types";
import { ChatConfig, getEmbbVector } from "@/utils/assistant/open-ai";

async function getCustomerByPhone(uid: string, phone:string): Promise<CustomerData | null> {
  try {
    const snapshot = await db.collection(customersCollection(uid)).doc(phone).get();

    return snapshot.exists ? {...snapshot.data() as CustomerData, id: snapshot.id} : null
  } catch (error: any) {
    console.error('Error fetching customers with null first_message_sent_at:', error);
    return null
  }
}

async function getUser(uid: string): Promise<User | null> {
  try {
    const snapshot = await db.doc(userDocument(uid)).get();

    return snapshot.exists ? {...snapshot.data() as User, id: snapshot.id} : null
  } catch (error: any) {
    console.error('Error fetching customers with null first_message_sent_at:', error);
    return null
  }
}

async function getProperties(uid:string) {
  const snapshot = await db.collection(propertiesCollection(uid)).get();
  return snapshot.docs.map((snp) => ({...snp.data() as Propiedad, id: snp.id})).filter((pr) => !pr.deleted_at && pr.activo === true)
}

async function updateCustomer(uid:string, phone:string, data:any) {
  try {
    await db.collection(customersCollection(uid)).doc(phone).update(data)
  } catch (error) {
    return null
  }
}

async function createCustomer(uid:string, phone:string, data:any) {
  try {
    await db.collection(customersCollection(uid)).doc(phone).set(data)
    return await getCustomerByPhone(uid, phone)
  } catch (error) {
    return null
  }
}

async function getUserConfig(uid:string) {
  try {
    const config = (await db.doc(agentConfigDoc(uid)).get()).data() as AgentConfigData
    const context = (await db.doc(agentConfigDoc(uid)).get()).data() as AgentContextData
    return { config, context }
  } catch (error) {
    return null
  }
}

type CustomerInterest = {
  interested?: boolean;
  property_type?: string | undefined;
  interest_reason?: string | undefined;
  customer_requirement?: string | undefined;
  interest_level?: number | undefined;
}

async function saveCustomerInterest(uid:string, interest: CustomerInterest, body:ChatConfig, interest_vector: number[]) {
  try {
    console.log('guardar')
    await db.collection(customerInterestsCollection(uid)).add({
      ...interest,
      client_name: body.userName,
      client_phone: body.userPhone,
      vector: FieldValue.vector(interest_vector)
    })
    console.log('guardado')
  } catch (error) {
    console.error(error)
    return null
  }
}

async function getSimilarCustomerRequestsProperties(uid:string, body:ChatConfig, requirements:string) {
  try {
    const queryVector = await getEmbbVector(requirements);

    const vectorQuery: VectorQuery = db.collection(customerInterestsCollection(uid))
      .where('client_phone', '==', body.userPhone)
      .findNearest({
        vectorField: 'vector',
        queryVector: queryVector,
        limit: 10,
        distanceMeasure: 'EUCLIDEAN',
        distanceThreshold: 0.5
    });
    
    const vectorQuerySnapshot: VectorQuerySnapshot = await vectorQuery.get();

    return vectorQuerySnapshot.docs.map(doc => doc.data() as CustomerInterest)
  } catch (error) {
    console.error(error);
    return null
  }
}

export default {
  getCustomerByPhone,
  updateCustomer,
  getSimilarCustomerRequestsProperties,
  createCustomer,
  getProperties,
  getUserConfig,
  saveCustomerInterest,
  getUser
} as const