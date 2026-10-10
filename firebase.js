
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAiZduYBTT7RODPceJ2HBuQMi1q51-nLfA",
  authDomain: "financinho-casal.firebaseapp.com",
  projectId: "financinho-casal",
  storageBucket: "financinho-casal.firebasestorage.app",
  messagingSenderId: "1078437946949",
  appId: "1:1078437946949:web:3b5017d6c9b2df627d652c",
  measurementId: "G-9L15116CMR"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
