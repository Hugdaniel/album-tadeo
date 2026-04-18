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
  Importamos solo las funciones de Firebase que necesitamos.
  Tree shaking: el bundler (o el navegador) descarta el resto.
  Cada import es explícito — sabés exactamente qué usa cada sección.
*/
import {
  ref as dbRef,          // Para crear referencias a rutas en la Realtime Database
  push,                  // Para agregar items a un array (genera ID automático)
  set,                   // Para setear un valor en una ruta exacta
  onChildAdded,          // Listener: se dispara por cada hijo existente Y cada nuevo
  onChildRemoved,        // Listener: se dispara cuando se elimina un hijo
  runTransaction,        // Para operaciones atómicas (like sin race condition)
  get                    // Para leer una vez sin listener continuo
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import {
  ref as storageRef,     // Para crear referencias a rutas en Storage
  uploadBytesResumable,  // Sube un archivo con seguimiento de progreso
  getDownloadURL,        // Obtiene la URL pública de un archivo subido
  deleteObject           // Elimina un archivo de Storage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/*
  ─────────────────────────────────────────────────
  STICKERS: Editá este array con tus archivos PNG.
  Ponelos en una carpeta /stickers/ al mismo nivel que index.html.
  Los nombres deben coincidir exactamente con los archivos.
  ─────────────────────────────────────────────────
*/
const STICKERS = [
  { id: "s1", src: "stickers/grizzy-cara.png",      alt: "Grizzy cara" },
  { id: "s2", src: "stickers/grizzy-corriendo.png", alt: "Grizzy corriendo" },
  { id: "s3", src: "stickers/lemmings-grupo.png",   alt: "Los Lemmings" },
  { id: "s4", src: "stickers/lemming-solo.png",     alt: "Lemming solo" },
  { id: "s5", src: "stickers/feliz-cumple.png",     alt: "Feliz cumple" },
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

/*
  document.addEventListener("DOMContentLoaded") se dispara cuando el HTML
  está completamente parseado pero antes de que carguen imágenes, CSS, etc.
  
  Es el momento seguro para acceder al DOM y conectar eventos.
  
  Sin este wrapper, si el script se ejecutara antes que el HTML, las
  llamadas a getElementById() devolverían null.
  
  NOTA: Como el script tiene type="module" ya se ejecuta diferido automáticamente,
  pero el DOMContentLoaded es una buena práctica explícita.
*/
document.addEventListener("DOMContentLoaded", () => {

  // Recuperamos las instancias de Firebase que guardamos en window desde el HTML
  const db      = window.__firebaseDB;
  const storage = window.__firebaseStorage;

  // Verificamos que Firebase se haya inicializado correctamente
  if (!db || !storage) {
    console.error("Firebase no está inicializado. Revisá la configuración en index.html.");
    return; // Detenemos la ejecución si Firebase falla
  }

  // Arrancamos todos los subsistemas
  initStickerPicker();
  initUpload(db, storage);
  initFeed(db);
  initCommentModal(db);
  initZoomModal();
});


// ═══════════════════════════════════════════════════
// 5. LÓGICA DE SUBIDA DE FOTO
// ═══════════════════════════════════════════════════

function initUpload(db, storage) {
  /*
    Esta función configura todo lo relacionado con seleccionar y subir una foto.
    Recibe db y storage como parámetros para no depender de variables globales.
  */

  // Click en el botón de cámara → activa el input de archivo oculto
  btnCamera.addEventListener("click", () => {
    fileInput.click();
    /*
      fileInput.click() programa maticamente abre el diálogo del sistema
      para seleccionar un archivo / abrir la cámara.
      En móvil, el SO pregunta si usar cámara o galería.
    */
  });

  // Cuando el usuario elige un archivo...
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    /*
      e.target.files es un FileList (array-like).
      files[0] es el primer (y único en nuestro caso) archivo seleccionado.
    */

    if (!file) return; // Si el usuario canceló, files[0] es undefined

    // Validamos que sea una imagen
    if (!file.type.startsWith("image/")) {
      alert("Por favor seleccioná una imagen.");
      return;
    }

    // Validamos el tamaño (máx 10MB para no saturar Firebase Storage gratuito)
    if (file.size > 10 * 1024 * 1024) {
      alert("La imagen es demasiado grande. Máximo 10MB.");
      return;
    }

    selectedFile = file;
    // Guardamos el archivo en el estado para usarlo al confirmar la subida

    // Leemos el archivo como base64 para mostrarlo en el preview
    const reader = new FileReader();
    /*
      FileReader es una API del navegador para leer archivos locales
      sin enviarlos al servidor.
      readAsDataURL() convierte el archivo en una cadena base64
      con el formato: "data:image/jpeg;base64,/9j/4AAQ..."
    */

    reader.onload = (event) => {
      /*
        reader.onload se dispara cuando la lectura termina.
        event.target.result contiene el base64 de la imagen.
      */
      previewImg.src = event.target.result;
      // Asignamos el base64 como src de la imagen de preview

      previewContainer.hidden = false;
      // Mostramos el contenedor de preview (arranca hidden en el HTML)

      btnCamera.hidden = true;
      // Ocultamos el botón de cámara mientras estamos en modo preview

      // Limpiar stickers previos si hubiera de una foto anterior
      stickersOnPhoto.innerHTML = "";
    };

    reader.readAsDataURL(file);
    // Disparamos la lectura del archivo

    // Resetear el input para que el evento "change" se dispare
    // aunque el usuario elija el mismo archivo dos veces
    fileInput.value = "";
  });

  // Botón CANCELAR
  btnCancel.addEventListener("click", resetUploadUI);

  // Botón CONFIRMAR SUBIDA
  btnConfirm.addEventListener("click", () => {
    if (!selectedFile) return;
    uploadPhoto(db, storage);
  });
}

function resetUploadUI() {
  /*
    Limpia toda la UI de preview y vuelve al estado inicial.
    Se llama al cancelar o después de una subida exitosa.
  */
  selectedFile = null;
  previewImg.src = "";
  previewContainer.hidden = true;
  uploadProgress.hidden = true;
  btnCamera.hidden = false;
  authorInput.value = "";
  stickersOnPhoto.innerHTML = "";
  progressFill.style.width = "0%";
  progressText.textContent = "Subiendo... 0%";
  fileInput.value = ""; // Resetea el input de archivo
}

async function uploadPhoto(db, storage) {
  /*
    async/await: Trabajamos con Promesas de forma más legible.
    En lugar de .then().catch() anidados, el código se lee como síncrono
    aunque internamente sea asíncrono.
  */

  const author = authorInput.value.trim() || "Anónimo";
  /*
    .trim() elimina espacios al inicio y al final.
    || "Anónimo" es el valor por defecto si el campo está vacío.
  */

  // Generamos un nombre único para el archivo en Storage
  const timestamp = Date.now();
  /*
    Date.now() devuelve milisegundos desde epoch (1 enero 1970).
    Ejemplo: 1719234567890
    Es prácticamente único para archivos subidos en momentos distintos.
  */
  const extension = selectedFile.type.split("/")[1];
  // selectedFile.type es "image/jpeg" → split("/")[1] → "jpeg"
  const fileName = `${ALBUM_NAME}/${timestamp}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  /*
    Nombre final ejemplo: "album-tadeo/1719234567890_k3f9a2.jpeg"
    Math.random().toString(36) convierte un número aleatorio a base 36 (letras+números)
    .slice(2, 8) toma 6 caracteres, suficiente para evitar colisiones.
    
    Carpeta = ALBUM_NAME para organizar Storage por evento.
  */

  // Mostramos barra de progreso
  uploadProgress.hidden = false;
  btnConfirm.disabled = true;
  /*
    Deshabilitamos el botón de confirmar para evitar subidas duplicadas
    si el usuario hace doble click.
  */

  try {
    // Referencia al lugar en Storage donde guardaremos la imagen
    const imageRef = storageRef(storage, `photos/${fileName}`);
    /*
      storageRef(storage, ruta) crea una referencia (no sube nada todavía).
      La ruta es: "photos/album-tadeo/1719234567890_k3f9a2.jpeg"
    */

    // Iniciamos la subida con seguimiento de progreso
    const uploadTask = uploadBytesResumable(imageRef, selectedFile);
    /*
      uploadBytesResumable devuelve un objeto "task" que:
      - Emite eventos de progreso (snapshot.bytesTransferred / snapshot.totalBytes)
      - Emite evento de error si falla
      - Emite evento de completado cuando termina
    */

    // Escuchamos los eventos de la subida
    uploadTask.on(
      "state_changed",

      // CALLBACK 1: Progreso
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `Subiendo... ${progress}%`;
        /*
          Actualizamos el ancho del div de progreso en tiempo real.
          El CSS tiene transition: width 0.3s que hace que crezca suavemente.
        */
      },

      // CALLBACK 2: Error
      (error) => {
        console.error("Error al subir:", error);
        alert("Hubo un error al subir la foto. Intentá de nuevo.");
        btnConfirm.disabled = false;
        uploadProgress.hidden = true;
      },

      // CALLBACK 3: Completado
      async () => {
        /*
          La subida terminó. Ahora obtenemos la URL pública de la imagen.
        */
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        /*
          getDownloadURL devuelve la URL permanente de Firebase Storage.
          Esta URL es pública y sirve para mostrar la imagen en el feed.
        */

        // Guardamos los datos de la foto en Realtime Database
        const photosRef = dbRef(db, `${ALBUM_NAME}/photos`);
        const newPhotoRef = push(photosRef);
        /*
          push() crea un nuevo hijo con ID automático único.
          El ID generado es algo como "-NxK3mAbCdEfGhIj" (timestamp + random).
          Es más seguro que usar un número incremental porque no hay race conditions.
        */

        await set(newPhotoRef, {
          id:        newPhotoRef.key,  // Guardamos el ID dentro del objeto
          url:       downloadURL,       // URL pública de la imagen en Storage
          author:    author,
          timestamp: timestamp,
          likes:     0,                // Arranca en 0 likes
          storagePath: `photos/${fileName}` // Guardamos el path para poder eliminarlo
        });
        /*
          set() escribe el objeto en la ruta de Firebase.
          Guardamos el storagePath para cuando el usuario quiera eliminar la foto:
          necesitamos tanto la referencia en DB como en Storage.
        */

        // Éxito — limpiamos la UI
        resetUploadUI();
        btnConfirm.disabled = false;
        /*
          No necesitamos agregar la card manualmente al feed.
          El listener onChildAdded en initFeed() detectará el nuevo registro
          y renderizará la card automáticamente.
        */
      }
    );

  } catch (error) {
    console.error("Error inesperado:", error);
    alert("Error al subir la foto.");
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

  // Activamos el sistema de drag para este sticker
  makeDraggable(stickerEl);
}

function makeDraggable(el) {
  /*
    Convierte un elemento en arrastrable tanto con mouse como con touch.
    
    ESTRUCTURA DEL DRAG:
    1. pointerdown → guarda posición inicial, marca el elemento como "en drag"
    2. pointermove → calcula el desplazamiento y mueve el elemento
    3. pointerup   → suelta el elemento
    
    Usamos Pointer Events API (en lugar de Mouse + Touch Events por separado)
    porque maneja ambos automáticamente con un solo listener.
  */

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    /*
      preventDefault() en touch evita que el scroll de página se active
      mientras arrastramos el sticker.
    */
    e.stopPropagation();

    el.setPointerCapture(e.pointerId);
    /*
      setPointerCapture: "captura" el pointer en este elemento.
      Significa que aunque el cursor salga del elemento, 
      los eventos de pointermove siguen llegando a él.
      Sin esto, si el usuario mueve el mouse muy rápido,
      el elemento "pierde" el rastro del cursor y el drag se congela.
    */

    const rect = el.getBoundingClientRect();
    /*
      getBoundingClientRect() devuelve la posición y tamaño del elemento
      relativo al viewport (la pantalla visible).
      Lo usamos para saber dónde está el sticker ANTES del drag.
    */

    const parentRect = el.parentElement.getBoundingClientRect();
    /*
      También necesitamos la posición del contenedor padre (la foto).
      Los cálculos del drag son RELATIVOS al padre, no al viewport.
    */

    activeDrag = {
      el,
      // Diferencia entre donde el usuario hizo click y el borde del sticker
      // Esto evita que el sticker "salte" al centro del cursor al empezar el drag
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      parentRect
    };

    el.style.zIndex = "1000";
    // Ponemos el sticker que se está arrastrando encima de los demás
  });

  el.addEventListener("pointermove", (e) => {
    if (!activeDrag || activeDrag.el !== el) return;
    // Solo procesamos si ESTE elemento es el que está en drag

    e.preventDefault();

    const { offsetX, offsetY, parentRect } = activeDrag;

    // Calculamos la nueva posición en píxeles relativos al padre
    let newLeft = e.clientX - parentRect.left - offsetX;
    let newTop  = e.clientY - parentRect.top  - offsetY;

    // Clamping: evitamos que el sticker salga de los límites de la foto
    const elWidth  = el.offsetWidth;
    const elHeight = el.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, parentRect.width  - elWidth));
    newTop  = Math.max(0, Math.min(newTop,  parentRect.height - elHeight));
    /*
      Math.max(0, ...) → mínimo 0px (no sale por la izquierda/arriba)
      Math.min(..., parentWidth - elWidth) → máximo al borde derecho/abajo
    */

    // Convertimos a porcentaje para que funcione a cualquier tamaño
    el.style.left = `${(newLeft / parentRect.width)  * 100}%`;
    el.style.top  = `${(newTop  / parentRect.height) * 100}%`;
    /*
      Porcentajes en lugar de px para que si el contenedor
      cambia de tamaño (responsive), los stickers mantengan su posición relativa.
    */
  });

  el.addEventListener("pointerup", () => {
    if (activeDrag && activeDrag.el === el) {
      activeDrag = null;
      el.style.zIndex = ""; // Reseteamos el z-index
    }
  });
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
  /*
    Eliminar una foto requiere dos pasos:
    1. Eliminar el archivo de Firebase Storage (el binario de la imagen)
    2. Eliminar el registro de la Realtime Database (los metadatos)
    
    Si solo eliminamos la DB, la imagen sigue ocupando espacio en Storage.
    Si solo eliminamos Storage, en la DB queda un registro con URL rota.
    
    IMPORTANTE: El listener onChildRemoved en initFeed() se encargará
    de remover la card del DOM automáticamente cuando se elimine de la DB.
  */

  const confirmed = confirm("¿Seguro que querés eliminar esta foto?");
  /*
    confirm() muestra un diálogo nativo del navegador.
    No es la UI más bonita, pero es la más confiable para confirmaciones
    importantes (no se puede ignorar accidentalmente).
  */
  if (!confirmed) return;

  try {
    // Paso 1: Eliminar de Storage
    if (photo.storagePath) {
      const fileRef = storageRef(
        window.__firebaseStorage,
        photo.storagePath
      );
      await deleteObject(fileRef);
    }

    // Paso 2: Eliminar de la Database
    const photoRef = dbRef(db, `${ALBUM_NAME}/photos/${photo.id}`);
    await set(photoRef, null);
    /*
      set(ref, null) es la forma de eliminar un nodo en Firebase Realtime Database.
      No existe un método "delete" explícito — setear a null elimina el nodo.
    */

    // También eliminamos los comentarios de esta foto (limpieza)
    const commentsRef = dbRef(db, `${ALBUM_NAME}/photos/${photo.id}/comments`);
    await set(commentsRef, null);

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