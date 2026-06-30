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
let clients = []; // [{id, name, rate, posts:[{id,title,qty,price}], createdAt}]
const openCards = new Set();

/* ---------------- dom refs ---------------- */
const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userPhoto = document.getElementById("userPhoto");
const userName = document.getElementById("userName");

const addClientBtn = document.getElementById("addClientBtn");
const emptyAddBtn = document.getElementById("emptyAddBtn");
const emptyState = document.getElementById("emptyState");
const clientList = document.getElementById("clientList");
const grandSummary = document.getElementById("grandSummary");

const clientModal = document.getElementById("clientModal");
const clientModalTitle = document.getElementById("clientModalTitle");
const clientForm = document.getElementById("clientForm");
const clientNameInput = document.getElementById("clientNameInput");
const clientRateInput = document.getElementById("clientRateInput");

const postModal = document.getElementById("postModal");
const postModalTitle = document.getElementById("postModalTitle");
const postForm = document.getElementById("postForm");
const postTitleInput = document.getElementById("postTitleInput");
const postQtyInput = document.getElementById("postQtyInput");
const postPriceInput = document.getElementById("postPriceInput");

const confirmModal = document.getElementById("confirmModal");
const confirmTitle = document.getElementById("confirmTitle");
const confirmBody = document.getElementById("confirmBody");
const confirmActionBtn = document.getElementById("confirmActionBtn");

const toastEl = document.getElementById("toast");

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
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
}

let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2200);
}

function openModal(el) {
  el.classList.remove("hidden");
}
function closeModal(el) {
  el.classList.add("hidden");
}
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeModal(clientModal);
    closeModal(postModal);
    closeModal(confirmModal);
  });
});
[clientModal, postModal, confirmModal].forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
});

function clientTotal(client) {
  return (client.posts || []).reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
}
function postCount(client) {
  return (client.posts || []).reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
}

/* ---------------- auth ---------------- */
googleSignInBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error(err);
    showToast("Sign-in failed. Try again.");
  }
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
    showToast("Couldn't sign out. Try again.");
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    userPhoto.src = user.photoURL || "";
    userPhoto.alt = user.displayName || "User";
    userName.textContent = user.displayName || user.email || "Account";
    subscribeClients();
  } else {
    currentUser = null;
    if (clientsUnsub) clientsUnsub();
    clients = [];
    loginScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
  }
});

/* ---------------- firestore: clients ---------------- */
function clientsCol() {
  return collection(db, "users", currentUser.uid, "clients");
}

function subscribeClients() {
  if (clientsUnsub) clientsUnsub();
  const q = query(clientsCol(), orderBy("createdAt", "desc"));
  clientsUnsub = onSnapshot(
    q,
    (snap) => {
      clients = snap.docs.map((d) => ({ id: d.id, posts: [], ...d.data() }));
      render();
    },
    (err) => {
      console.error(err);
      showToast("Couldn't load your data.");
    }
  );
}

async function createClient(name, rate) {
  await addDoc(clientsCol(), {
    name,
    rate: rate || 0,
    posts: [],
    createdAt: serverTimestamp()
  });
}

async function deleteClient(clientId) {
  await deleteDoc(doc(db, "users", currentUser.uid, "clients", clientId));
}

async function savePosts(clientId, posts) {
  await updateDoc(doc(db, "users", currentUser.uid, "clients", clientId), { posts });
}

/* ---------------- rendering ---------------- */
function render() {
  const hasClients = clients.length > 0;
  emptyState.classList.toggle("hidden", hasClients);
  clientList.classList.toggle("hidden", !hasClients);

  if (!hasClients) {
    clientList.innerHTML = "";
    grandSummary.textContent = "No clients yet — add your first one.";
    return;
  }

  const grandTotal = clients.reduce((sum, c) => sum + clientTotal(c), 0);
  grandSummary.textContent = `${clients.length} client${clients.length === 1 ? "" : "s"} · total tracked PKR ${money(grandTotal)}`;

  clientList.innerHTML = clients.map((c) => renderClientCard(c)).join("");

  // wire up events after render
  clients.forEach((c) => wireClientCard(c));
}

function renderClientCard(client) {
  const total = clientTotal(client);
  const count = postCount(client);
  const isOpen = openCards.has(client.id);
  const posts = client.posts || [];

  return `
  <section class="client-card glass ${isOpen ? "open" : ""}" data-client-id="${client.id}">
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
          <button class="icon-btn" data-delete-client="${client.id}" title="Delete client">✕</button>
        </div>
        <div class="client-total-amt">PKR ${money(total)}</div>
        <div class="chevron">▾</div>
      </div>
    </div>
    <div class="client-body">
      <div class="client-body-inner">
        ${
          posts.length
            ? posts.map((p) => renderPostRow(client, p)).join("")
            : `<div class="no-posts">No posts logged yet for this client.</div>`
        }
        <button class="add-post-btn" data-add-post="${client.id}">+ Add post</button>
        <div class="client-footer-total">
          <span>Grand total for ${escapeHtml(client.name)}</span>
          <span>PKR ${money(total)}</span>
        </div>
      </div>
    </div>
  </section>`;
}

