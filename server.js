require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ====== statyczny frontend (public/) ======
app.use(express.static(path.join(__dirname, 'public')));

// ====== Połączenie z bazą returns_panel ======
const db = mysql.createPool({
  host:     process.env.DB_HOST || '127.0.0.1',
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'returns_panel',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Prosty healthcheck
app.get('/health', (req, res) => {
  res.send('magic-panel API działa');
});

// ======================================================================
// 1) LISTA ZGŁOSZEŃ – GET /api/returns
// ======================================================================
// opcjonalne query:
//  - type=RETURN|COMPLAINT
//  - has_photos=1
//  - page, pageSize
app.get('/api/returns', async (req, res) => {
  try {
    const { type, has_photos, page = 1, pageSize = 50 } = req.query;

    const limit = Number(pageSize) || 50;
    const offset = (Number(page) - 1) * limit;

    const where = [];
    const params = [];

    if (type === 'RETURN' || type === 'COMPLAINT') {
      where.push('rr.request_type = ?');
      params.push(type);
    }

    if (has_photos === '1') {
      where.push('EXISTS (SELECT 1 FROM return_photos rp WHERE rp.internal_return_number = rr.internal_return_number)');
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const sql = `
      SELECT
        rr.internal_return_number,
        rr.order_number,
        rr.shop_order_number,
        rr.request_type,
        rr.customer_name,
        rr.customer_email,
        MIN(rr.created_at) AS created_at,
        COUNT(*) AS products_count,
        SUM(rr.quantity) AS total_quantity,
        MAX(
          CASE WHEN rp.id IS NOT NULL THEN 1 ELSE 0 END
        ) AS has_photos
      FROM return_requests rr
      LEFT JOIN return_photos rp
        ON rp.internal_return_number = rr.internal_return_number
      ${whereSql}
      GROUP BY
        rr.internal_return_number,
        rr.order_number,
        rr.shop_order_number,
        rr.request_type,
        rr.customer_name,
        rr.customer_email
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?;
    `;

    params.push(limit, offset);

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error('Błąd w GET /api/returns:', err);
    res.status(500).json({ message: 'Błąd podczas pobierania listy zwrotów.' });
  }
});

// ======================================================================
// 2) SZCZEGÓŁY ZGŁOSZENIA – GET /api/returns/:internalReturnNumber
// ======================================================================
app.get('/api/returns/:internalReturnNumber', async (req, res) => {
  try {
    const { internalReturnNumber } = req.params;

    const [rows] = await db.query(
      `SELECT
         id,
         internal_return_number,
         order_number,
         shop_order_number,
         request_type,
         customer_email,
         customer_name,
         customer_phone,
         product_name,
         ean,
         quantity,
         reason_type,
         reason_comment,
         created_at
       FROM return_requests
       WHERE internal_return_number = ?`,
      [internalReturnNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Nie znaleziono zgłoszenia.' });
    }

    const [photos] = await db.query(
      `SELECT
         id,
         internal_return_number,
         product_ean,
         mime_type
       FROM return_photos
       WHERE internal_return_number = ?`,
      [internalReturnNumber]
    );

    const header = {
      internal_return_number: rows[0].internal_return_number,
      order_number:          rows[0].order_number,
      shop_order_number:     rows[0].shop_order_number,
      request_type:          rows[0].request_type,
      customer_email:        rows[0].customer_email,
      customer_name:         rows[0].customer_name,
      customer_phone:        rows[0].customer_phone,
      created_at:            rows[0].created_at
    };

    const items = rows.map(r => ({
      id:             r.id,
      product_name:   r.product_name,
      ean:            r.ean,
      quantity:       r.quantity,
      reason_type:    r.reason_type,
      reason_comment: r.reason_comment
    }));

    res.json({
      header,
      items,
      photos
    });
  } catch (err) {
    console.error('Błąd w GET /api/returns/:internalReturnNumber:', err);
    res.status(500).json({ message: 'Błąd podczas pobierania szczegółów zwrotu.' });
  }
});

// ======================================================================
// 3) POBRANIE ZDJĘCIA – GET /api/returns/:internalReturnNumber/photos/:photoId
// ======================================================================
app.get('/api/returns/:internalReturnNumber/photos/:photoId', async (req, res) => {
  try {
    const { internalReturnNumber, photoId } = req.params;

    const [rows] = await db.query(
      `SELECT mime_type, data
       FROM return_photos
       WHERE id = ? AND internal_return_number = ?`,
      [photoId, internalReturnNumber]
    );

    if (!rows.length) {
      return res.status(404).send('Brak zdjęcia');
    }

    const photo = rows[0];
    res.setHeader('Content-Type', photo.mime_type);
    res.send(photo.data);
  } catch (err) {
    console.error('Błąd w GET /api/returns/:internalReturnNumber/photos/:photoId:', err);
    res.status(500).send('Błąd podczas pobierania zdjęcia.');
  }
});

// ====== START ======
const PORT = process.env.PANEL_PORT || 3000;
app.listen(PORT, () => {
  console.log(`🧾 magic-panel API działa na porcie ${PORT}`);
});
