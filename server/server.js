const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const { pool } = require('./db');
const { exchangeCodeForToken } = require('../allegro/oauth');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLEGRO_CLIENT_ID = process.env.ALLEGRO_CLIENT_ID;
const ALLEGRO_REDIRECT_URI = process.env.ALLEGRO_REDIRECT_URI || 'http://localhost:3000/allegro/callback';
const ALLEGRO_AUTH_URL = 'https://allegro.pl/auth/oauth/authorize';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/allegro/login', (req, res) => {
  if (!ALLEGRO_CLIENT_ID) {
    console.error('Brak ALLEGRO_CLIENT_ID w .env');
    return res.status(500).send('Brak konfiguracji Allegro (ALLEGRO_CLIENT_ID). Uzupełnij .env i zrestartuj serwer.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ALLEGRO_CLIENT_ID,
    redirect_uri: ALLEGRO_REDIRECT_URI,
    scope: 'allegro:api:orders:read allegro:api:sale:offers:read'
  });
  const url = `${ALLEGRO_AUTH_URL}?${params.toString()}`;
  console.log('AUTH URL:', url);
  res.redirect(url);
});

app.get('/allegro/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Brak parametru "code" w odpowiedzi Allegro.');
  }
  try {
    await exchangeCodeForToken(code);
    res.send('Autoryzacja Allegro zakończona – możesz zamknąć okno. Token zapisany i będzie używany do synchronizacji zwrotów.');
  } catch (err) {
    console.error('Błąd OAuth Allegro:', err.response?.status, err.response?.data || err.message);
    res.status(500).send('Błąd podczas wymiany kodu na token Allegro.');
  }
});

app.get('/api/returns', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM returns ORDER BY created_at_external DESC, created_at DESC`
    );
    if (!rows.length) return res.json([]);
    const ids = rows.map(r => r.id);
    const [itemsRows] = await pool.query(
      `SELECT * FROM return_items WHERE return_id IN (?) ORDER BY id ASC`,
      [ids]
    );
    const itemsById = {};
    for (const it of itemsRows) {
      if (!itemsById[it.return_id]) itemsById[it.return_id] = [];
      itemsById[it.return_id].push(it);
    }
    const result = rows.map(r => ({
      ...r,
      items: itemsById[r.id] || []
    }));
    res.json(result);
  } catch (err) {
    console.error('Błąd /api/returns:', err.message);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

app.post('/api/returns/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Nieprawidłowe ID' });
  }
  const { internal_status, erp_status } = req.body || {};
  try {
    const [existingRows] = await pool.query('SELECT * FROM returns WHERE id = ? LIMIT 1', [id]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Zwrot nie istnieje' });
    }
    const prev = existingRows[0];
    const newInternal = internal_status || prev.internal_status;
    const newErp = erp_status || prev.erp_status;
    await pool.query(
      `UPDATE returns
       SET internal_status = ?,
           erp_status = ?,
           erp_status_updated_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE erp_status_updated_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newInternal, newErp, erp_status || null, id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM returns WHERE id = ? LIMIT 1', [id]);
    if (!updatedRows.length) {
      return res.status(404).json({ error: 'Zwrot nie istnieje po aktualizacji' });
    }
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('Błąd /api/returns/:id/status:', err.message);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

app.listen(PORT, () => {
  console.log(`Serwer działa: http://localhost:${PORT}`);
  console.log(`Panel:       http://localhost:${PORT}/`);
});
