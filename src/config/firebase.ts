import admin from 'firebase-admin';

//@ts-ignore
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

// Initialize the Firebase Admin SDK with service account
const defaultApp = admin.initializeApp({
  credential: admin.credential.cert({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    projectId: serviceAccount.project_id
  }),
});

// Initialize the Firebase Database
const db = admin.firestore(defaultApp);
const storage = admin.storage(defaultApp)

db.settings({
  ignoreUndefinedProperties: true
})

export { db, storage }