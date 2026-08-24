const scraps = [
  {
    brand: "Sezane",
    name: "Leontine Jacket",
    price: "$245 when saved",
    creator: "@camille.archive",
    url: "https://example.com/sezane-leontine",
    source: "https://instagram.com/reel/example-leontine",
    category: "Blazer",
    x: 27,
    y: 38,
    size: 148,
    tilt: "-2deg",
    art: "dress",
    color: "#eee7da"
  },
  {
    brand: "Le Specs",
    name: "Outta Love Sunglasses",
    price: "$65 when saved",
    creator: "@mina.notes",
    url: "https://example.com/le-specs",
    source: "https://instagram.com/reel/example-sunglasses",
    category: "Eyewear",
    x: 69,
    y: 31,
    size: 116,
    tilt: "6deg",
    art: "sunglasses",
    color: "#222222"
  },
  {
    brand: "A.P.C.",
    name: "Grace Bag",
    price: "$695 when saved",
    creator: "@smallwardrobe",
    url: "https://example.com/apc-grace",
    source: "https://instagram.com/reel/example-bag",
    category: "Bag",
    x: 55,
    y: 57,
    size: 136,
    tilt: "-5deg",
    art: "bag",
    color: "#744a32"
  },
  {
    brand: "Byredo",
    name: "Blanche Eau de Parfum",
    price: "$225 when saved",
    creator: "@shelf.life",
    url: "https://example.com/byredo-blanche",
    source: "https://instagram.com/reel/example-perfume",
    category: "Fragrance",
    x: 80,
    y: 72,
    size: 108,
    tilt: "3deg",
    art: "perfume",
    color: "#e8ecec"
  },
  {
    brand: "Adidas",
    name: "Samba OG",
    price: "$100 when saved",
    creator: "@walked.in",
    url: "https://example.com/samba-og",
    source: "https://instagram.com/reel/example-samba",
    category: "Shoes",
    x: 23,
    y: 76,
    size: 132,
    tilt: "8deg",
    art: "shoe",
    color: "#f4f1e9"
  }
];

const processingSteps = [
  "Saved",
  "Processing media",
  "Understanding content",
  "Found 4 products",
  "Matching products",
  "Creating scraps",
  "Ready"
];

const statusLabels = {
  saved: "Saved",
  processing: "Processing",
  ready: "Ready",
  review: "Needs review"
};

const canvas = document.querySelector("#canvas");
const activityList = document.querySelector("#activityList");
const mobileSheet = document.querySelector("#mobileSheet");
const sheetContent = document.querySelector("#sheetContent");
const captureForm = document.querySelector("#captureForm");
const captureUrl = document.querySelector("#captureUrl");
const apiBase = "http://127.0.0.1:8790";
const renderedJobIds = new Set();

function svgFor(scrap) {
  const color = scrap.color;
  const dark = "#202020";
  const line = "#d7d7d2";
  const map = {
    dress: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><path fill="${color}" d="M68 24h44l16 36-17 10 28 78H41l28-78-17-10 16-36z"/><path fill="none" stroke="${line}" stroke-width="3" d="M70 70h40M77 24c3 13 23 13 26 0"/></svg>`,
    sunglasses: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><path fill="${dark}" d="M28 78c16-8 43-8 55 5 4 4 10 4 14 0 12-13 39-13 55-5-3 30-16 48-43 48-17 0-27-8-33-25-3-8-9-8-12 0-6 17-16 25-33 25-27 0-40-18-43-48z"/><path fill="none" stroke="${line}" stroke-width="5" d="M80 86c7-5 13-5 20 0"/></svg>`,
    bag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><path fill="${color}" d="M47 65h86l10 82H37l10-82z"/><path fill="none" stroke="${dark}" stroke-width="6" d="M66 65c1-26 47-26 48 0"/><path fill="rgba(255,255,255,.28)" d="M53 78h74l6 58H47l6-58z"/></svg>`,
    perfume: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><path fill="${line}" d="M72 32h36v24H72z"/><path fill="${color}" d="M57 58h66l8 88H49l8-88z"/><path fill="#fff" d="M67 82h46v34H67z"/><path fill="${dark}" d="M75 96h30v4H75z"/></svg>`,
    shoe: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><path fill="${color}" d="M34 103c24 5 50-21 67-47 16 22 34 37 61 45 6 22-5 34-30 34H49c-20 0-30-12-15-32z"/><path fill="none" stroke="${dark}" stroke-width="4" d="M70 91h36M80 80h34M95 68h28"/><path fill="${dark}" d="M39 130h104c-3 9-10 13-24 13H55c-12 0-18-4-16-13z"/></svg>`
  };
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(map[scrap.art])}`;
}

function imageFor(scrap) {
  return typeof scrap.imageUrl === "string" && /^https?:\/\//.test(scrap.imageUrl) ? scrap.imageUrl : svgFor(scrap);
}

function labelMarkup(scrap, includeLinks = true) {
  return `
    <span class="label-brand">${scrap.brand}</span>
    <span class="label-name">${scrap.name}</span>
    <span class="label-price">${scrap.price}</span>
    ${includeLinks ? `
      <span class="sheet-links">
        <a href="${scrap.url}">View product -></a>
        <a href="${scrap.url}">Check availability -></a>
        <a href="${scrap.source}">View original Reel -></a>
      </span>
    ` : ""}
  `;
}

function renderScrap(scrap) {
  const item = document.createElement("div");
  item.className = "scrap";
  item.style.setProperty("--size", `${scrap.size}px`);
  item.style.setProperty("--tilt", scrap.tilt);
  item.style.left = `${scrap.x}%`;
  item.style.top = `${scrap.y}%`;
  item.innerHTML = `
    <button class="scrap-tap" type="button" aria-label="${scrap.brand} ${scrap.name}">
      <img class="scrap-art" alt="" src="${imageFor(scrap)}">
    </button>
    <span class="label">${labelMarkup(scrap, false)}<a href="${scrap.url}">View product -></a><a href="${scrap.source}">View original Reel -></a></span>
  `;
  item.querySelector(".scrap-tap").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      openSheet(scrap);
    }
  });
  canvas.append(item);
}

