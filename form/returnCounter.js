const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const COUNTER_FILE = path.join(os.tmpdir(), 'gerlach_return_counter.txt');
let currentCounter = 0;

async function readCounter() {
    try {
        const data = await fs.readFile(COUNTER_FILE, 'utf8');
        currentCounter = parseInt(data, 10);
        if (isNaN(currentCounter)) {
            currentCounter = 0;
        }
        console.log(`Pobrano licznik zwrotów: ${currentCounter} z pliku ${COUNTER_FILE}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(COUNTER_FILE, '0', 'utf8');
            currentCounter = 0;
            console.log(`Plik licznika ${COUNTER_FILE} nie istnieje, utworzono z wartością początkową 0.`);
        } else {
            console.error('Błąd odczytu pliku licznika:', error);
            currentCounter = 0;
        }
    }
}

async function writeCounter(value) {
    try {
        await fs.writeFile(COUNTER_FILE, value.toString(), 'utf8');
        console.log(`Zapisano nowy licznik zwrotów: ${value} do pliku ${COUNTER_FILE}`);
    } catch (error) {
        console.error('Błąd zapisu pliku licznika:', error);
    }
}

// inicjalne odczytanie licznika przy starcie
readCounter();

async function getNextReturnNumber() {
    currentCounter++;
    const formattedNumber = String(currentCounter).padStart(5, '0');
    const year = new Date().getFullYear();

    const returnNumber = `ZW${formattedNumber}-${year}`;

    await writeCounter(currentCounter);
    return returnNumber;
}

module.exports = {
    getNextReturnNumber
};
