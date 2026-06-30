# Ledger — Client & Post Tracker

A single-page dashboard for tracking clients, posts, quantities, and totals — with Google sign-in via Firebase.

## Files
- `index.html` — page structure
- `style.css` — glassmorphism theme, fully responsive
- `app.js` — app logic (auth + Firestore CRUD + rendering)
- `firebase-config.js` — your Firebase project config (already filled in)
- `firestore.rules` — recommended security rules (see below)

## Run it
No build step needed. Just host these files as static files:
- Easiest: Firebase Hosting (`firebase init hosting`, then `firebase deploy`), or
- Any static host (Netlify, Vercel, GitHub Pages), or
- Locally: `npx serve .` inside the folder, then open the printed localhost URL.

Note: opening `index.html` directly via `file://` won't work because Google sign-in popups require `http://` or `https://`. Use a local server or deploy it.

## One-time Firebase setup
1. **Authorized domains** — In Firebase Console → Authentication → Settings → Authorized domains, add whatever domain you deploy to (localhost is included by default).
2. **Security rules** — Your Firestore is in test mode (open to anyone). Before going live, paste the contents of `firestore.rules` into Firebase Console → Firestore Database → Rules, then Publish. This restricts every user to only their own data.

## How it works
- Sign in with Google. You'll stay signed in on this device until you tap "Sign out."
- Add a client. Optionally set a default price per post — it'll pre-fill new posts for that client (you can still override it per post).
- Inside a client, add posts by title. Use the **+ / −** stepper to bump quantity up or down any time, even mid-project, since the number of posts isn't fixed upfront.
- Each post shows quantity × price as its line total. The client card shows a running grand total, and the page header shows your total across every client.
- Everything saves to Firestore in real time — refresh, switch devices (once signed in), and it's all still there.

## Data structure
Each user's data lives at:
```
users/{uid}/clients/{clientId}
  name: string
  rate: number          // default price per post (optional)
  posts: [
    { id, title, qty, price }
  ]
  createdAt: timestamp
```
