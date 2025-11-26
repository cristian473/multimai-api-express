import { db } from '../firebase';
import { customersCollection } from '../constants';
import { CustomerData } from '../types';

export async function getCustomerByPhone(uid: string, phone: string): Promise<CustomerData | null> {
  try {
    const snapshot = await db.collection(customersCollection(uid)).doc(phone).get();
    return snapshot.exists ? { ...snapshot.data() as CustomerData, id: snapshot.id } : null;
  } catch (error: any) {
    console.error('Error fetching customer by phone:', error);
    return null;
  }
}

export async function createCustomer(uid: string, phone: string, data: Partial<CustomerData>): Promise<CustomerData | null> {
  try {
    await db.collection(customersCollection(uid)).doc(phone).set({
      ...data,
      phone,
      created_at: new Date(),
    });
    return await getCustomerByPhone(uid, phone);
  } catch (error) {
    console.error('Error creating customer:', error);
    return null;
  }
}

export async function updateCustomer(uid: string, phone: string, data: Partial<CustomerData>): Promise<void> {
  try {
    await db.collection(customersCollection(uid)).doc(phone).update({
      ...data,
      updated_at: new Date(),
    });
  } catch (error) {
    console.error('Error updating customer:', error);
  }
}
