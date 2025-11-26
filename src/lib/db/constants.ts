// Firestore collection and document path helpers

export const REPORTAR_AL_NUMERO = 'REPORTAR_AL_NUMERO';
export const USER_ID = 'USER_ID';

// User and customer collections
export const customersCollection = (uid: string) => `users/${uid}/customers`;
export const userDocument = (uid: string) => `users/${uid}`;
export const customerInterestsCollection = (uid: string) => `users/${uid}/customers_interests`;
export const chatsCollection = (uid: string) => `users/${uid}/chats`;

// Agent configuration
export const agentConfigDoc = (uid: string) => `users/${uid}/agent/config`;
export const agentContextDoc = (uid: string) => `users/${uid}/agent/context`;
export const agentBusinessDoc = (uid: string) => `users/${uid}/agent/business`;

// Properties
export const propertiesCollection = (uid: string) => `users/${uid}/properties`;
export const propertyDoc = (uid: string, property_id: string) => `users/${uid}/properties/${property_id}`;
export const propertyVisits = (uid: string) => `users/${uid}/property_visits`;
export const propertyVisitDoc = (uid: string, property_visit_id: string) => `users/${uid}/property_visits/${property_visit_id}`;

// Customer interests
export const customersInteredtedCollection = (uid: string) => `users/${uid}/customers_interested`;

// Conversations and messages
export const conversationsCollection = (uid: string, phoneNumber: string) => `users/${uid}/customers/${phoneNumber}/conversations`;
export const conversationDoc = (uid: string, phoneNumber: string, date: string) => `users/${uid}/customers/${phoneNumber}/conversations/${date}`;
export const messagesCollection = (uid: string, phoneNumber: string, date: string) => `users/${uid}/customers/${phoneNumber}/conversations/${date}/messages`;

// Multimai agent collections
export const multimaiConversationsCollection = (phoneNumber: string) => `agents/multimai/conversations/${phoneNumber}`;
export const multimaiMessagesCollection = (phoneNumber: string) => `agents/multimai/conversations/${phoneNumber}/messages`;

// RAG collection
export const ragCollection = () => 'rag';
