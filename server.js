const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Cloudinary configuration ─────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── In-memory metadata (persisted to Cloudinary as raw JSON) ─────────────────
const META_ID = 'qr-vault-meta/db';
let db = {};

async function loadDB() {
  try {
    const info = await cloudinary.api.resource(META_ID, { resource_type: 'raw' });
    const res = await fetch(info.secure_url + '?v=' + Date.now());
    if (res.ok) {
      db = await res.json();
      console.log(`✓ Loaded ${Object.keys(db).length} entries from Cloudinary`);
    }
  } catch {
    console.log('No existing metadata in Cloudinary — starting fresh');
    db = {};
  }
}

async function saveDB() {
  try {
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(db, null, 2)).toString('base64')}`;
    await cloudinary.uploader.upload(uri, {
      public_id: META_ID,
      resource_type: 'raw',
      overwrite: true,
      invalidate: true,
    });
  } catch (err) {
    console.error('⚠ Failed to persist metadata:', err.message);
  }
}

// ─── Multer — memory only, never writes to disk ──────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function shortId() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += c[Math.floor(Math.random() * c.length)];
  return db[id] ? shortId() : id;
}

// ─── POST /upload — file or URL ───────────────────────────────────────────────
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const id = shortId();

    if (req.file) {
      const ext = path.extname(req.file.originalname);
      const pubId = `qr-vault/${uuidv4()}${ext}`;

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { public_id: pubId, resource_type: 'raw', overwrite: false },
          (e, r) => (e ? reject(e) : resolve(r))
        );
        stream.end(req.file.buffer);
      });

      db[id] = {
        type: 'file',
        originalName: req.file.originalname,
        cloudinaryPublicId: result.public_id,
        cloudinaryUrl: result.secure_url,
        resourceType: result.resource_type,
        mimetype: req.file.mimetype,
        size: req.file.size,
        createdAt: new Date().toISOString(),
      };
    } else if (req.body.url) {
      let url = req.body.url.trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      db[id] = { type: 'url', url, createdAt: new Date().toISOString() };
    } else {
      return res.status(400).json({ error: 'No file or URL provided.' });
    }

    await saveDB();

    const fileUrl = `${getBaseUrl(req)}/f/${id}`;
    const qrDataUrl = await QRCode.toDataURL(fileUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#0f0f0f', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });

    res.json({
      id,
      fileUrl,
      qrDataUrl,
      name: req.file ? req.file.originalname : req.body.url,
      type: req.file ? 'file' : 'url',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /f/:id — redirect to Cloudinary URL or external URL ─────────────────
app.get('/f/:id', (req, res) => {
  const entry = db[req.params.id];
  if (!entry) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>❌ Not Found</h2><p>This QR link is invalid or the file was deleted.</p>
      </body></html>
    `);
  }
  if (entry.type === 'url') return res.redirect(entry.url);
  if (entry.type === 'file') return res.redirect(entry.cloudinaryUrl);
});

// ─── GET /admin — list all entries ────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const entries = Object.entries(db).map(([id, e]) => ({ id, ...e }));
  res.json(entries.reverse());
});

// ─── DELETE /admin/:id — remove from Cloudinary + metadata ────────────────────
app.delete('/admin/:id', async (req, res) => {
  const entry = db[req.params.id];
  if (!entry) return res.status(404).json({ error: 'Not found' });

  if (entry.type === 'file' && entry.cloudinaryPublicId) {
    try {
      await cloudinary.uploader.destroy(entry.cloudinaryPublicId, {
        resource_type: entry.resourceType || 'raw',
      });
    } catch (err) {
      console.error('Cloudinary delete error:', err.message);
    }
  }

  delete db[req.params.id];
  await saveDB();
  res.json({ ok: true });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  await loadDB();
  app.listen(PORT, () => console.log(`QR Vault running on port ${PORT}`));
})();