function renderActivity(scrap, state = "ready") {
  const item = document.createElement("li");
  item.className = "activity-item";
  item.dataset.creator = scrap.creator;
  const status = statusLabels[state] || statusLabels.ready;
  item.innerHTML = `
    <img class="activity-thumb" alt="" src="${imageFor(scrap)}">
    <div>
      <p class="activity-title">Processing ${scrap.creator}'s Reel</p>
      <div class="activity-step">${status}</div>
    </div>
    <span class="activity-state">${status}</span>
  `;
  activityList.append(item);
}

function openSheet(scrap) {
  sheetContent.innerHTML = labelMarkup(scrap);
  mobileSheet.classList.add("is-open");
  mobileSheet.setAttribute("aria-hidden", "false");
}

function openReview(job) {
  const products = (job.products || []).map((product, index) => ({ product, index })).filter(({ product }) => product.status === "review");
  sheetContent.innerHTML = `
    <span class="label-brand">Needs review</span>
    ${products.length ? products.map(({ product, index }) => `
      <span class="label-name">${product.name || product.product_name || "Possible product match"}</span>
      <span class="label-price">${product.price || "Price unavailable"}</span>
      ${product.reason ? `<p class="review-reason">${product.reason}</p>` : ""}
      <span class="sheet-links">
        ${product.url ? `<a href="${product.url}" target="_blank" rel="noreferrer">Open product page -></a>` : ""}
      </span>
      ${product.url && product.imageUrl ? `<span class="review-actions"><button type="button" data-review-action="confirm" data-product-index="${index}">Confirm match</button><button type="button" data-review-action="reject" data-product-index="${index}">Not this match</button></span>` : "<p class=\"review-reason\">There is not enough verified product information to approve this item yet.</p>"}
    `).join("") : `<p class="review-reason">No product has enough evidence to approve. You can return to the Reel and save it again after checking the brand or product name.</p>`}
    <span class="sheet-links"><a href="${job.sourceUrl}" target="_blank" rel="noreferrer">Open original Reel -></a></span>
  `;
  sheetContent.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => reviewProduct(job, Number(button.dataset.productIndex), button.dataset.reviewAction));
  });
  mobileSheet.classList.add("is-open");
  mobileSheet.setAttribute("aria-hidden", "false");
}

