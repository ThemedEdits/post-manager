// app.js
import { auth, googleProvider, db } from "./firebase-config.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- state ---------------- */
let currentUser = null;
let clientsUnsub = null;
let clients = [];
const openCards = new Set();
const cardEls = new Map();
const cardSig = new Map();
const pendingWrites = new Map();

// filter + sort state
let searchQuery = "";
let filterType = "all";   // "all" | "active" | "empty"
let sortBy = "newest";    // "newest"|"oldest"|"name-asc"|"name-desc"|"total-desc"|"total-asc"

/* ---------------- dom refs ---------------- */
const loginScreen   = document.getElementById("loginScreen");
const appEl         = document.getElementById("app");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const signOutBtn    = document.getElementById("signOutBtn");
const userPhoto     = document.getElementById("userPhoto");
const userName      = document.getElementById("userName");

const addClientBtn  = document.getElementById("addClientBtn");
const emptyAddBtn   = document.getElementById("emptyAddBtn");
const emptyState    = document.getElementById("emptyState");
const noResults     = document.getElementById("noResults");
const noResultsMsg  = document.getElementById("noResultsMsg");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const clientList    = document.getElementById("clientList");
const grandSummary  = document.getElementById("grandSummary");

const searchInput   = document.getElementById("searchInput");
const clearSearch   = document.getElementById("clearSearch");
const sortSelect    = document.getElementById("sortSelect");
const filterChips   = document.getElementById("filterChips");

const clientModal     = document.getElementById("clientModal");
const clientModalTitle = document.getElementById("clientModalTitle");
const clientForm      = document.getElementById("clientForm");
const clientNameInput = document.getElementById("clientNameInput");
const clientRateInput = document.getElementById("clientRateInput");

const postModal     = document.getElementById("postModal");
const postModalTitle = document.getElementById("postModalTitle");
const postForm      = document.getElementById("postForm");
const postTitleInput  = document.getElementById("postTitleInput");
const postQtyInput    = document.getElementById("postQtyInput");
const postPriceInput  = document.getElementById("postPriceInput");

const confirmModal    = document.getElementById("confirmModal");
const confirmTitle    = document.getElementById("confirmTitle");
const confirmBody     = document.getElementById("confirmBody");
const confirmActionBtn = document.getElementById("confirmActionBtn");

const toastEl = document.getElementById("toast");

/* ---------------- lucide helper ---------------- */
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

/* ---------------- helpers ---------------- */
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
}

let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function openModal(el) { el.classList.remove("hidden"); refreshIcons(); }
function closeModal(el) { el.classList.add("hidden"); }

document.querySelectorAll("[data-close-modal]").forEach(btn => {
  btn.addEventListener("click", () => {
    closeModal(clientModal);
    closeModal(postModal);
    closeModal(confirmModal);
  });
});
[clientModal, postModal, confirmModal].forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal(overlay);
  });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeModal(clientModal);
    closeModal(postModal);
    closeModal(confirmModal);
  }
});

function clientTotal(client) {
  return (client.posts || []).reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
}
function postCount(client) {
  return (client.posts || []).reduce((s, p) => s + (Number(p.qty) || 0), 0);
}

/* ---------------- filter + sort ---------------- */
function getFilteredSorted() {
  let list = clients.slice();

  // 1. text search
  const q = searchQuery.trim().toLowerCase();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q));

  // 2. chip filter
  if (filterType === "active") list = list.filter(c => (c.posts || []).length > 0);
  if (filterType === "empty")  list = list.filter(c => (c.posts || []).length === 0);

  // 3. sort
  list.sort((a, b) => {
    switch (sortBy) {
      case "oldest":     return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      case "name-asc":   return a.name.localeCompare(b.name);
      case "name-desc":  return b.name.localeCompare(a.name);
      case "total-desc": return clientTotal(b) - clientTotal(a);
      case "total-asc":  return clientTotal(a) - clientTotal(b);
      default:           return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0); // newest
    }
  });

  return list;
}

/* ---------------- toolbar events ---------------- */
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  clearSearch.classList.toggle("hidden", !searchQuery);
  render();
});

clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  clearSearch.classList.add("hidden");
  searchInput.focus();
  render();
});

sortSelect.addEventListener("change", () => {
  sortBy = sortSelect.value;
  render();
});

filterChips.addEventListener("click", e => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  filterType = chip.dataset.filter;
  filterChips.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
  chip.classList.add("chip-active");
  render();
});

clearFiltersBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  clearSearch.classList.add("hidden");
  filterType = "all";
  sortBy = "newest";
  sortSelect.value = "newest";
  filterChips.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
  filterChips.querySelector("[data-filter='all']").classList.add("chip-active");
  render();
});

