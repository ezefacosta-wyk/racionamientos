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
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "TU_APP_ID"
};

// Código de administrador: quien lo ingrese en la pestaña "Admin" puede
// agregar/quitar personas y editar racionamiento/movilidad.
// Cambialo por el que quieras antes de publicar el sitio.
export const ADMIN_PASSCODE = "cambiar-este-codigo";
