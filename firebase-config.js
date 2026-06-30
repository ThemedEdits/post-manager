// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2RIMLzsgSIdX8JwD8F1FBFUd0cZf3QFY",
  authDomain: "post-manager-1.firebaseapp.com",
  projectId: "post-manager-1",
  storageBucket: "post-manager-1.firebasestorage.app",
  messagingSenderId: "919632825597",
  appId: "1:919632825597:web:79e9a4450cce301a418294"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Keep the user signed in on this device until they explicitly sign out.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Auth persistence error:", err);
});