/* ---------------- auth ---------------- */
googleSignInBtn.addEventListener("click", async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch (err) { console.error(err); showToast("Sign-in failed. Try again."); }
});

signOutBtn.addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (err) { console.error(err); showToast("Couldn't sign out."); }
});

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    userPhoto.src = user.photoURL || "";
    userPhoto.alt = user.displayName || "User";
    userName.textContent = user.displayName || user.email || "Account";
    subscribeClients();
    refreshIcons();
  } else {
    currentUser = null;
    if (clientsUnsub) clientsUnsub();
    clients = [];
    cardEls.clear();
    cardSig.clear();
    loginScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
  }
});

/* ---------------- firestore ---------------- */
function clientsCol() {
  return collection(db, "users", currentUser.uid, "clients");
}

function subscribeClients() {
  if (clientsUnsub) clientsUnsub();
  const q = query(clientsCol(), orderBy("createdAt", "desc"));
  clientsUnsub = onSnapshot(q,
    snap => {
      clients = snap.docs.map(d => ({ id: d.id, posts: [], ...d.data() }));
      render();
    },
    err => { console.error(err); showToast("Couldn't load your data."); }
  );
}

async function createClient(name, rate) {
  return addDoc(clientsCol(), { name, rate: rate || 0, posts: [], createdAt: serverTimestamp() });
}
async function deleteClient(clientId) {
  return deleteDoc(doc(db, "users", currentUser.uid, "clients", clientId));
}
async function savePosts(clientId, posts) {
  return updateDoc(doc(db, "users", currentUser.uid, "clients", clientId), { posts });
}

