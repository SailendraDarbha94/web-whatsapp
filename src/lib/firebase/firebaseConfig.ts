import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

function readFirebaseOptions(): FirebaseOptions {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!apiKey?.trim() || !authDomain?.trim() || !projectId?.trim()) {
    throw new Error(
      "Firebase client env is incomplete. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID (and optional bucket/sender/app/measurement) in .env.local."
    );
  }

  const opts: FirebaseOptions = {
    apiKey,
    authDomain,
    projectId,
  };

  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId =
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim();

  if (storageBucket) opts.storageBucket = storageBucket;
  if (messagingSenderId) opts.messagingSenderId = messagingSenderId;
  if (appId) opts.appId = appId;
  if (measurementId) opts.measurementId = measurementId;

  return opts;
}

let appInstance: FirebaseApp | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    appInstance =
      getApps().length === 0 ? initializeApp(readFirebaseOptions()) : getApp();
  }
  return appInstance;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}