async function reviewProduct(job, productIndex, action) {
  const response = await fetch(`${apiBase}/api/scraps/${job.id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productIndex, action })
  });
  if (!response.ok) return;
  const updated = await response.json();
  mobileSheet.classList.remove("is-open");
  if (action === "confirm") {
    const product = updated.products[productIndex];
    const incoming = productFromUrl(updated.sourceUrl);
    const resolved = { ...incoming, brand: product.brand, name: product.name || product.product_name, price: product.price, url: product.url, imageUrl: product.imageUrl };
    scraps.push(resolved);
    renderScrap(resolved);
  }
}

function addReviewButton(item, job) {
  if (item.querySelector(".review-button")) return;
  const button = document.createElement("button");
  button.className = "review-button";
  button.type = "button";
  button.textContent = "Review";
  button.addEventListener("click", () => openReview(job));
  item.append(button);
}

function productFromUrl(url) {
  const id = scraps.length + activityList.children.length + 1;
  const positions = [
    { x: 10, y: 18 }, { x: 42, y: 16 }, { x: 76, y: 18 },
    { x: 12, y: 50 }, { x: 46, y: 48 }, { x: 79, y: 50 },
    { x: 8, y: 80 }, { x: 40, y: 78 }, { x: 72, y: 80 }
  ];
  const position = positions[(id - 1) % positions.length];
  return {
    brand: "Pending match",
    name: "Instagram save",
    price: "Price unavailable",
    creator: "@unknown",
    url: "https://example.com/product-match-pending",
    source: url,
    category: "Unsorted",
    x: position.x,
    y: position.y,
    size: 96 + ((id * 7) % 28),
    tilt: `${-6 + (id % 12)}deg`,
    art: ["dress", "sunglasses", "bag", "perfume", "shoe"][id % 5],
    color: ["#dfe4dd", "#ece7df", "#232323", "#8a5b42", "#edf0f2"][id % 5]
  };
}

function renderJobProducts(job) {
  if (renderedJobIds.has(job.id)) return;
  renderedJobIds.add(job.id);
  (job.products || []).filter((product) => product.status === "ready").forEach((product, index) => {
    const incoming = productFromUrl(job.sourceUrl);
    const resolved = {
      ...incoming,
      brand: product.brand || "Unidentified brand",
      name: product.name || product.product_name || "Possible product match",
      price: product.price || "Price unavailable",
      url: product.url || job.sourceUrl,
      source: job.sourceUrl,
      imageUrl: product.imageUrl,
      color: ["#dfe4dd", "#ece7df", "#232323", "#8a5b42"][index % 4]
    };
    scraps.push(resolved);
    renderScrap(resolved);
  });
}

async function loadSavedJobs() {
  try {
    const response = await fetch(`${apiBase}/api/scraps`);
    if (!response.ok) return;
    const jobs = await response.json();
    jobs.filter((job) => ["ready", "review"].includes(job.status)).forEach(renderJobProducts);
  } catch {
    // The demo museum remains available when the local API is offline.
  }
}

async function simulateCapture(url) {
  const incoming = productFromUrl(url);
  switchView("activity");
  const item = document.createElement("li");
  item.className = "activity-item";
  item.innerHTML = `
    <img class="activity-thumb" alt="" src="${imageFor(incoming)}">
    <div>
      <p class="activity-title">Processing saved Instagram post</p>
      <div class="activity-step">${statusLabels.saved}</div>
    </div>
    <span class="activity-state">${statusLabels.saved}</span>
  `;
  activityList.prepend(item);

  try {
    const response = await fetch(`${apiBase}/api/scraps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl: url })
    });
    if (!response.ok) throw new Error("The Scrap API is not available");
    const job = await response.json();
    const timer = window.setInterval(async () => {
      const statusResponse = await fetch(`${apiBase}/api/scraps/${job.id}`);
      const current = await statusResponse.json();
      item.querySelector(".activity-step").textContent = current.step;
      item.querySelector(".activity-state").textContent = statusLabels[current.status] || current.status;
      if (["ready", "review", "failed"].includes(current.status)) {
        window.clearInterval(timer);
        if (current.status === "review") addReviewButton(item, current);
        renderJobProducts(current);
      }
    }, 900);
  } catch (error) {
    item.querySelector(".activity-step").textContent = "Could not connect";
    item.querySelector(".activity-state").textContent = "Failed";
  }
}

function switchView(view) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelector("#scrapbookView").classList.toggle("is-visible", view === "scrapbook");
  document.querySelector("#activityView").classList.toggle("is-visible", view === "activity");
}

scraps.forEach(renderScrap);
scraps.forEach((scrap) => renderActivity(scrap, "ready"));
loadSavedJobs();

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

captureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = captureUrl.value.trim();
  if (!url) return;
  simulateCapture(url);
  captureUrl.value = "";
});
document.querySelector("#sheetClose").addEventListener("click", () => {
  mobileSheet.classList.remove("is-open");
  mobileSheet.setAttribute("aria-hidden", "true");
});
