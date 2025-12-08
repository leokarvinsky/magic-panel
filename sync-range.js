const { execSync } = require('child_process');
const path = require('path');

const ALLEGRO_SYNC = path.join(__dirname, 'allegro', 'index.js');
const WZW_SYNC = path.join(__dirname, 'allekurier', 'wygodnezwroty-sync.js');

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { y, m, d };
}

function formatDate(y, m, d) {
  return [
    String(y).padStart(4, '0'),
    String(m).padStart(2, '0'),
    String(d).padStart(2, '0')
  ].join('-');
}

function getDateRange(start, end) {
  const dates = [];
  let y = start.y;
  let m = start.m;
  let d = start.d;
  while (true) {
    dates.push(formatDate(y, m, d));
    if (y === end.y && m === end.m && d === end.d) break;
    const tmp = new Date(y, m - 1, d);
    tmp.setDate(tmp.getDate() + 1);
    y = tmp.getFullYear();
    m = tmp.getMonth() + 1;
    d = tmp.getDate();
  }
  return dates;
}

async function main() {
  const [_, __, startStr, endStr] = process.argv;
  if (!startStr || !endStr) {
    console.error('❌ Użycie: node sync-range.js 2025-12-01 2025-12-02');
    process.exit(1);
  }

  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const days = getDateRange(start, end);

  console.log(`📅 Synchronizacja od ${startStr} do ${endStr}`);
  console.log('Dni w zakresie:', days.join(', '));

  for (const day of days) {
    console.log(`\n==========================`);
    console.log(`▶ Dzień: ${day}`);
    console.log(`==========================`);

    try {
      console.log(`\n🔵 Allegro → ${day}`);
      execSync(`node "${ALLEGRO_SYNC}" ${day}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`❌ Błąd Allegro ${day}:`, err.message);
    }

    try {
      console.log(`\n🟢 Wygodne Zwroty → ${day}`);
      execSync(`node "${WZW_SYNC}" ${day}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`❌ Błąd WZW ${day}:`, err.message);
    }
  }

  console.log(`\n🎉 GOTOWE — wszystkie zwroty pobrane!`);
}

main();