function renderPostRow(client, post) {
  const lineTotal = (Number(post.qty) || 0) * (Number(post.price) || 0);
  return `
  <div class="post-row" data-post-id="${post.id}">
    <div class="post-title" title="${escapeHtml(post.title)}">${escapeHtml(post.title)}</div>
    <div class="stepper">
      <button type="button" data-step="-1" data-client="${client.id}" data-post="${post.id}" aria-label="Decrease quantity">−</button>
      <span>${Number(post.qty) || 0}</span>
      <button type="button" data-step="1" data-client="${client.id}" data-post="${post.id}" aria-label="Increase quantity">+</button>
    </div>
    <div class="post-line-total">PKR ${money(lineTotal)}</div>
    <div class="post-row-actions">
      <button class="icon-btn" data-edit-post="${post.id}" data-client="${client.id}" title="Edit post">✎</button>
      <button class="icon-btn" data-delete-post="${post.id}" data-client="${client.id}" title="Delete post">✕</button>
    </div>
  </div>`;
}

function wireClientCard(client) {
  const card = clientList.querySelector(`.client-card[data-client-id="${client.id}"]`);
  if (!card) return;

  card.querySelector(`[data-toggle="${client.id}"]`).addEventListener("click", (e) => {
    if (e.target.closest("[data-delete-client]")) return;
    if (openCards.has(client.id)) openCards.delete(client.id);
    else openCards.add(client.id);
    render();
  });

  const delBtn = card.querySelector(`[data-delete-client="${client.id}"]`);
  if (delBtn) {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      askConfirm(
        "Delete client?",
        `This removes "${client.name}" and all of its logged posts. This can't be undone.`,
        () => deleteClient(client.id).then(() => showToast("Client deleted"))
      );
    });
  }

  const addPostBtn = card.querySelector(`[data-add-post="${client.id}"]`);
  if (addPostBtn) {
    addPostBtn.addEventListener("click", () => openPostModal(client, null));
  }

  card.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.dataset.step);
      const postId = btn.dataset.post;
      stepQty(client.id, postId, delta);
    });
  });

  card.querySelectorAll("[data-edit-post]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const post = (client.posts || []).find((p) => p.id === btn.dataset.editPost);
      if (post) openPostModal(client, post);
    });
  });

  card.querySelectorAll("[data-delete-post]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const postId = btn.dataset.deletePost;
      const post = (client.posts || []).find((p) => p.id === postId);
      askConfirm(
        "Delete post?",
        `This removes "${post ? post.title : "this post"}" from ${client.name}.`,
        () => {
          const newPosts = (client.posts || []).filter((p) => p.id !== postId);
          savePosts(client.id, newPosts).then(() => showToast("Post deleted"));
        }
      );
    });
  });
}

function stepQty(clientId, postId, delta) {
  const client = clients.find((c) => c.id === clientId);
  if (!client) return;
  const posts = (client.posts || []).map((p) => {
    if (p.id !== postId) return p;
    const next = Math.max(0, (Number(p.qty) || 0) + delta);
    return { ...p, qty: next };
  });
  savePosts(clientId, posts);
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

clientForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = clientNameInput.value.trim();
  const rate = parseFloat(clientRateInput.value) || 0;
  if (!name) return;
  const submitBtn = clientForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await createClient(name, rate);
    closeModal(clientModal);
    showToast("Client added");
  } catch (err) {
    console.error(err);
    showToast("Couldn't save client.");
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------------- post modal ---------------- */
let postModalContext = { clientId: null, postId: null };

function openPostModal(client, post) {
  postModalContext = { clientId: client.id, postId: post ? post.id : null };
  postModalTitle.textContent = post ? "Edit post" : "Add post";
  postTitleInput.value = post ? post.title : "";
  postQtyInput.value = post ? post.qty : 1;
  postPriceInput.value = post ? post.price : (client.rate || "");
  openModal(postModal);
  setTimeout(() => postTitleInput.focus(), 50);
  openCards.add(client.id);
}

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { clientId, postId } = postModalContext;
  const client = clients.find((c) => c.id === clientId);
  if (!client) return;

  const title = postTitleInput.value.trim();
  const qty = Math.max(0, parseInt(postQtyInput.value, 10) || 0);
  const price = Math.max(0, parseFloat(postPriceInput.value) || 0);
  if (!title) return;

  let posts = client.posts || [];
  if (postId) {
    posts = posts.map((p) => (p.id === postId ? { ...p, title, qty, price } : p));
  } else {
    posts = [...posts, { id: crypto.randomUUID(), title, qty, price }];
  }

  const submitBtn = postForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await savePosts(clientId, posts);
    closeModal(postModal);
    showToast(postId ? "Post updated" : "Post added");
  } catch (err) {
    console.error(err);
    showToast("Couldn't save post.");
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------------- confirm modal ---------------- */
let confirmAction = null;
function askConfirm(title, body, action) {
  confirmTitle.textContent = title;
  confirmBody.textContent = body;
  confirmAction = action;
  openModal(confirmModal);
}
confirmActionBtn.addEventListener("click", async () => {
  if (confirmAction) {
    confirmActionBtn.disabled = true;
    try {
      await confirmAction();
    } catch (err) {
      console.error(err);
      showToast("Something went wrong.");
    } finally {
      confirmActionBtn.disabled = false;
    }
  }
  closeModal(confirmModal);
});

/* ---------------- esc to close modals ---------------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal(clientModal);
    closeModal(postModal);
    closeModal(confirmModal);
  }
});
