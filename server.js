const express    = require('express')
const Database   = require('better-sqlite3')
const nodemailer = require('nodemailer')
const crypto     = require('crypto')
const path       = require('path')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── DATABASE SETUP ─────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bookings.db')
const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id           TEXT PRIMARY KEY,
    created_at   TEXT DEFAULT (datetime('now')),
    client_name  TEXT NOT NULL,
    client_phone TEXT,
    service      TEXT NOT NULL,
    notes        TEXT,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    status       TEXT DEFAULT 'confirmed'
  )
`)

// ── ADMIN AUTH MIDDLEWARE ──────────────────────────────────────────
function adminOnly(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (token && token === process.env.ADMIN_SECRET) return next()
  res.status(401).json({ error: 'Unauthorized' })
}

// ── PUBLIC API ─────────────────────────────────────────────────────

// GET /api/slots?date=YYYY-MM-DD  →  ["9:00 AM", "10:30 AM", ...]
app.get('/api/slots', (req, res) => {
  const { date } = req.query
  if (!date) return res.json([])
  const rows = db.prepare(
    "SELECT booking_time FROM bookings WHERE booking_date = ? AND status = 'confirmed'"
  ).all(date)
  res.json(rows.map(r => r.booking_time))
})

// POST /api/bookings  →  save a new booking
app.post('/api/bookings', (req, res) => {
  const { client_name, client_phone, service, notes, booking_date, booking_time } = req.body

  if (!client_name || !service || !booking_date || !booking_time)
    return res.status(400).json({ error: 'Missing required fields' })

  // Double-check slot is still free (prevents race condition)
  const conflict = db.prepare(
    "SELECT id FROM bookings WHERE booking_date = ? AND booking_time = ? AND status = 'confirmed'"
  ).get(booking_date, booking_time)
  if (conflict) return res.status(409).json({ error: 'That time was just booked. Please choose another.' })

  const id = crypto.randomUUID()
  db.prepare(
    "INSERT INTO bookings (id, client_name, client_phone, service, notes, booking_date, booking_time) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, client_name, client_phone || null, service, notes || null, booking_date, booking_time)

  // Fire-and-forget email to barber
  sendEmail(client_name, client_phone, service, notes, booking_date, booking_time)

  res.json({ success: true, id })
})

// ── ADMIN API ──────────────────────────────────────────────────────

// GET /api/admin/bookings  →  all bookings
app.get('/api/admin/bookings', adminOnly, (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM bookings ORDER BY booking_date ASC, booking_time ASC"
  ).all()
  res.json(rows)
})

// PATCH /api/admin/bookings/:id  →  update status
app.patch('/api/admin/bookings/:id', adminOnly, (req, res) => {
  const { status } = req.body
  const allowed = ['confirmed', 'completed', 'cancelled']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, req.params.id)
  res.json({ success: true })
})

// ── EMAIL ──────────────────────────────────────────────────────────
async function sendEmail(name, phone, service, notes, date, time) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    })

    const to = process.env.BARBER_EMAIL || process.env.EMAIL_USER

    await transporter.sendMail({
      from: `"Ice Cold Cutz Bookings" <${process.env.EMAIL_USER}>`,
      to,
      subject: `🗓 New Booking — ${name} — ${date} at ${time}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#04080f;color:#fff;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#00d4ff,#0099cc);padding:24px;text-align:center;">
            <h2 style="margin:0;color:#04080f;letter-spacing:3px;text-transform:uppercase;">❄️ New Booking</h2>
          </div>
          <div style="padding:32px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">CLIENT</td><td style="padding:10px 0;font-weight:700;">${name}</td></tr>
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">PHONE</td><td style="padding:10px 0;">${phone || 'Not provided'}</td></tr>
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">SERVICE</td><td style="padding:10px 0;">${service}</td></tr>
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">DATE</td><td style="padding:10px 0;font-weight:700;">${date}</td></tr>
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">TIME</td><td style="padding:10px 0;font-weight:700;">${time}</td></tr>
              <tr><td style="padding:10px 0;color:#4dd0e1;font-size:12px;letter-spacing:2px;text-transform:uppercase;">NOTES</td><td style="padding:10px 0;font-style:italic;">${notes || 'None'}</td></tr>
            </table>
            ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#04080f;text-decoration:none;font-weight:900;letter-spacing:2px;text-transform:uppercase;padding:12px 28px;border-radius:30px;">📞 Call Client</a>` : ''}
          </div>
        </div>
      `
    })
    console.log(`Email sent for booking: ${name} on ${date} at ${time}`)
  } catch(e) {
    console.error('Email error:', e.message)
  }
}

// ── START SERVER ───────────────────────────────────────────────────
const PORT = process.env.PORT || 8080
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✂  Ice Cold Cutz running on port ${PORT}`)
  console.log(`   DB: ${DB_PATH}`)
  console.log(`   Email: ${process.env.EMAIL_USER ? 'configured' : 'not configured'}`)
})
