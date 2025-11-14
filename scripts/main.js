// main.js (als Modul)
import { db, storage } from './firebase-config.js';
import {
  doc, setDoc, getDoc, addDoc, collection, getDocs,
  query, where, orderBy, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// ---------- Utility ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function uid(len=6){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // avoid similar chars
  let s="";
  for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

// ---------- State ----------
let currentClassCode = null;
let currentFolderId = null;
let currentUserName = null;

// ---------- UI Elements ----------
const usernameInput = $('#usernameInput');
const codeInput = $('#codeInput');
const joinBtn = $('#joinBtn');
const logoutBtn = $('#logoutBtn');

const folderList = $('#folderList');
const newFolderBtn = $('#newFolderBtn');

const currentFolderTitle = $('#currentFolderTitle');
const filesArea = $('#filesArea');

const uploadBtn = $('#uploadBtn');
const modal = $('#modal');
const modalClose = $('#modalClose');
const fileInput = $('#fileInput');
const cameraInput = $('#cameraInput');
const cameraPdfBtn = $('#cameraPdfBtn');
const uploadStatus = $('#uploadStatus');
const openNoteEditor = $('#openNoteEditor');
const newNoteBtn = $('#newNoteBtn');

const noteModal = $('#noteModal');
const noteClose = $('#noteClose');
const noteCanvas = $('#noteCanvas');
const noteText = $('#noteText');
const noteTitle = $('#noteTitle');
const saveNoteBtn = $('#saveNoteBtn');
const clearCanvasBtn = $('#clearCanvasBtn');

// ---------- Auth / Session ----------
function saveSession(){
  sessionStorage.setItem('ks_user', JSON.stringify({name: currentUserName, classCode: currentClassCode}));
}
function loadSession(){
  const s = sessionStorage.getItem('ks_user');
  if(!s) return;
  const o = JSON.parse(s);
  currentUserName = o.name;
  currentClassCode = o.classCode;
  usernameInput.value = currentUserName || '';
  codeInput.value = currentClassCode || '';
  if(currentClassCode) enterClass(currentClassCode);
}
function clearSession(){
  sessionStorage.removeItem('ks_user');
  currentUserName = null; currentClassCode = null;
}

// ---------- Class Create / Join ----------
async function createUniqueClass(name){
  // generates unique code and creates document
  let tries = 0;
  while(tries < 6){
    const code = uid(6);
    const docRef = doc(db, 'classes', code);
    const snap = await getDoc(docRef);
    if(!snap.exists()){
      await setDoc(docRef, { name: name || Klasse ${code}, createdAt: serverTimestamp() });
      return code;
    }
    tries++;
  }
  throw new Error('Konnte keinen eindeutigen Code erzeugen. Bitte erneut versuchen.');
}

async function joinOrCreate(){
  const name = usernameInput.value.trim();
  if(!name) return alert('Bitte Namen eingeben.');
  currentUserName = name;

  const codeRaw = codeInput.value.trim();
  if(!codeRaw){
    // create new class
    const newCode = await createUniqueClass(name + 's Klasse');
    currentClassCode = newCode;
    alert(Neue Klasse erstellt: ${newCode} — gib diesen Code an deine Mitschüler.);
  } else {
    // try to join existing
    const docRef = doc(db, 'classes', codeRaw);
    const snap = await getDoc(docRef);
    if(!snap.exists()){
      const create = confirm('Kein Klasse mit diesem Code gefunden. Möchtest du eine neue Klasse mit diesem Code anlegen? (empfohlen: leer lassen um automatischen Code zu erstellen)');
      if(create){
        await setDoc(docRef, { name: name + 's Klasse', createdAt: serverTimestamp() });
        currentClassCode = codeRaw;
      } else {
        return;
      }
    } else {
      currentClassCode = codeRaw;
    }
  }

  saveSession();
  updateUIAfterLogin();
  await loadFolders();
}

joinBtn.addEventListener('click', joinOrCreate);
logoutBtn.addEventListener('click', ()=>{
  clearSession();
  location.reload();
});

// ---------- UI after login ----------
function updateUIAfterLogin(){
  if(currentClassCode){
    joinBtn.style.display='none';
    logoutBtn.style.display='inline-block';
    usernameInput.disabled = true;
    codeInput.disabled = true;
    currentFolderTitle.textContent = Klasse: ${currentClassCode};
  }
}

// ---------- Folder functions ----------
async function createFolder(){
  if(!currentClassCode){ alert('Zuerst Klasse beitreten.'); return; }
  const name = prompt('Name des Ordners (z.B. Mathe)');
  if(!name) return;
  const foldersCol = collection(db, 'classes', currentClassCode, 'folders');
  const docRef = await addDoc(foldersCol, { name, createdAt: serverTimestamp() });
  await loadFolders();
  // auto-open new folder
  currentFolderId = docRef.id;
  renderFiles([]);
}

newFolderBtn.addEventListener('click', createFolder);

// load folders
async function loadFolders(){
  folderList.innerHTML = '';
  if(!currentClassCode) return;
  const q = query(collection(db, 'classes', currentClassCode, 'folders'), orderBy('createdAt', 'desc'));
  const snaps = await getDocs(q);
  snaps.forEach(s => {
    const li = document.createElement('li');
    li.textContent = s.data().name || 'Ordner';
    li.dataset.id = s.id;
    li.addEventListener('click', ()=>openFolder(s.id, s.data().name));
    folderList.appendChild(li);
  });
}

// open folder
async function openFolder(folderId, folderName){
  currentFolderId = folderId;
  currentFolderTitle.textContent = folderName || 'Ordner';
  // mark active
  $$('.folder-list li').forEach(li => li.classList.remove('active'));
  const active = [...$$('.folder-list li')].find(li => li.dataset.id === folderId);
  if(active) active.classList.add('active');
  // load files
  await loadFiles();
}

// ---------- Files (list, upload, download) ----------
async function loadFiles(){
  filesArea.innerHTML = '';
  if(!currentFolderId || !currentClassCode) return;
  const filesCol = collection(db, 'classes', currentClassCode, 'folders', currentFolderId, 'files');
  const q = query(filesCol, orderBy('createdAt','desc'));
  const snaps = await getDocs(q);
  snaps.forEach(s => {
    const d = s.data();
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
      <div class="file-meta">
        <div class="icon">${d.type==='note'?'📝':(d.type==='pdf'?'📄':'📷')}</div>
        <div>
          <div>${d.name}</div>
          <div class="small">${new Date(d.createdAt?.seconds ? d.createdAt.seconds*1000 : Date.now()).toLocaleString()}</div>
        </div>
      </div>
      <div>
        <button class="secondary viewBtn">Öffnen</button>
        <button class="secondary downloadBtn">Herunter</button>
      </div>
    `;
    // view / download handlers
    el.querySelector('.viewBtn').addEventListener('click', async ()=>{
      if(d.type === 'note'){
        openNoteViewer(d);
      } else {
        window.open(d.url, '_blank');
      }
    });
    el.querySelector('.downloadBtn').addEventListener('click', async ()=>{
      // open URL in new tab to let user download
      window.open(d.url, '_blank');
    });
    filesArea.appendChild(el);
  });
}

// ---------- Upload modal ----------
uploadBtn.addEventListener('click', ()=>{ if(!currentFolderId){ alert('Wähle zuerst einen Ordner.'); return;} modal.classList.remove('hidden'); });
modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));

// upload from device
fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  uploadStatus.textContent = 'Lade hoch...';
  await uploadFileToStorage(f);
  uploadStatus.textContent = 'Fertig';
  fileInput.value = '';
  await loadFiles();
});

// camera -> pdf
cameraPdfBtn.addEventListener('click', async ()=>{
  const f = cameraInput.files[0];
  if(!f) return alert('Bitte Foto aufnehmen oder auswählen.');
  uploadStatus.textContent = 'Erzeuge PDF...';
  const pdfBlob = await imageFileToPdfBlob(f);
  uploadStatus.textContent = 'PDF wird hochgeladen...';
  await uploadFileToStorage(new File([pdfBlob], photo-${Date.now()}.pdf, {type:'application/pdf'}));
  uploadStatus.textContent = 'Fertig';
  cameraInput.value = '';
  await loadFiles();
});

// open note editor
openNoteEditor.addEventListener('click', ()=>{
  modal.classList.add('hidden');
  openNoteModal();
});
newNoteBtn.addEventListener('click', ()=>{
  if(!currentFolderId){ alert('Wähle zuerst einen Ordner.'); return; }
  openNoteModal();
});

// ---------- File upload helper ----------
async function uploadFileToStorage(file){
  if(!currentFolderId || !currentClassCode) throw new Error('Kein Zielordner');
  const path = classes/${currentClassCode}/${currentFolderId}/${Date.now()}_${file.name};
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  // save file meta in firestore
  const fileDoc = {
    name: file.name,
    type: file.type.includes('pdf')? 'pdf' : (file.type.startsWith('image/') ? 'image' : 'file'),
    url,
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, 'classes', currentClassCode, 'folders', currentFolderId, 'files'), fileDoc);
}

// ---------- image -> pdf ----------
async function imageFileToPdfBlob(file){
  // create Image bitmap
  const imgBitmap = await createImageBitmap(file);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: imgBitmap.width > imgBitmap.height ? 'landscape' : 'portrait' });
  // draw image to canvas to get dataURL
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = imgBitmap.width;
  tmpCanvas.height = imgBitmap.height;
  const ctx = tmpCanvas.getContext('2d');
  ctx.drawImage(imgBitmap, 0, 0);
  const imgData = tmpCanvas.toDataURL('image/jpeg', 0.95);
  // fit image to pdf page
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // maintain ratio
  const ratio = Math.min(pageW / imgBitmap.width, pageH / imgBitmap.height);
  const w = imgBitmap.width * ratio;
  const h = imgBitmap.height * ratio;
  pdf.addImage(imgData, 'JPEG', (pageW - w)/2, (pageH - h)/2, w, h);
  return pdf.output('blob');
}

// ---------- Notes (OneNote-like) ----------
let canvasCtx, drawing=false, lastX=0, lastY=0;

function setupCanvas(){
  // fit canvas to container
  function resizeCanvas(){
    const rect = noteCanvas.getBoundingClientRect();
    noteCanvas.width = rect.width;
    noteCanvas.height = rect.height;
    // optional: redraw content from saved image if needed
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  canvasCtx = noteCanvas.getContext('2d');
  canvasCtx.strokeStyle = '#fff';
  canvasCtx.lineWidth = 2;
  canvasCtx.lineCap = 'round';

  // pointer events
  noteCanvas.addEventListener('pointerdown', (e)=>{
    drawing = true;
    const r = noteCanvas.getBoundingClientRect();
    lastX = e.clientX - r.left;
    lastY = e.clientY - r.top;
  });
  noteCanvas.addEventListener('pointermove', (e)=>{
    if(!drawing) return;
    const r = noteCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX,lastY);
    canvasCtx.lineTo(x,y);
    canvasCtx.stroke();
    lastX = x; lastY = y;
  });
  noteCanvas.addEventListener('pointerup', ()=> drawing=false);
  noteCanvas.addEventListener('pointercancel', ()=> drawing=false);
}

function clearCanvas(){
  canvasCtx.clearRect(0,0,noteCanvas.width,noteCanvas.height);
}
clearCanvasBtn.addEventListener('click', ()=> clearCanvas());

// open note modal
function openNoteModal(existing = null){
  if(!currentFolderId) { alert('Wähle einen Ordner.'); return; }
  noteModal.classList.remove('hidden');
  // reset
  noteTitle.value = '';
  noteText.value = '';
  clearCanvas();
  setupCanvas();
}

// close note modal
noteClose.addEventListener('click', ()=> noteModal.classList.add('hidden'));

// save note
saveNoteBtn.addEventListener('click', async ()=>{
  const title = noteTitle.value.trim() || 'Notiz';
  const text = noteText.value.trim();
  // export canvas to blob and upload to storage
  noteModal.classList.add('hidden');
  uploadStatus.textContent = 'Notiz wird gespeichert...';
  // convert canvas to blob
  const blob = await new Promise(res => noteCanvas.toBlob(res, 'image/png'));
  // create a file-like object
  const file = new File([blob], ${title.replace(/\s+/g,'_')}_${Date.now()}.png, {type:'image/png'});
  // upload drawing image
  await uploadFileToStorage(file); // will save meta as image type
  // additionally save a note document with text and link to image (optional)
  // find the last uploaded file url (small hack: query last file with that name)
  // Simpler: store note as its own document in files with type 'note' and content text and drawing as dataURL
  const dataUrl = await new Promise(res => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.readAsDataURL(blob);
  });
  const noteDoc = {
    name: title,
    type: 'note',
    contentText: text,
    drawing: dataUrl,
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, 'classes', currentClassCode, 'folders', currentFolderId, 'files'), noteDoc);
  uploadStatus.textContent = 'Notiz gespeichert';
  await loadFiles();
});

// open note viewer (simple)
function openNoteViewer(docData){
  noteModal.classList.remove('hidden');
  noteTitle.value = docData.name || 'Notiz';
  noteText.value = docData.contentText || '';
  // draw image if present
  const img = new Image();
  img.onload = ()=>{
    clearCanvas();
    // fit
    const ratio = Math.min(noteCanvas.width / img.width, noteCanvas.height / img.height);
    const w = img.width * ratio, h = img.height * ratio;
    canvasCtx.drawImage(img, (noteCanvas.width - w)/2, (noteCanvas.height - h)/2, w, h);
  };
  if(docData.drawing) img.src = docData.drawing;
  else canvasCtx.clearRect(0,0,noteCanvas.width,noteCanvas.height);
}

// ---------- Init (session load) ----------
loadSession();

// If session exists, UI will be updated by loadSession -> enterClass called there
async function enterClass(code){
  currentClassCode = code;
  saveSession();
  updateUIAfterLogin();
  await loadFolders();
  // open first folder automatically
  const q = query(collection(db, 'classes', currentClassCode, 'folders'), orderBy('createdAt','desc'));
  const snaps = await getDocs(q);
  if(snaps.size > 0){
    openFolder(snaps.docs[0].id, snaps.docs[0].data().name);
  } else {
    currentFolderTitle.textContent = 'Keine Ordner — erstelle einen';
  }
}

// If there is session stored from previous load
if(currentClassCode) updateUIAfterLogin();