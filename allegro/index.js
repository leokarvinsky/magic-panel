// allegro/index.js
require('dotenv').config();

const axios = require('axios');
const { saveAllegroReturn } = require('../server/returns');
const { getAccessToken } = require('./oauth');
const { pool } = require('../server/db');

async function testDbConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('✅ Połączenie z returns_panel OK');
  } catch (e) {
    console.error('❌ Problem z połączeniem do returns_panel:', e.message);
  }
}

async function fetchCustomerReturnsForDate(date) {
  const token = await getAccessToken();

  const from = `${date}T00:00:00Z`;
  const to = `${date}T23:59:59Z`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.allegro.beta.v1+json',
    'Content-Type': 'application/vnd.allegro.beta.v1+json',
    'Accept-Language': 'pl-PL'
  };

  console.log('🔎 Wywołanie Allegro /order/customer-returns z nagłówkami:');
  console.log(headers);

  const res = await axios.get(
    'https://api.allegro.pl/order/customer-returns',
    {
      headers,
      params: {
        'createdAt.gte': from,
        'createdAt.lte': to,
        limit: 100
      },
      validateStatus: () => true
    }
  );

  if (res.status < 200 || res.status >= 300) {
    const msg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`Allegro API HTTP ${res.status}: ${msg}`);
  }

  const data = res.data;
  return Array.isArray(data.customerReturns) ? data.customerReturns : [];
}

async function syncReturnsForDate(date) {
  console.log(`🔄 Synchronizuję zwroty Allegro dla daty ${date}...`);

  const returns = await fetchCustomerReturnsForDate(date);
  console.log(`✅ API Allegro zwróciło ${returns.length} zwrot(ów)`);

  let saved = 0;
  for (const r of returns) {
    try {
      await saveAllegroReturn(r);
      saved++;
    } catch (e) {
      console.error(`❌ Błąd zapisu zwrotu ${r.id}: ${e.message}`);
    }
  }

  console.log(`📊 Zapisano/uzupełniono w bazie ${saved} zwrot(ów)`);
}

function getTodayIsoDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function main() {
  try {
    const dateArg = process.argv[2];
    const date = dateArg || getTodayIsoDate();

    console.log(`📅 Data synchronizacji: ${date}`);

    await testDbConnection();
    await syncReturnsForDate(date);
    process.exit(0);
  } catch (e) {
    console.error('❌ Błąd główny:', e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncReturnsForDate
};
