# Registro de Presencialidad — web

Web simple (HTML/CSS/JS, sin build ni instalación de nada) para que cada
persona marque sus días de presencialidad y remoto, con Racionamiento y
Movilidad calculados solos. Los datos se guardan en Firebase (Firestore) y
se actualizan en vivo para todos.

## 1) Crear el proyecto de Firebase

1. Entrá a https://console.firebase.google.com y creá un proyecto nuevo (es gratis para este uso).
2. Dentro del proyecto: **Compilación → Firestore Database → Crear base de datos**. Elegí "modo producción" y la región más cercana.
3. En **Reglas** de Firestore, pegá el contenido de `firestore.rules` (incluido en esta carpeta) y publicá.
4. En el ícono de engranaje → **Configuración del proyecto**, bajá hasta "Tus apps" → ícono `</>` (Web) → registrá una app (no hace falta Firebase Hosting).
5. Firebase te va a mostrar un objeto `firebaseConfig`. Copialo entero.

## 2) Configurar la web

Abrí `firebase-config.js` y:
- Pegá el `firebaseConfig` que copiaste, reemplazando el que está de ejemplo.
- Cambiá `ADMIN_PASSCODE` por el código que van a usar vos (o los admins) para entrar a la pestaña **Admin** y agregar personas / editar racionamiento y movilidad.

No hace falta instalar nada ni correr comandos: son 3 archivos estáticos (`index.html`, `style.css`, `app.js`) más `firebase-config.js`.

## 3) Publicar en GitHub Pages

1. Creá un repositorio en GitHub y subí todos los archivos de esta carpeta (`index.html`, `style.css`, `app.js`, `firebase-config.js`).
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/root`. Guardar.
3. GitHub te da una URL tipo `https://tu-usuario.github.io/tu-repo/`. Ese es el link que compartís con tus compañeros.

## 4) Primer uso

1. Entrá a la web, andá a la pestaña **Admin**, poné el código de administrador.
2. Agregá a las personas (nombre y apellido) — aparecen automáticamente en las grillas de Presencialidad y Remoto.
3. En la pestaña **Presencialidad**, cargá Racionamiento y Movilidad del mes (solo visible/editable en modo admin) y guardá.
4. Cada persona entra al link, elige el mes/año arriba y va tocando los días en su fila para marcar presencial o remoto. Se guarda al toque, sin botón de guardar.
5. La pestaña **Resumen anual** muestra los totales de cada persona mes a mes.

## Cómo funciona el cambio de año

No hace falta hacer nada especial: el selector de Año/Mes permite elegir
cualquier año dentro del rango configurado (se puede ampliar editando
`yearStart` en `app.js`). Cada mes/año guarda sus propios datos por
separado, así que enero de un año no pisa enero del año siguiente.

## Sobre la seguridad (léelo)

Elegiste "sin login, acceso libre con el link" por simplicidad. Esto tiene
una limitación real: la configuración de Firebase queda visible en el
código fuente de la página, así que técnicamente cualquiera que la
consiga podría leer o escribir datos directamente en Firestore, no solo
quien tenga el link. El código de administrador solo protege los botones
de la interfaz, no la base de datos en sí (ver el comentario en
`firestore.rules`).

Para un grupo de confianza (compañeros de oficina) esto suele ser un
riesgo aceptable. Si más adelante querés cerrarlo mejor, el paso natural
es agregar **Firebase Authentication** (por ejemplo "Acceso anónimo" o
Google) y cambiar las reglas de Firestore a `if request.auth != null` —
avisame si en algún momento querés que lo sume.

## Estructura de datos (Firestore)

- `personas/{id}`: `{ nombre, orden }`
- `marcas/{personaId_anio_mes_tipo}`: `{ personaId, anio, mes, tipo: "presencial"|"remoto", dias: [1,5,12,...] }`
- `valoresMensuales/{anio_mes}`: `{ anio, mes, racionamiento, movilidad }`
