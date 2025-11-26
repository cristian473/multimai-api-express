import admin from "firebase-admin";

type FirebaseServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
}

const serviceAccount = JSON.parse(
  serviceAccountJson,
) as FirebaseServiceAccount;

// Initialize the Firebase Admin SDK with service account
// Check if the app already exists to avoid reinitialization error
let defaultApp: admin.app.App;

if (!admin.apps.length) {
  defaultApp = admin.initializeApp({
    credential: admin.credential.cert({
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
      projectId: serviceAccount.project_id,
    }),
  });
} else {
  defaultApp = admin.app();
}

// Initialize the Firebase Database
const db = admin.firestore(defaultApp);
const storage = admin.storage(defaultApp);

export { db, storage, admin };
