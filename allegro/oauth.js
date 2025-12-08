// allegro/oauth.js
require('dotenv').config();
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '.allegro_token.json');

let accessToken = null;
let refreshToken = null;
let expiresAt = 0;

function getBasicAuthHeader() {
  const { ALLEGRO_CLIENT_ID, ALLEGRO_CLIENT_SECRET } = process.env;
  const base = Buffer.from(`${ALLEGRO_CLIENT_ID}:${ALLEGRO_CLIENT_SECRET}`).toString('base64');
  return `Basic ${base}`;
}

function loadTokenFromFile() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return;
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const json = JSON.parse(raw);
    accessToken = json.access_token || null;
    refreshToken = json.refresh_token || null;
    expiresAt = json.expires_at || 0;
  } catch (e) {}
}

function saveTokenToFile(data) {
  try {
    const payload = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken || null,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000
    };
    accessToken = payload.access_token;
    refreshToken = payload.refresh_token;
    expiresAt = payload.expires_at;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.error('Błąd zapisu tokena Allegro do pliku:', e.message);
  }
}

async function exchangeCodeForToken(code) {
  const body = qs.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.ALLEGRO_REDIRECT_URI
  });

  const res = await axios.post(
    'https://allegro.pl/auth/oauth/token',
    body,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: getBasicAuthHeader()
      }
    }
  );

  saveTokenToFile(res.data);
  console.log('exchangeCodeForToken OK – token Allegro zapisany do pliku');
  return res.data;
}

async function refreshAccessToken() {
  if (!refreshToken) {
    throw new Error('Brak refresh_token – zaloguj się ponownie przez /allegro/login.');
  }

  const body = qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const res = await axios.post(
    'https://allegro.pl/auth/oauth/token',
    body,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: getBasicAuthHeader()
      }
    }
  );

  saveTokenToFile(res.data);
  console.log('refreshAccessToken OK – odświeżono token Allegro');
  return res.data;
}

async function getAccessToken() {
  const now = Date.now();

  if (accessToken && now < expiresAt - 30000) {
    return accessToken;
  }

  if (!accessToken) {
    loadTokenFromFile();
    if (accessToken && now < expiresAt - 30000) {
      return accessToken;
    }
  }

  if (!refreshToken) {
    throw new Error('Brak refresh_token – najpierw wejdź na /allegro/login, aby zalogować się i zapisać token.');
  }

  await refreshAccessToken();
  return accessToken;
}

module.exports = {
  exchangeCodeForToken,
  getAccessToken
};
