// ============================================================
// CONFIGURACION DE FIREBASE
// ============================================================
// 1. Anda a https://console.firebase.google.com y creá un proyecto (gratis).
// 2. Dentro del proyecto: "Agregar app" -> icono de web (</>) -> registrá la app.
// 3. Firebase te va a mostrar un objeto "firebaseConfig" como el de abajo.
//    Copialo entero y pegalo reemplazando el de aca.
// 4. En el menu lateral entrá a "Firestore Database" -> "Crear base de datos"
//    (modo produccion, la ubicacion no importa mucho, elegi la mas cercana).
// 5. Andá a la pestaña "Reglas" de Firestore y pegá las reglas que estan en
//    el archivo firestore.rules de este proyecto. Publicá los cambios.
// ============================================================

export const firebaseConfig = {
 apiKey: "AIzaSyDy1J5nLfbNwziWuBcOfBPq3nWOb_us5UE",
  authDomain: "racionamientos.firebaseapp.com",
  projectId: "racionamientos",
  storageBucket: "racionamientos.firebasestorage.app",
  messagingSenderId: "96280832493",
  appId: "1:96280832493:web:e778b43fcda97f18199fe4",
  measurementId: "G-YGGSHVGXQ6"
};

// Código de administrador: quien lo ingrese en la pestaña "Admin" puede
// agregar/quitar personas y editar racionamiento/movilidad.
// Cambialo por el que quieras antes de publicar el sitio.
export const ADMIN_PASSCODE = "Redes2026";
