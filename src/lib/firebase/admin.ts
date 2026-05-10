import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const privateKey = rawKey?.replace(/\\n/g, "\n")?.trim();

  const missing: string[] = [];
  if (!projectId) missing.push("FIREBASE_ADMIN_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_ADMIN_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_ADMIN_PRIVATE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Firebase Admin env not loaded: ${missing.join(", ")}. Add them to .env.local next to package.json (same file as your WhatsApp vars). Use your Firebase service account JSON: project_id → FIREBASE_ADMIN_PROJECT_ID, client_email → FIREBASE_ADMIN_CLIENT_EMAIL, private_key → FIREBASE_ADMIN_PRIVATE_KEY. Save, then restart npm run dev.`
    );
  }

  try {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } catch {
    throw new Error(
      "FIREBASE_ADMIN_CREDENTIALS_INVALID: check FIREBASE_ADMIN_PRIVATE_KEY (quoted one line, \\n for newlines) matches your service account JSON."
    );
  }
}

export async function verifyFirebaseIdToken(idToken: string) {
  return getAuth(getAdminApp()).verifyIdToken(idToken);
}
