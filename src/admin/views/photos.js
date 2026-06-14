import { api } from "../api.js";
import { uploadPhoto } from "../upload.js";

export async function initPhotos(c) {
  c.textContent = "Loading…";
  const { photos } = await api.photos.list();
  renderPhotos(c, photos);
}

function renderPhotos(c, photos) {
  // Static grid shell — dynamic values in cards built via DOM methods // nosec
  c.innerHTML =
    "<div class=\"photos-head\">" +
      "<h2 class=\"view-title\" style=\"margin:0\">Photos</h2>" +
      "<label class=\"upload-btn\">+ Upload<input type=\"file\" id=\"photoInput\" accept=\"image/*\" multiple hidden></label>" +
    "</div>" +
    "<div class=\"upload-drop\" id=\"uploadDrop\">Drop images here to upload</div>" +
    "<p id=\"uploadStatus\" class=\"upload-status\" hidden></p>" +
    "<div class=\"photo-grid\" id=\"photoGrid\"></div>";

  const grid = c.querySelector("#photoGrid");
  photos.forEach(p => grid.appendChild(makeCard(p)));

  c.querySelector("#photoInput").addEventListener("change", function () {
    handleFiles(Array.from(this.files), c);
  });

  const drop = c.querySelector("#uploadDrop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag-over"); handleFiles(Array.from(e.dataTransfer.files), c); });

  grid.addEventListener("click", e => {
    const card = e.target.closest("[data-photo-id]");
    if (card && e.target.closest(".photo-delete")) {
      if (confirm("Delete this photo?")) {
        api.photos.remove(card.dataset.photoId).then(() => card.remove());
      }
    }
  });

  // Drag-to-reorder: HTML5 DnD on the grid
  let dragSrc = null;

  grid.addEventListener("dragstart", e => {
    const card = e.target.closest("[data-photo-id]");
    if (!card) return;
    dragSrc = card;
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });

  grid.addEventListener("dragend", e => {
    const card = e.target.closest("[data-photo-id]");
    if (card) card.classList.remove("dragging");
    dragSrc = null;
  });

  grid.addEventListener("dragover", e => {
    e.preventDefault();
    const card = e.target.closest("[data-photo-id]");
    if (!card || card === dragSrc) return;
    const cards = Array.from(grid.querySelectorAll("[data-photo-id]"));
    const srcIdx  = cards.indexOf(dragSrc);
    const destIdx = cards.indexOf(card);
    if (srcIdx < destIdx) grid.insertBefore(dragSrc, card.nextSibling);
    else                   grid.insertBefore(dragSrc, card);
  });

  grid.addEventListener("drop", async e => {
    e.preventDefault();
    const cards = Array.from(grid.querySelectorAll("[data-photo-id]"));
    await Promise.all(cards.map((card, idx) =>
      api.photos.update(card.dataset.photoId, { sort_order: idx })
    ));
    dragSrc = null;
  });
}

async function handleFiles(files, c) {
  const status = c.querySelector("#uploadStatus");
  status.hidden = false;
  let lastError = null;
  for (const file of files) {
    try {
      const { id, thumbUrl, fullUrl, aspectRatio } = await uploadPhoto(file, msg => { status.textContent = msg; });
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const { id: photoId } = await api.photos.create({ title: name, category: "portraits", meta: "", thumb_url: thumbUrl, full_url: fullUrl, aspect_ratio: aspectRatio });
      c.querySelector("#photoGrid").prepend(makeCard({ id: photoId || id, title: name, category: "portraits", thumb_url: thumbUrl }));
      lastError = null;
    } catch (err) {
      lastError = err;
      status.textContent = "Error: " + err.message;
    }
  }
  if (!lastError) {
    status.textContent = "Done.";
    setTimeout(() => { status.hidden = true; }, 2000);
  }
}

function makeCard(p) {
  const div = document.createElement("div");
  div.className = "photo-card";
  div.dataset.photoId = p.id;
  div.draggable = true;
  const img = document.createElement("img");
  img.src = p.thumb_url;
  img.alt = p.title;
  img.loading = "lazy";
  const info = document.createElement("div");
  info.className = "photo-card-info";
  const titleEl = document.createElement("span");
  titleEl.className = "photo-title";
  titleEl.textContent = p.title;
  const catEl = document.createElement("span");
  catEl.className = "photo-cat";
  catEl.textContent = p.category;
  const del = document.createElement("button");
  del.className = "photo-delete";
  del.setAttribute("aria-label", "Delete photo");
  del.textContent = "×";
  info.append(titleEl, catEl);
  div.append(img, info, del);
  return div;
}
