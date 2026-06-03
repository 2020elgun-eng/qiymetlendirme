// ╔══════════════════════════════════════════════════════════════╗
// ║  Firebase konfiqurasiyası                                    ║
// ║  Firebase Console-dan aldığınız məlumatları buraya yazın     ║
// ╚══════════════════════════════════════════════════════════════╝

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth }      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDM5bXaA9C6gINGhlEaQm5n_d5RX6VRTHU",
  authDomain:        "dnqymt.firebaseapp.com",
  projectId:         "dnqymt",
  storageBucket:     "dnqymt.firebasestorage.app",
  messagingSenderId: "896662324641",
  appId:             "1:896662324641:web:9e89e07ae8da9f3961b7e0"
};

const app = initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);
