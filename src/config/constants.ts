export const REPORTAR_AL_NUMERO = 'REPORTAR_AL_NUMERO'
export const USER_ID = 'USER_ID'


export const customersCollection = (uid:string) => `users/${uid}/customers`
export const userDocument = (uid:string) => `users/${uid}`
export const customerInterestsCollection = (uid:string) => `users/${uid}/customers_interests`
export const chatsCollection = (uid:string) => `users/${uid}/chats`
export const agentConfigDoc = (uid:string) => `users/${uid}/agent/config`
export const agentContextDoc = (uid:string) => `users/${uid}/agent/context`
export const propertiesCollection = (uid:string) => `users/${uid}/properties`
export const propertyDoc = (uid:string, property_id:string) => `users/${uid}/properties/${property_id}`
export const propertyVisits = (uid:string) => `users/${uid}/property_visits`
export const propertyVisitDoc = (uid:string, property_visit_id:string) => `users/${uid}/property_visits/${property_visit_id}`
export const customersInteredtedCollection = (uid:string) => `users/${uid}/customers_interested`