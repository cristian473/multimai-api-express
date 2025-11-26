import { db } from "@/lib/db/firebase";

/**
 * Identifica si un usuario es un inquilino (tenant) o un interesado (prospect)
 * basándose en si su número de teléfono está registrado en la colección de tenants
 */
export async function identifyUserType(
  uid: string,
  userPhone: string
): Promise<'tenant' | 'prospect'> {
  try {
    console.log(`[identifyUserType] Checking user type for ${userPhone}`);

    // Buscar en la colección de tenants donde el array telefono contenga el userPhone
    const tenantsSnapshot = await db
      .collection(`users/${uid}/tenants`)
      .where('telefono', 'array-contains', userPhone)
      .where('activo', '==', true) // Solo tenants activos
      .limit(1)
      .get();

    if (!tenantsSnapshot.empty) {
      console.log(`[identifyUserType] User ${userPhone} is a TENANT`);
      return 'tenant';
    }

    console.log(`[identifyUserType] User ${userPhone} is a PROSPECT`);
    return 'prospect';
  } catch (error) {
    console.error('[identifyUserType] Error identifying user type:', error);
    // En caso de error, asumir prospect (comportamiento por defecto)
    return 'prospect';
  }
}

/**
 * Obtiene los datos del tenant si existe
 */
export async function getTenantData(
  uid: string,
  userPhone: string
): Promise<{ id: string; data: any } | null> {
  try {
    const tenantsSnapshot = await db
      .collection(`users/${uid}/tenants`)
      .where('telefono', 'array-contains', userPhone)
      .where('activo', '==', true)
      .limit(1)
      .get();

    if (tenantsSnapshot.empty) {
      return null;
    }

    const tenantDoc = tenantsSnapshot.docs[0];
    return {
      id: tenantDoc.id,
      data: tenantDoc.data()
    };
  } catch (error) {
    console.error('[getTenantData] Error getting tenant data:', error);
    return null;
  }
}
