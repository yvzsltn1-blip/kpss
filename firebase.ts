import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase Konsolundan alacağın ayarlar buraya gelecek:
const firebaseConfig = {
 apiKey: "AIzaSyDPoku6IOW5lX7MmU0Wd2qCW8e7eX7EbPc",
  authDomain: "kpss-5d60c.firebaseapp.com",
  projectId: "kpss-5d60c",
  storageBucket: "kpss-5d60c.firebasestorage.app",
  messagingSenderId: "355313475174",
  appId: "1:355313475174:web:940ef55f501dfac4e0d7a7"
};

// Firebase'i başlat
const app = initializeApp(firebaseConfig);
// Veritabanı servisini dışa aktar
export const db = getFirestore(app);
export const auth = getAuth(app);
