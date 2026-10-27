import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCvozIql_X82kTVTVzacRHSvjTt4sSWE_I',
  authDomain: 'hamood-22e77.firebaseapp.com',
  databaseURL: 'https://hamood-22e77-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'hamood-22e77',
  storageBucket: 'hamood-22e77.firebasestorage.app',
  messagingSenderId: '606263590191',
  appId: '1:606263590191:web:06e9239767b47378d775da',
};

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);

let app: FirebaseApp | null = null;
let db: Database | null = null;

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  } catch {
    app = null;
    db = null;
  }
}

export { db, isConfigured };
