import { db } from '../firebase';
import { userDocument, agentConfigDoc, agentContextDoc, agentBusinessDoc } from '../constants';
import { User, AgentConfigData, AgentBusinessData } from '../types';

export async function getUser(uid: string): Promise<User | null> {
  try {
    const snapshot = await db.doc(userDocument(uid)).get();
    return snapshot.exists ? { ...snapshot.data() as User, id: snapshot.id } : null;
  } catch (error: any) {
    console.error('Error fetching user:', error);
    return null;
  }
}

export async function getUserByReportNumber(reportNumber: string): Promise<User | null> {
  try {
    const usersSnapshot = await db.collection('users')
      .where('reportsNumber', '==', reportNumber)
      .get();

    if (usersSnapshot.empty) {
      return null;
    }

    const userDoc = usersSnapshot.docs[0];
    return { ...userDoc.data() as User, id: userDoc.id };
  } catch (error: any) {
    console.error('Error fetching user by report number:', error);
    return null;
  }
}

export async function getUserConfig(uid: string): Promise<{ config: AgentConfigData; business: AgentBusinessData } | null> {
  try {
    const configSnapshot = await db.doc(agentConfigDoc(uid)).get();
    const businessSnapshot = await db.doc(agentBusinessDoc(uid)).get();

    if (!configSnapshot.exists || !businessSnapshot.exists) {
      return null;
    }

    const config = configSnapshot.data() as AgentConfigData;
    const business = businessSnapshot.data() as AgentBusinessData;
    return { config, business };
  } catch (error) {
    console.error('Error fetching user config:', error);
    return null;
  }
}

export async function updateUserAgentConfig(uid: string, data: Partial<AgentConfigData>): Promise<void> {
  try {
    await db.doc(agentConfigDoc(uid)).update(data);
  } catch (error) {
    console.error('Error updating user agent config:', error);
  }
}
