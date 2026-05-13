# QR Vault 🔲
### Your permanent, self-hosted QR code generator — no expiry, ever.

Upload a file or paste a URL → get a QR code PNG → scan it anywhere, anytime.
Because YOU host it, the QR codes never expire.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Where Files Are Stored](#where-files-are-stored)
3. [Security — What's Protected and What's Not](#security)
4. [Deploy to Render Step by Step](#deploy-to-render)
5. [Keeping It Always Awake](#keeping-it-awake)
6. [Upgrading Storage](#upgrading-storage)
7. [Running Locally](#running-locally)
8. [File Structure Explained](#file-structure)
9. [Troubleshooting](#troubleshooting)

---

## How It Works

```
You upload a file / paste a URL
        ↓
Server saves the file to disk, logs metadata to db.json
        ↓
Server generates a unique short ID  e.g. "a3f9bc12e1"
        ↓
A permanent link is created: https://your-app.onrender.com/f/a3f9bc12e1
        ↓
A QR code image is generated pointing to that link
        ↓
You download the QR PNG — scan it anytime, anywhere
        ↓
QR scan → hits your server → file downloads or URL opens
```

No third-party QR service involved. No expiry clock. Your server, your rules.

---

## Where Files Are Stored

This is the most important thing to understand. There are two separate things stored:

### 1. The actual files (PDFs, Excel, etc.)

**Location:** `/app/uploads/` on the Render server's persistent disk

When you add a Persistent Disk in Render (mounted at `/app/uploads`), files written there survive:
- Service restarts
- Code deploys
- Sleep and wake cycles
- App crashes

Files are renamed to a random UUID on upload (e.g. `f3a8c...uuid.pdf`) so the original filename is never exposed in any path.

**Capacity on free Render disk:** 1 GB total. That is roughly:
- Around 200 average PDFs at 5MB each
- Around 50 large Excel files at 20MB each
- Around 20 PowerPoint presentations at 50MB each

If you hit 1GB, new uploads will fail. You can delete old entries via the history panel or upgrade disk size.

### 2. The metadata (db.json)

**Location:** `/app/db.json` — a simple JSON file mapping each short ID to its info.

Example of what db.json contains:
```json
{
  "a3f9bc12e1": {
    "type": "file",
    "originalName": "report.pdf",
    "storedName": "3f2a9b...uuid.pdf",
    "mimetype": "application/pdf",
    "size": 1048576,
    "createdAt": "2025-01-01T10:00:00.000Z"
  },
  "b7d2ef45c9": {
    "type": "url",
    "url": "https://example.com",
    "createdAt": "2025-01-02T09:30:00.000Z"
  }
}
```

### ⚠️ The db.json Problem

By default, `db.json` lives in the app folder, NOT on the persistent disk. This means if Render ever rebuilds the app from scratch (rare but possible), `db.json` resets to empty. Your uploaded files on the disk still exist physically but QR links break because the metadata mapping is gone.

**The fix — move db.json onto the persistent disk. Change this one line in server.js:**

```js
// Find this line:
const DB_FILE = path.join(__dirname, 'db.json');

// Change it to:
const DB_FILE = path.join(UPLOADS_DIR, 'db.json');
```

Now both your files AND the metadata JSON live on the same persistent disk. Do this before your first real deploy.

---

## Security

### What IS protected by default

**Unguessable file links**
Each QR code uses a 10-character random alphanumeric ID. There are 36^10 which equals roughly 3.6 trillion possible combinations. No one can guess or brute-force a link.

**Original filenames are hidden**
Files on disk use UUID names. A visitor who somehow got server access would see `3f2a...uuid.pdf` not `my-salary-2025.pdf`.

**No directory browsing**
Express only serves files through the `/f/:id` route. There is no way to list or browse the uploads folder from the web.

---

### What is NOT protected and how to fix each

#### Problem 1 — Anyone with the link can download the file

If someone physically sees your QR code or gets hold of the URL, they can access the file with no login.

Is this a real risk? Only if you share the QR in a public place or someone intercepts it. The link itself is unguessable from the outside.

**Fix — Add password protection to the whole app:**

```bash
npm install express-basic-auth
```

Add this to `server.js` right after `const app = express();`:

```js
const basicAuth = require('express-basic-auth');

app.use(basicAuth({
  users: { 'yourname': 'yourpassword' },
  challenge: true,
  realm: 'QR Vault'
}));
```

Now every page including file downloads requires a username and password. Anyone scanning the QR will be prompted for credentials before the file downloads.

---

#### Problem 2 — The /admin endpoint is public

Anyone who knows your Render URL can visit `/admin` and see a JSON list of every file and link you have stored.

**Fix:** The basic auth above covers this automatically. Or scope it to just /admin:

```js
app.get('/admin', basicAuth({ users: { 'admin': 'secret' }, challenge: true }), (req, res) => {
  // existing admin handler code
});
```

---

#### Problem 3 — No file type restriction

By default anyone who can reach your upload page can upload any file type including HTML, JS, or executables. For personal use this is fine. If you ever share the upload page with others, restrict it.

**Fix — Add a file type filter in server.js:**

```js
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'text/plain', 'text/csv'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});
```

---

#### Problem 4 — db.json is not on the persistent disk

Already covered in the Storage section above. Apply the one-line fix before deploying.

---

### Security at a Glance

| Threat | Default | After Fixes |
|---|---|---|
| Strangers guessing your file links | Protected — trillions of combinations | Protected |
| Someone with the QR link accessing the file | Accessible — intended behavior | Lockable with basic auth |
| /admin listing all your files | Public — anyone can see | Protected with basic auth |
| Malicious file uploads | No restriction | Restricted with file type filter |
| Files surviving restarts | Protected with persistent disk | Protected |
| Metadata surviving app rebuilds | Not protected — db.json in app folder | Protected after moving to disk |

---

## Deploy to Render

### What you need before starting
- A GitHub account — https://github.com (free)
- A Render account — https://render.com (free)

---

### Step 1 — Get the code onto GitHub

**If you are comfortable with the terminal:**
```bash
cd qr-vault
git init
git add .
git commit -m "Initial QR Vault commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/qr-vault.git
git push -u origin main
```

**If you prefer the browser:**
1. Go to github.com and click New repository
2. Name it `qr-vault`, set visibility to Private, click Create repository
3. On the next screen click "uploading an existing file"
4. Drag all the files from the unzipped folder into the browser
5. Click Commit changes

---

### Step 2 — Apply the db.json fix first

Before deploying, open `server.js` and change:
```js
const DB_FILE = path.join(__dirname, 'db.json');
```
to:
```js
const DB_FILE = path.join(UPLOADS_DIR, 'db.json');
```

Commit and push this change. This ensures your metadata is safe from day one.

---

### Step 3 — Create the Render Web Service

1. Log in at render.com
2. Click **New +** then **Web Service**
3. Click **Connect account** and authorize GitHub
4. Find your `qr-vault` repo and click Connect
5. Fill in the service settings:

| Setting | What to enter |
|---|---|
| Name | qr-vault |
| Region | Singapore or closest to you |
| Branch | main |
| Runtime | Node |
| Build Command | npm install |
| Start Command | npm start |
| Plan | Free |

6. Do NOT click Create yet — go to Step 4 first

---

### Step 4 — Add a Persistent Disk

This is the most critical step. Without it every file you upload is wiped when the service restarts.

1. Scroll down on the same service creation page to find the **Disk** section
   (If you already created the service, go to its page and click the Disks tab)
2. Click **Add Disk**
3. Enter:
   - Name: `qr-vault-data`
   - Mount Path: `/app/uploads`   ← must be exactly this, no trailing slash
   - Size: `1 GB`
4. Save

The disk is independent of your app. Even if you delete and recreate the service, you can reattach the existing disk and all your files will still be there.

---

### Step 5 — Set Environment Variables

1. Go to the **Environment** tab of your Render service
2. Click **Add Environment Variable** and add:

| Key | Value |
|---|---|
| BASE_URL | https://qr-vault.onrender.com |
| NODE_ENV | production |

Replace `qr-vault.onrender.com` with your actual URL shown at the top of the Render service page. It may have extra characters like `qr-vault-x7y2.onrender.com`.

---

### Step 6 — Deploy

1. Click **Manual Deploy** then **Deploy latest commit**
2. Watch the build log — it takes 1 to 2 minutes
3. When you see `QR Vault running on port 10000` the app is live
4. Visit your URL and try uploading a file

---

### Step 7 — Add Security (Recommended)

After confirming the app works, apply whichever security fixes you want from the Security section, commit, and push. Render will auto-deploy the update within a minute.

---

## Keeping It Awake

Render's free plan spins down your service after 15 minutes of no traffic. The next visitor waits about 30 seconds for a cold start. Your files are always safe on the disk — only the server process sleeps.

### Option A — UptimeRobot (Free, Easiest)

1. Sign up at https://uptimerobot.com (free)
2. Click **Add New Monitor**
3. Set these values:
   - Monitor Type: HTTP(s)
   - Friendly Name: QR Vault
   - URL: your Render app URL
   - Monitoring Interval: Every 5 minutes
4. Save

UptimeRobot pings your app every 5 minutes keeping it permanently awake. It also emails you if your app ever goes down. Completely free.

### Option B — Render Starter Plan ($7/month)

Keeps the service always on with no sleep, more RAM, faster response times. Worth it if you use this app daily or share it with others.

---

## Upgrading Storage

### Increase the Render Disk

Go to Render → your service → Disks → Edit → increase the size. Available on paid Render plans at $0.25 per GB per month.

### Move to Cloudinary (Free 25GB, Great for Documents)

Cloudinary gives you 25GB free with CDN delivery. Files are stored in the cloud and never tied to your server.

```bash
npm install cloudinary
```

Replace the multer disk storage with Cloudinary's upload stream, store the returned secure URL in db.json instead of a local filename, and redirect to that URL from the `/f/:id` route.

### Move to Backblaze B2 (10GB Free then $0.006 per GB)

Backblaze B2 is S3-compatible and much cheaper than AWS. Use the `@aws-sdk/client-s3` package pointed at Backblaze's endpoint. Good for large file volumes.

---

## Running Locally

```bash
# Enter the project folder
cd qr-vault

# Install dependencies
npm install

# Start the server
node server.js

# Open your browser to:
# http://localhost:3000
```

`BASE_URL` defaults to `http://localhost:3000` automatically when the environment variable is not set. No extra configuration needed for local testing.

---

## File Structure

```
qr-vault/
│
├── server.js
│   ├── POST /upload       Accepts file or URL, stores it, returns QR as data URL
│   ├── GET  /f/:id        Serves the file download or redirects to URL
│   ├── GET  /admin        Returns all stored entries as JSON
│   └── DELETE /admin/:id  Deletes an entry and its file from disk
│
├── package.json           Node.js dependencies and start scripts
│
├── render.yaml            Render Blueprint config for one-click deploys
│
├── .gitignore             Excludes node_modules, uploads, and db.json from git
│
├── public/
│   └── index.html         Complete frontend: tabs, drag-drop, QR display, history panel
│
├── uploads/               Auto-created on first run; mounted to Render disk
│   ├── db.json            Metadata store (after applying the fix to move it here)
│   └── 3f2a...uuid.pdf    Uploaded files with randomized names
│
└── db.json                Default location before applying the fix
```

**Dependencies:**

| Package | What it does |
|---|---|
| express | Web server and routing |
| multer | Handles multipart file upload parsing |
| qrcode | Generates QR code PNG images server-side, no third party |
| uuid | Creates random unique IDs for files and short links |

---

## Troubleshooting

**QR code scans but shows "Not Found"**
The db.json was likely reset. Apply the fix to move db.json into the uploads directory (persistent disk) and redeploy. Previously generated QR codes won't recover, but all future ones will be safe.

**Uploads fail with "File too large"**
Increase the multer file size limit in server.js. Change `50 * 1024 * 1024` to `100 * 1024 * 1024` for 100MB.

**First scan after a long gap takes 30 seconds**
Render free tier cold start. Set up UptimeRobot with a 5-minute ping interval to eliminate this completely.

**Works locally but not on Render**
Check that BASE_URL is set correctly in Render's Environment tab. The value must exactly match the URL Render assigned — copy it from the top of the service page.

**I need to delete all files and start fresh**
Go to the history panel and delete each entry. Or SSH into the Render service shell (available on paid plans) and run `rm /app/uploads/* && echo {} > /app/uploads/db.json`.

**I deleted my Render service — are my files gone?**
Render deletes disks when you delete the service unless you detach the disk first. Before deleting a service, go to the Disks tab and detach or download your data.

**Can I use a custom domain?**
Yes. Go to Render → Custom Domains → add your domain and follow the DNS instructions. Then update BASE_URL in Environment to your custom domain. Note: existing QR codes point to the old `.onrender.com` URL, so set up a redirect from the old URL to the new one or regenerate your QR codes.

---

## Quick Checklist Before Going Live

- [ ] Applied the db.json path fix — moved to UPLOADS_DIR
- [ ] Pushed code to a private GitHub repository
- [ ] Created Render Web Service with correct build and start commands
- [ ] Added Persistent Disk mounted at /app/uploads
- [ ] Set BASE_URL environment variable to your exact Render URL
- [ ] Deployed and tested one file upload end to end
- [ ] Tested one URL QR code end to end
- [ ] Set up UptimeRobot to keep the app awake
- [ ] Added express-basic-auth to protect /admin (at minimum)
- [ ] Tested scanning the QR from a phone