/* ---------------- rendering (diffed) ---------------- */
function render() {
  const hasClients = clients.length > 0;
  const filtered = getFilteredSorted();
  const hasResults = filtered.length > 0;
  const isFiltering = searchQuery.trim() !== "" || filterType !== "all";

  // grand summary always from all clients
  const grandTotal = clients.reduce((s, c) => s + clientTotal(c), 0);
  if (!hasClients) {
    grandSummary.textContent = "No clients yet — add your first one.";
  } else if (isFiltering) {
    grandSummary.textContent = `Showing ${filtered.length} of ${clients.length} client${clients.length === 1 ? "" : "s"} · grand total PKR ${money(grandTotal)}`;
  } else {
    grandSummary.textContent = `${clients.length} client${clients.length === 1 ? "" : "s"} · total tracked PKR ${money(grandTotal)}`;
  }

  // toolbar visibility — only show when there are clients
  document.getElementById("toolbar").classList.toggle("hidden", !hasClients);

  // states
  emptyState.classList.toggle("hidden", hasClients);
  noResults.classList.toggle("hidden", !hasClients || hasResults);
  clientList.classList.toggle("hidden", !hasResults);

  if (!hasResults) {
    if (hasClients && isFiltering) {
      noResultsMsg.textContent = searchQuery
        ? `No client named "${searchQuery}" found.`
        : "No clients match this filter.";
    }
    // clean up stale cards
    [...cardEls.keys()].forEach(id => {
      const el = cardEls.get(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    cardEls.clear();
    cardSig.clear();
    return;
  }

  const seenIds = new Set();
  let lastEl = null;

  filtered.forEach(client => {
    seenIds.add(client.id);
    const sig = JSON.stringify({ name: client.name, rate: client.rate, posts: client.posts, open: openCards.has(client.id) });
    let el = cardEls.get(client.id);

    if (!el) {
      el = htmlToEl(renderClientCard(client));
      cardEls.set(client.id, el);
      cardSig.set(client.id, sig);
    } else if (cardSig.get(client.id) !== sig) {
      const fresh = htmlToEl(renderClientCard(client));
      if (el.parentNode) el.replaceWith(fresh);
      el = fresh;
      cardEls.set(client.id, el);
      cardSig.set(client.id, sig);
    }

    const wantedNext = lastEl ? lastEl.nextElementSibling : clientList.firstElementChild;
    if (wantedNext !== el) {
      clientList.insertBefore(el, wantedNext && wantedNext.parentNode === clientList ? wantedNext : null);
    }
    lastEl = el;
  });

  // remove cards for clients no longer in filtered set
  [...cardEls.keys()].forEach(id => {
    if (!seenIds.has(id)) {
      const el = cardEls.get(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      cardEls.delete(id);
      cardSig.delete(id);
    }
  });

  refreshIcons();
}

function htmlToEl(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function renderClientCard(client) {
  const total = clientTotal(client);
  const count = postCount(client);
  const isOpen = openCards.has(client.id);
  const posts = client.posts || [];
  return `
  <section class="client-card surface ${isOpen ? "open" : ""}" data-client-id="${client.id}">
    <div class="client-card-head" data-toggle="${client.id}">
      <div class="client-id">
        <div class="client-avatar">${escapeHtml(initials(client.name))}</div>
        <div class="client-meta">
          <h3>${escapeHtml(client.name)}</h3>
          <span class="client-stat">${posts.length} post type${posts.length === 1 ? "" : "s"} · ${count} post${count === 1 ? "" : "s"} total</span>
        </div>
      </div>
      <div class="client-totals">
        <div class="client-card-actions">
          <button class="icon-btn" data-delete-client="${client.id}" title="Delete client">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
        <div class="client-total-amt">PKR ${money(total)}</div>
        <div class="chevron"><i data-lucide="chevron-down"></i></div>
      </div>
    </div>
    <div class="client-body">
      <div class="client-body-inner-wrap"><div class="client-body-inner">
        ${posts.length
          ? posts.map(p => renderPostRow(client, p)).join("")
          : `<div class="no-posts">No posts logged yet for this client.</div>`}
        <button class="add-post-btn" data-add-post="${client.id}">
          <i data-lucide="plus"></i> Add post
        </button>
        <div class="client-footer-total">
          <span>Grand total for ${escapeHtml(client.name)}</span>
          <span>PKR ${money(total)}</span>
        </div>
      </div></div>
    </div>
  </section>`;
}

function renderPostRow(client, post) {
  const lineTotal = (Number(post.qty) || 0) * (Number(post.price) || 0);
  return `
  <div class="post-row" data-post-id="${post.id}">
    <div class="post-title" title="${escapeHtml(post.title)}">${escapeHtml(post.title)}</div>
    <div class="stepper">
      <button type="button" data-step="-1" data-client="${client.id}" data-post="${post.id}" aria-label="Decrease">−</button>
      <span data-qty-for="${post.id}">${Number(post.qty) || 0}</span>
      <button type="button" data-step="1" data-client="${client.id}" data-post="${post.id}" aria-label="Increase">+</button>
    </div>
    <div class="post-line-total" data-total-for="${post.id}">PKR ${money(lineTotal)}</div>
    <div class="post-row-actions">
      <button class="icon-btn" data-edit-post="${post.id}" data-client="${client.id}" title="Edit post">
        <i data-lucide="pencil-line"></i>
      </button>
      <button class="icon-btn" data-delete-post="${post.id}" data-client="${client.id}" title="Delete post">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  </div>`;
}

/* ---------------- delegated event listener ---------------- */
clientList.addEventListener("click", e => {
  const stepBtn      = e.target.closest("[data-step]");
  const delClientBtn = e.target.closest("[data-delete-client]");
  const addPostBtn   = e.target.closest("[data-add-post]");
  const editPostBtn  = e.target.closest("[data-edit-post]");
  const delPostBtn   = e.target.closest("[data-delete-post]");
  const toggle       = e.target.closest("[data-toggle]");

  if (stepBtn) {
    stepQty(stepBtn.dataset.client, stepBtn.dataset.post, Number(stepBtn.dataset.step));
    return;
  }
  if (delClientBtn) {
    const client = clients.find(c => c.id === delClientBtn.dataset.deleteClient);
    if (!client) return;
    askConfirm("Delete client?",
      `This removes "${client.name}" and all its logged posts. This can't be undone.`,
      () => deleteClient(client.id).then(() => showToast("Client deleted")));
    return;
  }
  if (addPostBtn) {
    const client = clients.find(c => c.id === addPostBtn.dataset.addPost);
    if (client) openPostModal(client, null);
    return;
  }
  if (editPostBtn) {
    const client = clients.find(c => c.id === editPostBtn.dataset.client);
    const post   = client && (client.posts || []).find(p => p.id === editPostBtn.dataset.editPost);
    if (client && post) openPostModal(client, post);
    return;
  }
  if (delPostBtn) {
    const client = clients.find(c => c.id === delPostBtn.dataset.client);
    const postId = delPostBtn.dataset.deletePost;
    const post   = client && (client.posts || []).find(p => p.id === postId);
    if (!client) return;
    askConfirm("Delete post?",
      `This removes "${post ? post.title : "this post"}" from ${client.name}.`,
      () => {
        const newPosts = (client.posts || []).filter(p => p.id !== postId);
        savePosts(client.id, newPosts).then(() => showToast("Post deleted"));
      });
    return;
  }
  if (toggle && !e.target.closest("[data-delete-client]")) {
    const id = toggle.dataset.toggle;
    if (openCards.has(id)) openCards.delete(id);
    else openCards.add(id);
    const card = cardEls.get(id);
    if (card) card.classList.toggle("open");
    try {
      const prev = JSON.parse(cardSig.get(id) || "{}");
      cardSig.set(id, JSON.stringify({ ...prev, open: openCards.has(id) }));
    } catch (_) {}
  }
});

/* ---------------- stepper (instant UI + debounced write) ---------------- */
function stepQty(clientId, postId, delta) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  const post = (client.posts || []).find(p => p.id === postId);
  if (!post) return;

  post.qty = Math.max(0, (Number(post.qty) || 0) + delta);

  const card = cardEls.get(clientId);
  if (card) {
    const qtyEl    = card.querySelector(`[data-qty-for="${postId}"]`);
    const totalEl  = card.querySelector(`[data-total-for="${postId}"]`);
    if (qtyEl)   qtyEl.textContent  = post.qty;
    if (totalEl) totalEl.textContent = `PKR ${money(post.qty * (Number(post.price) || 0))}`;
    const total    = clientTotal(client);
    const amtEl    = card.querySelector(".client-total-amt");
    const footEl   = card.querySelector(".client-footer-total span:last-child");
    if (amtEl)  amtEl.textContent  = `PKR ${money(total)}`;
    if (footEl) footEl.textContent = `PKR ${money(total)}`;
  }

  const grandTotal = clients.reduce((s, c) => s + clientTotal(c), 0);
  const isFiltering = searchQuery.trim() !== "" || filterType !== "all";
  const filtered = getFilteredSorted();
  grandSummary.textContent = isFiltering
    ? `Showing ${filtered.length} of ${clients.length} client${clients.length === 1 ? "" : "s"} · grand total PKR ${money(grandTotal)}`
    : `${clients.length} client${clients.length === 1 ? "" : "s"} · total tracked PKR ${money(grandTotal)}`;

  try {
    const prev = JSON.parse(cardSig.get(clientId) || "{}");
    cardSig.set(clientId, JSON.stringify({ ...prev, posts: client.posts }));
  } catch (_) {}

  clearTimeout(pendingWrites.get(postId));
  pendingWrites.set(postId, setTimeout(() => {
    savePosts(clientId, client.posts).catch(err => {
      console.error(err); showToast("Couldn't save change.");
    });
    pendingWrites.delete(postId);
  }, 350));
}

/* ---------------- client modal ---------------- */
addClientBtn.addEventListener("click", () => openClientModal());
emptyAddBtn.addEventListener("click", () => openClientModal());

function openClientModal() {
  clientModalTitle.textContent = "Add client";
  clientNameInput.value = "";
  clientRateInput.value = "";
  openModal(clientModal);
  setTimeout(() => clientNameInput.focus(), 50);
}

clientForm.addEventListener("submit", async e => {
  e.preventDefault();
  const name = clientNameInput.value.trim();
  const rate = parseFloat(clientRateInput.value) || 0;
  if (!name) return;
  const btn = clientForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await createClient(name, rate);
    closeModal(clientModal);
    showToast("Client added");
  } catch (err) {
    console.error(err); showToast("Couldn't save client.");
  } finally { btn.disabled = false; }
});

/* ---------------- post modal ---------------- */
let postModalContext = { clientId: null, postId: null };

function openPostModal(client, post) {
  postModalContext = { clientId: client.id, postId: post ? post.id : null };
  postModalTitle.textContent = post ? "Edit post" : "Add post";
  postTitleInput.value  = post ? post.title : "";
  postQtyInput.value    = post ? post.qty   : 1;
  postPriceInput.value  = post ? post.price : (client.rate || "");
  openModal(postModal);
  setTimeout(() => postTitleInput.focus(), 50);
  openCards.add(client.id);
}

postForm.addEventListener("submit", async e => {
  e.preventDefault();
  const { clientId, postId } = postModalContext;
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  const title = postTitleInput.value.trim();
  const qty   = Math.max(0, parseInt(postQtyInput.value, 10) || 0);
  const price = Math.max(0, parseFloat(postPriceInput.value) || 0);
  if (!title) return;
  let posts = client.posts || [];
  if (postId) {
    posts = posts.map(p => p.id === postId ? { ...p, title, qty, price } : p);
  } else {
    posts = [...posts, { id: crypto.randomUUID(), title, qty, price }];
  }
  const btn = postForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await savePosts(clientId, posts);
    closeModal(postModal);
    showToast(postId ? "Post updated" : "Post added");
  } catch (err) {
    console.error(err); showToast("Couldn't save post.");
  } finally { btn.disabled = false; }
});

/* ---------------- confirm modal ---------------- */
let confirmAction = null;
function askConfirm(title, body, action) {
  confirmTitle.textContent = title;
  confirmBody.textContent  = body;
  confirmAction = action;
  openModal(confirmModal);
}
confirmActionBtn.addEventListener("click", async () => {
  if (confirmAction) {
    confirmActionBtn.disabled = true;
    try { await confirmAction(); }
    catch (err) { console.error(err); showToast("Something went wrong."); }
    finally { confirmActionBtn.disabled = false; }
  }
  closeModal(confirmModal);
});