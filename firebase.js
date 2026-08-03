import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC37Nbtw1HgnuTWOc_D1QUULBxnbrYWA7o",
  authDomain: "oioijo.firebaseapp.com",
  projectId: "oioijo",
  storageBucket: "oioijo.firebasestorage.app",
  messagingSenderId: "1023010014506",
  appId: "1:1023010014506:web:915d8c1160a48baf1c4a53",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { addDoc, collection, db, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc };
