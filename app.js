/*
  app.js — Álbum de Tadeo
  
  Este archivo es el cerebro de la aplicación.
  Se divide en estas secciones:
  
  1. Configuración y constantes
  2. Referencias al DOM
  3. Estado de la aplicación (variables en memoria)
  4. Inicialización al cargar la página
  5. Lógica de subida de foto
  6. Sistema de stickers (drag & drop sobre la foto)
  7. Renderizado del feed desde Firebase
  8. Likes
  9. Comentarios
  10. Descarga de foto con stickers "quemados"
  11. Eliminar foto
  12. Modal de zoom
  13. Utilidades
*/


// ═══════════════════════════════════════════════════
// 1. CONFIGURACIÓN Y CONSTANTES
// ═══════════════════════════════════════════════════

/*
  Sin Firebase Storage — las imágenes se comprimen en el cliente
  y se guardan como base64 directamente en Realtime Database.
  Mismo patrón que el álbum de Minecraft. Sin CORS, sin costos.
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref as dbRef,
  push,
  set,
  onChildAdded,
  onChildRemoved,
  runTransaction,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─────────────────────────────────────────────────────────────
// ⚠️  REEMPLAZÁ ESTOS VALORES CON LOS DE TU PROYECTO FIREBASE
//     Firebase Console → tu proyecto → ⚙️ Configuración → Tu app
// ─────────────────────────────────────────────────────────────
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD-eFqalBS9kx_MBQqBIfJKOTODVzMEunI",
  authDomain: "diego-minecraft.firebaseapp.com",
  databaseURL:"https://diego-minecraft-default-rtdb.firebaseio.com/",
  projectId: "diego-minecraft",
  storageBucket: "diego-minecraft.firebasestorage.app",
  messagingSenderId: "474866264166",
  appId: "1:474866264166:web:c8cd54b39d7aa441fe25a7",
  measurementId: "G-SJC1EK5GYB"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getDatabase(firebaseApp);
// Sin Storage — todo va a Realtime Database como base64 comprimido.

/*
  ─────────────────────────────────────────────────
  STICKERS: Editá este array con tus archivos PNG.
  Ponelos en una carpeta /stickers/ al mismo nivel que index.html.
  Los nombres deben coincidir exactamente con los archivos.
  ─────────────────────────────────────────────────
*/
const STICKERS = [
  { id: "s1", src: "assets/tabodi-st.png",      alt: "tabodi" },
  { id: "s2", src: "assets/tabodi-st2.png", alt: "torta y tabodi" },
  { id: "s3", src: "assets/oso-st.png",   alt: "oso" },
  { id: "s4", src: "assets/globo-st.png",     alt: "globo" },
  { id: "s5", src: "assets/tadeo-st.png",     alt: "cartel" },
];
/*
  Array de objetos en lugar de array de strings.
  Guardamos el alt para accesibilidad y el id para identificarlos.
  Cuando cargués tus PNGs, reemplazá solo los valores de src.
*/

// Nombre del álbum en la base de datos Firebase
// Si en el futuro hacés otro álbum, cambiás solo esta constante.
const ALBUM_NAME = "album-tadeo";


// ═══════════════════════════════════════════════════
// 2. REFERENCIAS AL DOM
// ═══════════════════════════════════════════════════

/*
  Capturamos todas las referencias al DOM en un solo lugar.
  
  BENEFICIO: Si el HTML cambia (ej: renombrás un id), lo actualizás
  en UN solo lugar en lugar de buscar en todo el JS.
  
  Agrupamos por funcionalidad para que sea fácil de encontrar.
*/

// Subida de foto
const fileInput        = document.getElementById("fileInput");
const btnCamera        = document.getElementById("btnCamera");
const previewContainer = document.getElementById("previewContainer");
const previewWrapper   = document.getElementById("previewWrapper");
const previewImg       = document.getElementById("previewImg");
const stickersOnPhoto  = document.getElementById("stickersOnPhoto");
const stickerGrid      = document.getElementById("stickerGrid");
const btnClearStickers = document.getElementById("btnClearStickers");
const authorInput      = document.getElementById("authorInput");
const btnConfirm       = document.getElementById("btnConfirm");
const btnCancel        = document.getElementById("btnCancel");
const uploadProgress   = document.getElementById("uploadProgress");
const progressFill     = document.getElementById("progressFill");
const progressText     = document.getElementById("progressText");

// Feed
const photoFeed  = document.getElementById("photoFeed");
const emptyState = document.getElementById("emptyState");

// Modal de comentarios — accedemos con getElementById() dentro de cada función
// para evitar referencias rancias al abrir/cerrar el modal repetidas veces.
// (ver openCommentsModal / closeCommentsModal)

// Modal de zoom
const zoomModal    = document.getElementById("zoomModal");
const zoomImg      = document.getElementById("zoomImg");
const btnCloseZoom = document.getElementById("btnCloseZoom");


// ═══════════════════════════════════════════════════
// 3. ESTADO DE LA APLICACIÓN
// ═══════════════════════════════════════════════════

/*
  Estado centralizado: toda la "memoria" de la app vive acá.
  
  Separamos el estado en dos:
  - selectedFile: el archivo de imagen que el usuario acaba de elegir
  - currentPhotoId: la foto que está "activa" en el modal de comentarios
  - activeDrag: datos del sticker que se está arrastrando en este momento
  - photoCount: para saber si el feed tiene fotos (ocultar empty state)
*/
let selectedFile    = null;  // File object del input de archivo
let currentPhotoId  = null;  // ID de Firebase de la foto abierta en el modal
let activeDrag      = null;  // { el: HTMLElement, startX, startY, initLeft, initTop }
let photoCount      = 0;     // Cantidad de fotos en el feed


// ═══════════════════════════════════════════════════
// 4. INICIALIZACIÓN
// ═══════════════════════════════════════════════════

// db y storage ya están inicializados arriba como constantes del módulo.
// DOMContentLoaded garantiza que el HTML esté listo antes de conectar eventos.
// Los scripts type="module" ya son diferidos, pero lo dejamos explícito por claridad.
document.addEventListener("DOMContentLoaded", () => {
  initStickerPicker();
  initUpload(db);
  initFeed(db);
  initZoomModal();
});


// ═══════════════════════════════════════════════════
// 5. LÓGICA DE SUBIDA DE FOTO
// ═══════════════════════════════════════════════════

function initUpload(db) {
  btnCamera.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Por favor seleccioná una imagen.");
      return;
    }
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (event) => {
      previewImg.src = event.target.result;
      previewContainer.hidden = false;
      btnCamera.hidden = true;
      stickersOnPhoto.innerHTML = "";
    };
    reader.readAsDataURL(file);
    fileInput.value = "";
  });

  btnCancel.addEventListener("click", resetUploadUI);

  btnConfirm.addEventListener("click", () => {
    if (!selectedFile) return;
    uploadPhoto(db);
  });
}

function resetUploadUI() {
  selectedFile = null;
  previewImg.src = "";
  previewContainer.hidden = true;
  uploadProgress.hidden = true;
  btnCamera.hidden = false;
  authorInput.value = "";
  stickersOnPhoto.innerHTML = "";
  progressFill.style.width = "0%";
  progressText.textContent = "Comprimiendo...";
  fileInput.value = "";
}

function compressImage(file, maxWidth = 1200, quality = 0.75) {
  /*
    Comprime la imagen y quema los stickers encima en un canvas.
    
    PROCESO:
    1. Dibujamos la foto original escalada al tamaño final
    2. Por cada sticker en el DOM, calculamos su posición y tamaño
       relativos al canvas y lo dibujamos encima
    3. Exportamos todo junto como base64 JPEG
    
    Así lo que se guarda en Firebase ya es la imagen final
    con los stickers incorporados — no elementos flotantes del DOM.
  */
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      // Tamaño final del canvas (foto escalada)
      const ratio  = Math.min(1, maxWidth / img.width);
      const width  = Math.round(img.width  * ratio);
      const height = Math.round(img.height * ratio);

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      // 1. Dibujamos la foto de fondo
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      // 2. Dibujamos cada sticker encima
      const stickerEls = stickersOnPhoto.querySelectorAll(".sticker-on-photo");
      /*
        stickersOnPhoto es el contenedor de stickers del preview.
        Iteramos cada sticker que el usuario colocó.
      */

      const previewRect = previewWrapper.getBoundingClientRect();
      /*
        Necesitamos el tamaño VISUAL del contenedor de preview
        para calcular la escala entre pantalla y canvas.
        
        El canvas puede ser 1200px de ancho pero el preview
        en pantalla puede ser 350px — la escala es 1200/350 ≈ 3.4.
        Multiplicamos la posición y tamaño de cada sticker por esa escala.
      */

      const scaleX = width  / previewRect.width;
      const scaleY = height / previewRect.height;

      for (const stickerEl of stickerEls) {
        const stickerImg = stickerEl.querySelector("img");
        if (!stickerImg) continue;

        // Posición del sticker relativa al contenedor de preview
        const stickerRect = stickerEl.getBoundingClientRect();
        const leftPx = stickerRect.left - previewRect.left;
        const topPx  = stickerRect.top  - previewRect.top;

        // Tamaño visual del sticker en pantalla
        const stickerW = stickerRect.width;
        const stickerH = stickerRect.height;

        // Escalamos al tamaño del canvas
        const canvasX = leftPx  * scaleX;
        const canvasY = topPx   * scaleY;
        const canvasW = stickerW * scaleX;
        const canvasH = stickerH * scaleY;

        // Cargamos la imagen del sticker y la dibujamos en el canvas
        await new Promise((res) => {
          const si = new Image();
          si.onload = () => {
            ctx.drawImage(si, canvasX, canvasY, canvasW, canvasH);
            res();
          };
          si.onerror = res; // Si falla un sticker, continuamos igual
          si.src = stickerImg.src;
        });
      }

      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    img.src = url;
  });
}

async function uploadPhoto(db) {
  const author    = authorInput.value.trim() || "Anónimo";
  const timestamp = Date.now();

  uploadProgress.hidden = false;
  btnConfirm.disabled   = true;
  progressText.textContent = "Componiendo imagen...";
  progressFill.style.width = "20%";

  try {
    // Comprimimos Y quemamos stickers en un solo paso
    const base64 = await compressImage(selectedFile);
    progressFill.style.width  = "60%";
    progressText.textContent  = "Guardando...";

    const photosRef   = dbRef(db, `${ALBUM_NAME}/photos`);
    const newPhotoRef = push(photosRef);
    progressFill.style.width = "80%";

    await set(newPhotoRef, {
      id:        newPhotoRef.key,
      url:       base64,
      author:    author,
      timestamp: timestamp,
      likes:     0
    });

    progressFill.style.width = "100%";
    progressText.textContent  = "¡Listo!";

    setTimeout(() => {
      resetUploadUI();
      btnConfirm.disabled = false;
    }, 600);

  } catch (error) {
    console.error("Error al guardar:", error);
    alert("Error al guardar la foto. Intentá de nuevo.");
    btnConfirm.disabled = false;
    uploadProgress.hidden = true;
  }
}


// ═══════════════════════════════════════════════════
// 6. SISTEMA DE STICKERS
// ═══════════════════════════════════════════════════

function initStickerPicker() {
  /*
    Construye el grid de stickers disponibles y configura
    el sistema de drag & drop.
  */

  // Renderizamos los stickers disponibles en el picker
  STICKERS.forEach((sticker) => {
    const option = document.createElement("div");
    option.className = "sticker-option";
    option.setAttribute("role", "button"); // Accesibilidad
    option.setAttribute("aria-label", `Agregar sticker: ${sticker.alt}`);
    option.setAttribute("tabindex", "0");  // Tabulable con teclado

    const img = document.createElement("img");
    img.src = sticker.src;
    img.alt = sticker.alt;
    option.appendChild(img);

    // Al clickear un sticker, lo "depositamos" sobre la foto
    option.addEventListener("click", () => addStickerToPhoto(sticker));

    // También funciona con Enter/Space para accesibilidad de teclado
    option.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        addStickerToPhoto(sticker);
      }
    });

    stickerGrid.appendChild(option);
  });

  // Botón para limpiar todos los stickers
  btnClearStickers.addEventListener("click", () => {
    stickersOnPhoto.innerHTML = "";
    // innerHTML = "" elimina todos los hijos del contenedor de stickers
  });
}

function addStickerToPhoto(sticker) {
  /*
    Crea un sticker arrastrable sobre la foto y lo agrega al DOM.
  */

  if (!previewImg.src || previewImg.src === window.location.href) {
    /*
      Verificamos que haya una imagen cargada.
      previewImg.src === window.location.href puede pasar cuando src="" 
      porque el navegador lo convierte a la URL actual.
    */
    return;
  }

  const stickerEl = document.createElement("div");
  stickerEl.className = "sticker-on-photo";
  stickerEl.setAttribute("data-sticker-id", sticker.id);
  /*
    data-sticker-id: atributo personalizado para identificar qué sticker es.
    Útil si en el futuro queremos saber cuántos de cada tipo se usaron.
  */

  // Posición inicial: centro de la foto
  // Usamos porcentajes para que funcione a cualquier tamaño de pantalla
  stickerEl.style.left = "40%";
  stickerEl.style.top  = "40%";
  /*
    40% y no 50% porque el sticker tiene 80px de ancho.
    Si lo ponemos en 50%, el BORDE IZQUIERDO estaría al 50%.
    Con 40% queda más centrado visualmente.
    Lo ideal sería (50% - 40px) pero en % es más compatible.
  */

  const img = document.createElement("img");
  img.src = sticker.src;
  img.alt = sticker.alt;
  img.draggable = false;
  /*
    draggable = false en el <img> evita el comportamiento nativo de drag de imágenes.
    Sin esto, al arrastrar aparecería el "fantasma" de imagen del navegador
    y competiría con nuestro sistema de drag.
  */

  // Botón para eliminar este sticker individual
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "sticker-delete";
  deleteBtn.innerHTML = "✕";
  deleteBtn.setAttribute("aria-label", "Eliminar sticker");
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    /*
      stopPropagation() evita que el click del botón de eliminar
      se "propague" al sticker padre y lo marque para arrastrar.
    */
    stickerEl.remove();
    // .remove() elimina el elemento del DOM directamente
  });

  stickerEl.appendChild(img);
  stickerEl.appendChild(deleteBtn);
  stickersOnPhoto.appendChild(stickerEl);

  // Activamos drag Y resize para este sticker
  makeDraggable(stickerEl);
  makeResizable(stickerEl);
}

function makeDraggable(el) {
  /*
    Drag con Pointer Events API.
    El pointerdown solo inicia el drag si NO viene del handle de resize.
    Así los dos gestos no se pisan entre sí.
  */
  el.addEventListener("pointerdown", (e) => {
    // Si el click viene del handle de resize o del botón eliminar, no arrastramos
    if (e.target.classList.contains("sticker-resize") ||
        e.target.classList.contains("sticker-delete")) return;

    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);

    const rect       = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();

    activeDrag = {
      el,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      parentRect
    };

    el.style.zIndex = "1000";
  });

  el.addEventListener("pointermove", (e) => {
    if (!activeDrag || activeDrag.el !== el) return;
    e.preventDefault();

    const { offsetX, offsetY, parentRect } = activeDrag;
    let newLeft = e.clientX - parentRect.left - offsetX;
    let newTop  = e.clientY - parentRect.top  - offsetY;

    const elWidth  = el.offsetWidth;
    const elHeight = el.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, parentRect.width  - elWidth));
    newTop  = Math.max(0, Math.min(newTop,  parentRect.height - elHeight));

    el.style.left = `${(newLeft / parentRect.width)  * 100}%`;
    el.style.top  = `${(newTop  / parentRect.height) * 100}%`;
  });

  el.addEventListener("pointerup", () => {
    if (activeDrag && activeDrag.el === el) {
      activeDrag = null;
      el.style.zIndex = "";
    }
  });
}

function makeResizable(el) {
  /*
    DOS modos de resize según el dispositivo:
    
    DESKTOP → handle en esquina inferior derecha (cuadradito arrastrable).
    El usuario lo arrastra y el sticker crece/achica.
    
    MÓVIL → pinch con dos dedos (gesture nativo).
    Calculamos la distancia entre los dos touch points y escalamos.
    
    Ambos respetan un tamaño mínimo (30px) y máximo (300px).
  */

  const MIN_SIZE = 30;
  const MAX_SIZE = 300;

  // ── Handle de resize para desktop ──────────────────────────
  const handle = document.createElement("div");
  handle.className = "sticker-resize";
  handle.setAttribute("aria-label", "Cambiar tamaño");
  /*
    El handle es un pequeño cuadrado en la esquina inferior derecha.
    Su estilo está en styles.css (.sticker-resize).
  */
  el.appendChild(handle);

  let resizeDrag = null;
  // Estado del resize activo (similar al activeDrag del drag)

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    resizeDrag = {
      startX:    e.clientX,
      startY:    e.clientY,
      startSize: el.offsetWidth
      /*
        Guardamos el tamaño INICIAL del sticker al empezar el resize.
        Así calculamos el delta (cuánto movió) y lo sumamos al tamaño inicial.
        Si usáramos el tamaño actual en cada frame, el resize sería inestable.
      */
    };
  });

  handle.addEventListener("pointermove", (e) => {
    if (!resizeDrag) return;
    e.preventDefault();

    // Delta: cuánto se movió el mouse desde que empezó el resize
    const deltaX = e.clientX - resizeDrag.startX;
    const deltaY = e.clientY - resizeDrag.startY;

    // Usamos el mayor de los dos deltas para resize proporcional
    const delta = (Math.abs(deltaX) > Math.abs(deltaY)) ? deltaX : deltaY;

    const newSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, resizeDrag.startSize + delta));

    el.style.width  = `${newSize}px`;
    el.style.height = `${newSize}px`;
    /*
      Seteamos width y height iguales para mantener el sticker cuadrado.
      El <img> interno tiene object-fit: contain, así que la imagen
      siempre se escala proporcionalmente sin distorsión.
    */
  });

  handle.addEventListener("pointerup", () => {
    resizeDrag = null;
  });

  // ── Pinch para móvil ────────────────────────────────────────
  let pinchStartDist = null;
  let pinchStartSize = null;

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      /*
        Cuando hay exactamente 2 dedos sobre el sticker,
        guardamos la distancia inicial entre ellos y el tamaño actual.
      */
      pinchStartDist = getPinchDistance(e.touches);
      pinchStartSize = el.offsetWidth;
      e.preventDefault();
      // preventDefault evita que el pinch haga zoom en la página
    }
  }, { passive: false });
  /*
    passive: false es necesario para poder llamar preventDefault().
    Los touch listeners son passive por defecto en Chrome para mejorar
    el scroll performance, pero eso impide cancelar el zoom nativo.
  */

  el.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !pinchStartDist) return;
    e.preventDefault();

    const currentDist = getPinchDistance(e.touches);
    /*
      Calculamos el ratio de cambio de distancia:
      Si los dedos se alejaron el doble → ratio = 2 → sticker el doble de grande.
      Si los dedos se acercaron a la mitad → ratio = 0.5 → sticker la mitad.
    */
    const ratio   = currentDist / pinchStartDist;
    const newSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pinchStartSize * ratio));

    el.style.width  = `${newSize}px`;
    el.style.height = `${newSize}px`;
  }, { passive: false });

  el.addEventListener("touchend", () => {
    if (event.touches.length < 2) {
      pinchStartDist = null;
      pinchStartSize = null;
    }
  });
}

function getPinchDistance(touches) {
  /*
    Calcula la distancia entre dos puntos de toque usando Pitágoras.
    touches[0] y touches[1] son los dos dedos en pantalla.
    
    dx = diferencia horizontal, dy = diferencia vertical.
    distancia = √(dx² + dy²)
  */
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}


// ═══════════════════════════════════════════════════
// 7. FEED DESDE FIREBASE (en tiempo real)
// ═══════════════════════════════════════════════════

function initFeed(db) {
  /*
    onChildAdded: Listener de Firebase que se dispara:
    1. UNA VEZ por cada foto existente al conectarse (carga inicial)
    2. CADA VEZ que alguien sube una foto nueva (tiempo real)
    
    Esto es lo que hace que el álbum sea "en vivo":
    sin necesidad de recargar la página, cada invitado ve las fotos
    de los demás aparecer en su feed.
  */
  const photosRef = dbRef(db, `${ALBUM_NAME}/photos`);

  onChildAdded(photosRef, (snapshot) => {
    /*
      snapshot: Objeto de Firebase que contiene la data de la foto.
      snapshot.val() → el objeto { id, url, author, timestamp, likes, storagePath }
      snapshot.key  → el ID único generado por push()
    */
    const photo = snapshot.val();
    if (!photo || !photo.url) return;
    // Validación básica: si por alguna razón la foto no tiene URL, la saltamos

    photoCount++;
    emptyState.hidden = true;
    // Ocultamos el estado vacío en cuanto hay al menos una foto

    renderPhotoCard(photo, db);
  });

  onChildRemoved(photosRef, (snapshot) => {
    /*
      onChildRemoved: Se dispara cuando alguien elimina una foto.
      Removemos la card del DOM para que desaparezca en tiempo real
      en los dispositivos de todos los invitados.
    */
    const photo = snapshot.val();
    if (!photo) return;

    const card = document.querySelector(`[data-photo-id="${photo.id}"]`);
    if (card) {
      card.style.animation = "cardEntrance 0.3s ease reverse";
      /*
        Reproducimos la animación de entrada al revés para una salida suave.
        "reverse" hace que la animación vaya de to → from.
      */
      setTimeout(() => {
        card.remove();
        photoCount--;
        if (photoCount === 0) {
          emptyState.hidden = false;
          // Volvemos a mostrar el estado vacío si no quedan fotos
        }
      }, 300); // Esperamos que termine la animación de salida
    }
  });
}

function renderPhotoCard(photo, db) {
  /*
    Crea el HTML de una card de foto y la inserta en el feed.
    
    Usamos createElement en lugar de innerHTML para el contenido dinámico
    por seguridad (evita XSS si alguien pone HTML en su nombre).
    Solo usamos innerHTML para las partes estáticas (SVG icons).
  */

  const card = document.createElement("article");
  /*
    <article>: Elemento semántico HTML5. Una unidad de contenido
    que tiene sentido por sí sola (como una foto con sus metadatos).
    Apropiado para items de un feed.
  */
  card.className = "photo-card";
  card.setAttribute("data-photo-id", photo.id);
  // data-photo-id: para poder encontrar y eliminar la card después

  // ── Header: autor y hora
  const cardHeader = document.createElement("div");
  cardHeader.className = "card-header";

  const authorEl = document.createElement("span");
  authorEl.className = "card-author";
  authorEl.textContent = photo.author || "Anónimo";
  /*
    .textContent en lugar de .innerHTML: seguro ante XSS.
    Si el autor pusiera "<script>alert(1)</script>", textContent
    lo mostraría como texto literal, no lo ejecutaría.
  */

  const timeEl = document.createElement("span");
  timeEl.className = "card-time";
  timeEl.textContent = formatTime(photo.timestamp);

  cardHeader.appendChild(authorEl);
  cardHeader.appendChild(timeEl);

  // ── Imagen
  const imgWrap = document.createElement("div");
  imgWrap.className = "card-img-wrap";

  const img = document.createElement("img");
  img.className = "card-img";
  img.src = photo.url;
  img.alt = `Foto de ${photo.author}`;
  img.loading = "lazy";
  /*
    loading="lazy": El navegador no carga la imagen hasta que esté
    cerca del viewport (área visible). Mejora mucho el tiempo de carga
    inicial cuando hay muchas fotos en el feed.
  */

  // Click en la imagen → abre zoom
  imgWrap.addEventListener("click", () => openZoom(photo.url));

  imgWrap.appendChild(img);

  // ── Acciones (like, comentar, descargar, eliminar)
  const actions = document.createElement("div");
  actions.className = "card-actions";

  // Botón de LIKE
  const likeBtn = document.createElement("button");
  likeBtn.className = "action-btn btn-like";
  likeBtn.setAttribute("aria-label", "Me gusta");
  likeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
    <span class="like-count">${photo.likes || 0}</span>
  `;
  /*
    SVG inline: sin dependencias externas (no necesitamos Font Awesome).
    El SVG escala perfectamente a cualquier tamaño (definido por CSS).
    stroke="currentColor" → el color del ícono hereda el color del texto del botón.
    Cuando el botón está en estado "liked" (clase CSS), el color cambia a rojo.
  */

  // Verificamos si este usuario ya le dio like (guardado en localStorage)
  const likeKey = `liked_${photo.id}`;
  if (localStorage.getItem(likeKey)) {
    likeBtn.classList.add("liked");
  }
  /*
    localStorage.getItem devuelve null si la clave no existe, truthy si existe.
    Usamos localStorage para persistir los likes del usuario entre recargas.
    NO es perfecto (se puede hacer reset borrando el localStorage),
    pero es la solución más simple y sin autenticación.
  */

  likeBtn.addEventListener("click", () => handleLike(photo.id, likeBtn, db));

  // Botón de COMENTARIOS
  const commentBtn = document.createElement("button");
  commentBtn.className = "action-btn btn-comment";
  commentBtn.setAttribute("aria-label", "Comentarios");
  commentBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="comment-count">Comentar</span>
  `;

  commentBtn.addEventListener("click", () => openCommentsModal(photo.id, db));

  // Botón de DESCARGA
  const downloadBtn = document.createElement("button");
  downloadBtn.className = "action-btn btn-download";
  downloadBtn.setAttribute("aria-label", "Descargar foto");
  downloadBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  `;

  downloadBtn.addEventListener("click", () => downloadPhoto(photo.url, photo.author));

  // Botón de ELIMINAR
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-delete-card";
  deleteBtn.setAttribute("aria-label", "Eliminar foto");
  deleteBtn.textContent = "🗑️";

  deleteBtn.addEventListener("click", () => deletePhoto(photo, db));

  actions.appendChild(likeBtn);
  actions.appendChild(commentBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(deleteBtn);

  // ── Preview de comentarios (contador)
  const commentsPreview = document.createElement("div");
  commentsPreview.className = "card-comments-preview";

  const commentsCount = document.createElement("span");
  commentsCount.className = "comments-count";
  commentsCount.setAttribute("data-photo-comments-count", photo.id);
  commentsCount.textContent = "Ver comentarios";
  commentsCount.addEventListener("click", () => openCommentsModal(photo.id, db));

  commentsPreview.appendChild(commentsCount);

  // ── Ensamblamos la card
  card.appendChild(cardHeader);
  card.appendChild(imgWrap);
  card.appendChild(actions);
  card.appendChild(commentsPreview);

  // Insertamos al PRINCIPIO del feed para que las fotos nuevas aparezcan arriba
  photoFeed.insertBefore(card, photoFeed.firstChild);
  /*
    insertBefore(newNode, referenceNode):
    Inserta el nuevo nodo ANTES del referenceNode.
    Con firstChild como referencia, siempre va al principio.
    Las fotos más recientes quedan arriba (orden cronológico inverso).
  */

  // Suscribimos actualizaciones en tiempo real de los likes de esta foto
  subscribeToLikes(photo.id, likeBtn, db);
}


// ═══════════════════════════════════════════════════
// 8. LIKES
// ═══════════════════════════════════════════════════

function handleLike(photoId, likeBtn, db) {
  /*
    runTransaction: Operación atómica en Firebase.
    
    PROBLEMA sin transaction:
    Si Alice y Bob dan like al mismo tiempo, ambos leen likes=5,
    ambos calculan likes+1=6, y ambos escriben 6.
    El resultado final es 6 en lugar de 7 (se "pierde" un like).
    
    CON transaction:
    Firebase garantiza que la lectura y escritura son atómicas.
    No puede haber dos escrituras simultáneas que se pisen.
  */
  const likeKey = `liked_${photoId}`;
  const alreadyLiked = localStorage.getItem(likeKey);

  const likesRef = dbRef(db, `${ALBUM_NAME}/photos/${photoId}/likes`);

  runTransaction(likesRef, (currentLikes) => {
    /*
      currentLikes: el valor actual en Firebase (puede ser null si aún no existe).
      El return de esta función ES el nuevo valor que Firebase guardará.
    */
    const current = currentLikes || 0;

    if (alreadyLiked) {
      // Ya le había dado like → quitamos el like
      return Math.max(0, current - 1);
      // Math.max(0, ...) para que nunca quede negativo
    } else {
      // No le había dado like → sumamos
      return current + 1;
    }
  });

  // Actualizamos el localStorage y la UI optimistamente
  // (sin esperar la respuesta de Firebase para que se sienta instantáneo)
  if (alreadyLiked) {
    localStorage.removeItem(likeKey);
    likeBtn.classList.remove("liked");
  } else {
    localStorage.setItem(likeKey, "1");
    likeBtn.classList.add("liked");

    // Animación "pop" del corazón al dar like
    likeBtn.classList.add("like-animate");
    setTimeout(() => likeBtn.classList.remove("like-animate"), 300);
  }
}

function subscribeToLikes(photoId, likeBtn, db) {
  /*
    Suscribimos al nodo de likes de esta foto.
    Cada vez que cualquier usuario da o quita un like,
    este listener se dispara y actualiza el contador en tiempo real.
    
    Usamos import { onValue } para un valor único (no array).
  */

  // Importamos onValue de forma dinámica para no contaminar los imports globales
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ onValue }) => {
      const likesRef = dbRef(db, `${ALBUM_NAME}/photos/${photoId}/likes`);
      onValue(likesRef, (snapshot) => {
        const count = snapshot.val() || 0;
        const countEl = likeBtn.querySelector(".like-count");
        if (countEl) countEl.textContent = count;
        // Actualizamos el número en el botón sin re-renderizar la card entera
      });
    });
}


// ═══════════════════════════════════════════════════
// 9. COMENTARIOS
// ═══════════════════════════════════════════════════

/*
  currentCommentDB: guardamos la referencia a db para usarla en el listener
  del botón de enviar. Así evitamos el anti-patrón de cloneNode que
  causaba que btnCloseModal y otros perdieran sus referencias al DOM.
*/
let currentCommentDB = null;

function openCommentsModal(photoId, db) {
  currentPhotoId   = photoId;
  currentCommentDB = db;

  document.getElementById("commentsList").innerHTML = "";

  document.getElementById("commentsModal").classList.add("is-open");
  document.getElementById("modalBackdrop").classList.add("is-open");
  document.body.style.overflow = "hidden";

  loadComments(photoId, db);
}

function closeCommentsModal() {
  document.getElementById("commentsModal").classList.remove("is-open");
  document.getElementById("modalBackdrop").classList.remove("is-open");
  document.body.style.overflow = "";
  currentPhotoId   = null;
  currentCommentDB = null;
  const ca = document.getElementById("commentAuthor");
  const ct = document.getElementById("commentText");
  if (ca) ca.value = "";
  if (ct) ct.value = "";
}

// ── Listeners de cierre (definidos una sola vez, usan getElementById en el handler)

document.getElementById("btnCloseModal").addEventListener("click", closeCommentsModal);

document.getElementById("modalBackdrop").addEventListener("click", closeCommentsModal);

// ── Listener de envío (definido una sola vez, lee el estado currentPhotoId)
document.getElementById("btnSendComment").addEventListener("click", () => {
  if (currentPhotoId && currentCommentDB) {
    sendComment(currentPhotoId, currentCommentDB);
  }
});

// Cerrar con Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.getElementById("commentsModal").classList.contains("is-open")) closeCommentsModal();
    if (document.getElementById("zoomModal").classList.contains("is-open"))     closeZoom();
  }
});

function loadComments(photoId, db) {
  /*
    onChildAdded en la ruta de comentarios de esta foto.
    Cada comentario existente aparece inmediatamente,
    y los nuevos comentarios aparecen en tiempo real.
  */
  const commentsRef = dbRef(db, `${ALBUM_NAME}/photos/${photoId}/comments`);

  onChildAdded(commentsRef, (snapshot) => {
    const comment = snapshot.val();
    if (!comment) return;

    const item = document.createElement("div");
    item.className = "comment-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "comment-item-header";

    const authorSpan = document.createElement("span");
    authorSpan.className = "comment-item-author";
    authorSpan.textContent = comment.author || "Anónimo";

    const timeSpan = document.createElement("span");
    timeSpan.className = "comment-item-time";
    timeSpan.textContent = formatTime(comment.timestamp);

    header.appendChild(authorSpan);
    header.appendChild(timeSpan);

    const textEl = document.createElement("p");
    textEl.className = "comment-item-text";
    textEl.textContent = comment.text;
    // textContent para seguridad (XSS)

    item.appendChild(header);
    item.appendChild(textEl);

    const list = document.getElementById("commentsList");
    list.appendChild(item);

    // Auto-scroll hacia el último comentario
    list.scrollTop = list.scrollHeight;
    /*
      scrollTop = scrollHeight lleva el scroll al fondo del contenedor.
      Así el usuario siempre ve el comentario más reciente.
    */
  });
}

async function sendComment(photoId, db) {
  const authorEl = document.getElementById("commentAuthor");
  const textEl   = document.getElementById("commentText");
  const author   = authorEl.value.trim() || "Anónimo";
  const text     = textEl.value.trim();

  if (!text) {
    textEl.focus();
    return;
  }

  const commentsRef = dbRef(db, `${ALBUM_NAME}/photos/${photoId}/comments`);
  await push(commentsRef, {
    author,
    text,
    timestamp: Date.now()
  });
  /*
    push() agrega el comentario con ID único.
    El listener onChildAdded que ya está activo lo renderizará automáticamente.
  */

  // Limpiamos solo el texto (mantenemos el nombre para que no lo tenga que reescribir)
  textEl.value = "";
  textEl.focus();

  // Actualizamos el contador en la card
  updateCommentCount(photoId, db);
}

async function updateCommentCount(photoId, db) {
  /*
    Lee todos los comentarios y actualiza el contador en la card.
    Solo se llama al agregar un comentario propio (optimización).
  */
  const commentsRef = dbRef(db, `${ALBUM_NAME}/photos/${photoId}/comments`);
  const snapshot = await get(commentsRef);
  /*
    get() lee UNA VEZ sin establecer un listener continuo.
    Ideal para operaciones puntuales como actualizar un contador.
  */
  const count = snapshot.exists() ? snapshot.size : 0;
  /*
    snapshot.exists() → boolean, true si hay datos en esa ruta.
    snapshot.size → cantidad de hijos directos.
  */

  const countEl = document.querySelector(`[data-photo-comments-count="${photoId}"]`);
  if (countEl) {
    countEl.textContent = count === 0
      ? "Sin comentarios"
      : count === 1
        ? "1 comentario"
        : `${count} comentarios`;
    // Texto apropiado para singular/plural
  }
}


// ═══════════════════════════════════════════════════
// 10. DESCARGA CON STICKERS "QUEMADOS"
// ═══════════════════════════════════════════════════

async function downloadPhoto(url, author) {
  /*
    Para descargar la foto con los stickers quemados encima,
    usamos un <canvas> HTML5 invisible.
    
    PROCESO:
    1. Cargamos la imagen original en el canvas
    2. Pintamos cada sticker encima en su posición
    3. Convertimos el canvas a una URL de datos (base64)
    4. Creamos un link <a> con download y hacemos click programáticamente
    
    PROBLEMA CORS:
    Las imágenes de Firebase Storage están en un dominio diferente al nuestro.
    Al intentar dibujarlas en un canvas, el navegador bloquea por seguridad.
    
    SOLUCIÓN:
    img.crossOrigin = "anonymous" → le pide al servidor que permita el acceso.
    Firebase Storage acepta esto por defecto cuando está configurado correctamente.
  */

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  // getContext("2d") → API de dibujo 2D del canvas

  // Cargamos la imagen principal
  const mainImg = new Image();
  mainImg.crossOrigin = "anonymous";
  mainImg.src = url;

  await new Promise((resolve, reject) => {
    mainImg.onload  = resolve;
    mainImg.onerror = reject;
    /*
      Envolvemos en Promise para poder usar await.
      Sin esto, el canvas podría intentar dibujar antes que la imagen cargue.
    */
  });

  canvas.width  = mainImg.naturalWidth;
  canvas.height = mainImg.naturalHeight;
  /*
    naturalWidth/Height: tamaño real de la imagen (no el tamaño en pantalla).
    Usamos el tamaño original para máxima calidad en la descarga.
  */

  ctx.drawImage(mainImg, 0, 0);
  // Dibujamos la imagen en el canvas en posición 0,0 (esquina superior izquierda)

  // Aquí no quemamos stickers del feed (las fotos del feed ya están subidas sin stickers)
  // La descarga es simplemente la foto original de alta resolución

  // Convertimos el canvas a blob y descargamos
  canvas.toBlob((blob) => {
    if (!blob) return;

    const downloadUrl = URL.createObjectURL(blob);
    /*
      URL.createObjectURL crea una URL temporal que apunta al blob en memoria.
      Formato: "blob:https://tusitio.com/abc-123-def"
    */

    const link = document.createElement("a");
    link.href     = downloadUrl;
    link.download = `foto-tadeo-${Date.now()}.jpg`;
    /*
      El atributo download indica que el link es para descargar, no navegar.
      El valor es el nombre sugerido del archivo.
    */
    link.click();
    // Simulamos un click para disparar la descarga

    URL.revokeObjectURL(downloadUrl);
    /*
      Liberamos la URL temporal de memoria.
      Sin esto, el blob quedaría en RAM hasta que la página se cierre.
    */
  }, "image/jpeg", 0.92);
  /*
    "image/jpeg": formato de la imagen descargada.
    0.92: calidad (0 = mínima, 1 = máxima). 0.92 es buen balance calidad/tamaño.
  */
}


// ═══════════════════════════════════════════════════
// 11. ELIMINAR FOTO
// ═══════════════════════════════════════════════════

async function deletePhoto(photo, db) {
  const confirmed = confirm("¿Seguro que querés eliminar esta foto?");
  if (!confirmed) return;
  try {
    // Un solo paso: eliminar el nodo de la DB (incluye foto + comentarios)
    await set(dbRef(db, `${ALBUM_NAME}/photos/${photo.id}`), null);
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("No se pudo eliminar la foto. Intentá de nuevo.");
  }
}


// ═══════════════════════════════════════════════════
// 12. MODAL DE ZOOM
// ═══════════════════════════════════════════════════

function initZoomModal() {
  btnCloseZoom.addEventListener("click", closeZoom);
  zoomModal.addEventListener("click", (e) => {
    // Click en el fondo negro (no en la imagen) → cierra el zoom
    if (e.target === zoomModal) closeZoom();
  });
}

function openZoom(url) {
  zoomImg.src = url;
  zoomModal.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeZoom() {
  zoomModal.classList.remove("is-open");
  zoomImg.src = "";
  document.body.style.overflow = "";
}


// ═══════════════════════════════════════════════════
// 13. UTILIDADES
// ═══════════════════════════════════════════════════

function formatTime(timestamp) {
  /*
    Convierte un timestamp (milisegundos) a texto relativo como:
    "hace 5 minutos", "hace 2 horas", "hace 3 días"
    
    Intl.RelativeTimeFormat: API nativa del navegador para formatear
    tiempos relativos con localización correcta.
    No necesitamos librerías como moment.js o date-fns para esto básico.
  */
  if (!timestamp) return "";

  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  /*
    "es" → español.
    numeric: "auto" → usa "ayer" en lugar de "hace 1 día",
                       "ahora" en lugar de "hace 0 segundos".
  */

  const diffMs      = Date.now() - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours   = Math.floor(diffMinutes / 60);
  const diffDays    = Math.floor(diffHours / 24);

  if (diffSeconds < 60)  return rtf.format(-diffSeconds, "second");
  if (diffMinutes < 60)  return rtf.format(-diffMinutes, "minute");
  if (diffHours   < 24)  return rtf.format(-diffHours,   "hour");
                         return rtf.format(-diffDays,    "day");
  /*
    Los valores son negativos porque son en el PASADO.
    Intl.RelativeTimeFormat(-5, "minute") → "hace 5 minutos"
  */
}