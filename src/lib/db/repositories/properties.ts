import { db } from '../firebase';
import { propertiesCollection } from '../constants';
import { Propiedad } from '../types';

export async function getProperties(uid: string): Promise<Propiedad[]> {
  try {
    const snapshot = await db.collection(propertiesCollection(uid)).get();
    return snapshot.docs
      .map((snp) => ({ ...snp.data() as Propiedad, id: snp.id }))
      .filter((pr) => !pr.deleted_at && pr.activo === true);
  } catch (error) {
    console.error('Error fetching properties:', error);
    return [];
  }
}

export async function getPropertyById(uid: string, propertyId: string): Promise<Propiedad | null> {
  try {
    if(!uid || !propertyId) {
      return null;
    }
    const snapshot = await db.collection(propertiesCollection(uid)).doc(propertyId).get();
    if (!snapshot.exists) {
      return null;
    }
    const property = { ...snapshot.data() as Propiedad, id: snapshot.id };
    if (property.deleted_at || !property.activo) {
      return null;
    }
    return property;
  } catch (error) {
    console.error('Error fetching property by ID:', error);
    return null;
  }
}
