import { db } from "../firebase";

/**
 * User document structure from users/${uid}/agent/documents/items
 */
export interface UserDocument {
  id: string;
  label: string;
  fileName: string;
  fileType: 'pdf' | 'text';
  ragId: string;
  ragKeys?: string[];
  uploadedAt?: Date;
}

/**
 * Get all context documents uploaded by a user
 * These documents are used for RAG-based context search
 * 
 * @param uid - User ID
 * @returns Array of user documents with their labels and RAG IDs
 */
export async function getUserContextDocuments(uid: string): Promise<UserDocument[]> {
  try {
    console.log(`[UserDocuments] Fetching context documents for user: ${uid}`);
    
    const docsRef = db.collection(`users/${uid}/agent/documents/items`);
    const querySnapshot = await docsRef.get();

    if (querySnapshot.empty) {
      console.log(`[UserDocuments] No documents found for user: ${uid}`);
      return [];
    }

    const documents: UserDocument[] = [];
    
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      documents.push({
        id: docSnap.id,
        label: data.label || 'Sin etiqueta',
        fileName: data.fileName || '',
        fileType: data.fileType || 'text',
        ragId: data.ragId || '',
        ragKeys: data.ragKeys || [uid, 'agent-context', docSnap.id],
        uploadedAt: data.uploadedAt?.toDate(),
      });
    });

    // Sort by upload date, newest first
    documents.sort((a, b) => {
      if (!a.uploadedAt || !b.uploadedAt) return 0;
      return b.uploadedAt.getTime() - a.uploadedAt.getTime();
    });

    console.log(`[UserDocuments] Found ${documents.length} documents for user: ${uid}`);
    return documents;
  } catch (error) {
    console.error(`[UserDocuments] Error fetching documents for user ${uid}:`, error);
    return [];
  }
}

/**
 * Get document labels as a formatted string for guideline condition
 * @param documents - Array of user documents
 * @returns Formatted string of document labels
 */
export function getDocumentLabelsString(documents: UserDocument[]): string {
  if (documents.length === 0) return '';
  return documents.map(d => d.label).join(', ');
}

/**
 * Get RAG keys for all user documents
 * @param uid - User ID
 * @param documents - Array of user documents
 * @returns Array of RAG keys for searching
 */
export function getDocumentRAGKeys(uid: string, documents: UserDocument[]): string[] {
  const keys = new Set<string>();
  keys.add(uid);
  keys.add('agent-context');
  
  documents.forEach(doc => {
    keys.add(doc.id);
    if (doc.ragKeys) {
      doc.ragKeys.forEach(key => keys.add(key));
    }
  });
  
  return Array.from(keys);
}


