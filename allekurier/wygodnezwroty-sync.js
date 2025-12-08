require('dotenv').config();
const https = require('https');
const fs = require('fs');
const { saveWzwReturn } = require('../server/returns');
const { pool } = require('../server/db');

const CONFIG = {
  email: process.env.ALLEKURIER_EMAIL || process.env.WYGODNEZWROTY_EMAIL,
  password: process.env.ALLEKURIER_PASSWORD || process.env.WYGODNEZWROTY_PASSWORD,
  apiHost: 'api.allekurier.pl',
  loginPath: '/user/login',
  returnsEndpoint: process.env.RETURNS_ENDPOINT || '/fulfillment/order/sent',
  dateFromParam: process.env.DATE_FROM_PARAM || 'date',
  tokenFile: '.allekurier_token.json'
};

function getCurrentDate() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

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

async function login() {
  console.log('🔐 Logowanie do AlleKurier/Wygodne Zwroty...');
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: CONFIG.email,
      password: CONFIG.password
    });
    const options = {
      hostname: CONFIG.apiHost,
      path: CONFIG.loginPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            if (json.token) {
              console.log('✓ Zalogowano do AlleKurier');
              fs.writeFileSync(CONFIG.tokenFile, JSON.stringify({
                token: json.token,
                expires: Date.now() + (14 * 24 * 60 * 60 * 1000)
              }));
              resolve(json.token);
            } else {
              reject(new Error('Brak tokena w odpowiedzi'));
            }
          } catch (e) {
            reject(new Error(`Błąd parsowania: ${e.message}`));
          }
        } else {
          reject(new Error(`Błąd ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(postData);
    req.end();
  });
}

async function getToken() {
  if (fs.existsSync(CONFIG.tokenFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CONFIG.tokenFile, 'utf-8'));
      if (cached.expires > Date.now() && cached.token) {
        console.log('✓ Używam zapisanego tokena AlleKurier');
        return cached.token;
      }
    } catch (e) {}
  }
  return await login();
}

async function fetchReturns(token, date) {
  return new Promise((resolve, reject) => {
    const url = `${CONFIG.returnsEndpoint}?${CONFIG.dateFromParam}=${date}`;
    const options = {
      hostname: CONFIG.apiHost,
      path: url,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Błąd parsowania: ${e.message}`));
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error('TOKEN_EXPIRED'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.end();
  });
}

async function syncWzwReturnsForDate(date) {
  console.log('🔍 Wygodne Zwroty / AlleKurier - pobieranie zwrotów');
  console.log(`📅 Data: ${date}`);
  if (!CONFIG.email || !CONFIG.password) {
    console.error('\n❌ Brak danych logowania w .env!');
    console.error('Dodaj:\n  ALLEKURIER_EMAIL=...\n  ALLEKURIER_PASSWORD=...\n');
    process.exit(1);
  }
  await testDbConnection();
  try {
    let token = await getToken();
    console.log('⏳ Pobieram zwroty z AlleKurier...\n');
    let response;
    try {
      response = await fetchReturns(token, date);
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') {
        console.log('🔄 Token wygasł, ponowne logowanie...');
        token = await login();
        response = await fetchReturns(token, date);
      } else {
        throw e;
      }
    }
    const orders = Array.isArray(response.items) ? response.items : [];
    if (!orders.length) {
      console.log(`ℹ️ Brak zwrotów na ${date}`);
      console.log('🔍 Odpowiedź API AlleKurier (podgląd):');
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`✅ Znaleziono ${orders.length} zwrot(ów) w AlleKurier. Zapisuję do returns_panel...\n`);
    let saved = 0;
    for (const order of orders) {
      try {
        await saveWzwReturn(order);
        saved++;
      } catch (e) {
        console.error('❌ Błąd zapisu zwrotu WZW:', e.message);
      }
    }
    console.log(`\n📊 RAZEM zapisano/uzupełniono: ${saved} zwrot(ów) (source='WZW')`);
  } catch (error) {
    console.error(`\n❌ Błąd: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const dateArg = process.argv[2];
  const date = dateArg || getCurrentDate();
  await syncWzwReturnsForDate(date);
}

if (require.main === module) {
  main();
}

module.exports = {
  syncWzwReturnsForDate
};
