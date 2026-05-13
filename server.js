const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Storage setup ────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(UPLOADS_DIR, 'db.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ─── Multer (file uploads, max 50MB) ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: get your public base URL ────────────────────────────────────────
function getBaseUrl(req) {
  // On Render, use the render URL; locally use localhost
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ─── POST /upload — handle file or URL ───────────────────────────────────────
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const db = loadDB();
    const id = uuidv4().slice(0, 10);

    if (req.file) {
      // File upload
      db[id] = {
        type: 'file',
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        createdAt: new Date().toISOString()
      };
    } else if (req.body.url) {
      // URL redirect
      let url = req.body.url.trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      db[id] = {
        type: 'url',
        url,
        createdAt: new Date().toISOString()
      };
    } else {
      return res.status(400).json({ error: 'No file or URL provided.' });
    }

    saveDB(db);

    const fileUrl = `${getBaseUrl(req)}/f/${id}`;
    const qrDataUrl = await QRCode.toDataURL(fileUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#0f0f0f', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    });

    res.json({
      id,
      fileUrl,
      qrDataUrl,
      name: req.file ? req.file.originalname : req.body.url,
      type: req.file ? 'file' : 'url'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /f/:id — serve the file or redirect ─────────────────────────────────
app.get('/f/:id', (req, res) => {
  const db = loadDB();
  const entry = db[req.params.id];

  if (!entry) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>❌ Not Found</h2><p>This QR link is invalid or the file was deleted.</p>
      </body></html>
    `);
  }

  if (entry.type === 'url') {
    return res.redirect(entry.url);
  }

  if (entry.type === 'file') {
    const filePath = path.join(UPLOADS_DIR, entry.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found on server.');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${entry.originalName}"`);
    res.setHeader('Content-Type', entry.mimetype || 'application/octet-stream');
    return res.sendFile(filePath);
  }
});

// ─── GET /admin — list all entries ───────────────────────────────────────────
app.get('/admin', (req, res) => {
  const db = loadDB();
  const entries = Object.entries(db).map(([id, e]) => ({ id, ...e }));
  res.json(entries.reverse());
});

// ─── DELETE /admin/:id — delete an entry ─────────────────────────────────────
app.delete('/admin/:id', (req, res) => {
  const db = loadDB();
  const entry = db[req.params.id];
  if (!entry) return res.status(404).json({ error: 'Not found' });

  if (entry.type === 'file') {
    const filePath = path.join(UPLOADS_DIR, entry.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  delete db[req.params.id];
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`QR Vault running on port ${PORT}`);
});
