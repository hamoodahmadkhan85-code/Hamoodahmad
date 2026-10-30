import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

  apiKey: "AIzaSyD16ZOXNMJ-t9lvgxLYFynquIpJW2JnHEQ",
  authDomain: "hamoodludo-5ee97.firebaseapp.com",
  databaseURL: "https://hamoodludo-5ee97-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hamoodludo-5ee97",
  storageBucket: "hamoodludo-5ee97.appspot.com",
  messagingSenderId: "898460746155",
  appId: "1:898460746155:web:8d731b6aca6c9c59m312ee"

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
