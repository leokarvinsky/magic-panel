require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const { getNextReturnNumber } = require('./returnCounter');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ====== Połączenie z bazą returns_panel (return_requests) ======
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ====== Statyczne pliki (frontend) ======
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======================================================================
// HELPER: pobranie zamówienia z PrestaShop po API + klient + adres
// ======================================================================
async function fetchPrestashopOrder(orderId) {
    const baseUrl = (process.env.GERLACH_API_URL || '').replace(/\/+$/, '');
    const apiKey = process.env.GERLACH_API_KEY;

    if (!baseUrl || !apiKey) {
        throw new Error('Brak GERLACH_API_URL lub GERLACH_API_KEY w .env');
    }

    const auth = {
        username: apiKey,
        password: ''
    };

    try {
        // 1) Pobierz zamówienie
        const orderRes = await axios.get(`${baseUrl}/orders`, {
            auth,
            params: {
                display: 'full',
                'filter[id]': orderId,
                output_format: 'JSON'
            }
        });

        console.log('DEBUG Presta orders response:', JSON.stringify(orderRes.data).slice(0, 500));

        let rawOrder = null;

        if (Array.isArray(orderRes.data.orders)) {
            rawOrder = orderRes.data.orders[0];
        } else if (orderRes.data.orders) {
            rawOrder = orderRes.data.orders;
        } else if (orderRes.data.order) {
            rawOrder = orderRes.data.order;
        } else {
            rawOrder = orderRes.data;
        }

        if (!rawOrder) {
            return null;
        }

        const idCustomer = rawOrder.id_customer || rawOrder.id_customer?.toString();
        const idAddressDelivery = rawOrder.id_address_delivery;

        // 2) Pobierz klienta, żeby dostać e-mail
        let customerEmail = null;

        if (idCustomer) {
            const custRes = await axios.get(`${baseUrl}/customers`, {
                auth,
                params: {
                    display: 'full',
                    'filter[id]': idCustomer,
                    output_format: 'JSON'
                }
            });

            console.log('DEBUG Presta customers response:', JSON.stringify(custRes.data).slice(0, 500));

            let customer = null;
            if (Array.isArray(custRes.data.customers)) {
                customer = custRes.data.customers[0];
            } else if (custRes.data.customers) {
                customer = custRes.data.customers;
            } else if (custRes.data.customer) {
                customer = custRes.data.customer;
            } else {
                customer = custRes.data;
            }

            if (customer) {
                customerEmail = customer.email || null;
            }
        }

        // 3) Pobierz adres dostawy
        let shippingName = '';
        let shippingAddress = '';
        let shippingCity = '';
        let shippingPostal = '';

        if (idAddressDelivery) {
            const addrRes = await axios.get(`${baseUrl}/addresses`, {
                auth,
                params: {
                    display: 'full',
                    'filter[id]': idAddressDelivery,
                    output_format: 'JSON'
                }
            });

            console.log('DEBUG Presta address response:', JSON.stringify(addrRes.data).slice(0, 500));

            let address = null;

            if (Array.isArray(addrRes.data.addresses)) {
                address = addrRes.data.addresses[0];
            } else if (addrRes.data.addresses) {
                address = addrRes.data.addresses;
            } else if (addrRes.data.address) {
                address = addrRes.data.address;
            } else {
                address = addrRes.data;
            }

            const firstname = address.firstname || '';
            const lastname = address.lastname || '';
            shippingName = `${firstname} ${lastname}`.trim();

            shippingAddress = [
                address.address1 || '',
                address.address2 || ''
            ].filter(Boolean).join(' ').trim();

            shippingCity = address.city || '';
            shippingPostal = address.postcode || address.zip || '';
        }

        // 4) Wyciągnięcie pozycji zamówienia
        let orderRows =
            (rawOrder.associations && rawOrder.associations.order_rows) ||
            rawOrder.order_rows ||
            [];

        if (!Array.isArray(orderRows)) {
            orderRows = [orderRows];
        }

        // Presta często zwraca order_rows jako obiekty z kluczem order_row
        if (orderRows.length && orderRows[0].order_row) {
            orderRows = orderRows[0].order_row;
        }

        if (!Array.isArray(orderRows)) {
            orderRows = [orderRows];
        }

        const items = orderRows.map(row => ({
            productName: row.product_name,
            productPrice: Number(row.product_price || row.unit_price_tax_incl || row.unit_price_tax_excl || 0),
            productQuantity: Number(
                row.product_quantity ||
                row.product_quantity_refunded ||
                row.product_quantity_return ||
                1
            ),
            ean13: row.product_ean13 || row.ean13 || null,
            reference: row.product_reference || row.reference || null,
            imageUrl: null
        }));

        return {
            email: customerEmail,
            orderDate: rawOrder.date_add || rawOrder.date || null,
            shippingName,
            shippingAddress,
            shippingCity,
            shippingPostal,
            items
        };
    } catch (err) {
        console.error('❌ Błąd przy pobieraniu zamówienia z PrestaShop:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : null
        });
        throw err;
    }
}

// ======================================================================
// 1) /api/order/:id  → PrestaShop + walidacja e-maila
// ======================================================================
app.get('/api/order/:id', async (req, res) => {
    try {
        const { id } = req.params;      // numer bez PL0
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ message: 'Brak adresu e-mail.' });
        }

        const order = await fetchPrestashopOrder(id);
        if (!order) {
            return res.status(404).json({ message: 'Nie znaleziono zamówienia.' });
        }

        if (!order.email) {
            return res.status(500).json({ message: 'Zamówienie nie zawiera adresu e-mail klienta.' });
        }

        if (order.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(401).json({ message: 'Numer zamówienia i e-mail nie pasują.' });
        }

        if (!order.items || !order.items.length) {
            return res.status(403).json({
                message: 'Zamówienie nie ma pozycji lub nie może być wykorzystane w formularzu.'
            });
        }

        const response = {
            orderDate: order.orderDate,
            shippingName: order.shippingName,
            shippingAddress: order.shippingAddress,
            shippingCity: order.shippingCity,
            shippingPostal: order.shippingPostal,
            items: order.items
        };

        console.log(`✅ Zamówienie ${id} poprawnie zweryfikowane dla e-maila ${email}`);
        res.json(response);
    } catch (err) {
        console.error('Błąd w /api/order/:id (końcowy catch):', err.message);
        res.status(500).json({ message: 'Wewnętrzny błąd serwera przy pobieraniu zamówienia.' });
    }
});

// ======================================================================
// 2) /api/submit-return  → zapis zgłoszenia do return_requests
// ======================================================================
app.post('/api/submit-return', async (req, res) => {
    try {
        const data = req.body;

        const orderNumber = data.numerZamowienia || null;      // np. PL0177777
        const returnNumber = data.numerZgloszenia || null;      // np. ZW00066/2025
        const email = data.emailZamowienia || null;
        const contactName = data.imieNazwiskoKontakt || null;
        const contactPhone = data.numerTelefonuKontakt || null; // jeśli brak w payloadzie — będzie NULL

        if (!orderNumber || !returnNumber) {
            return res.status(400).json({
                message: 'Brak numeru zamówienia lub numeru zgłoszenia.'
            });
        }

        const requestType =
            data.typZgloszenia === 'Reklamacja'
                ? 'COMPLAINT'
                : 'RETURN';

        // ID zamówienia w Preście (bez PL0)
        const shopOrderNumber = orderNumber.startsWith('PL0')
            ? orderNumber.slice(3)
            : orderNumber;

        let reasonType = null;
        let reasonComment = null;

        if (requestType === 'RETURN') {
            reasonType = data.powodZwrotu || null;
            reasonComment = data.komentarz || null;
        } else if (requestType === 'COMPLAINT') {
            reasonType = 'REKLAMACJA';
            reasonComment = data.opisWady || data.komentarz || null;
        }

        const products = Array.isArray(data.wybraneProdukty)
            ? data.wybraneProdukty
            : [];

        if (!products.length) {
            return res.status(400).json({
                message: 'Brak wybranych produktów w zgłoszeniu.'
            });
        }

        console.log('📨 Otrzymano zgłoszenie:', {
            orderNumber,
            shopOrderNumber,
            returnNumber,
            requestType,
            email,
            products: products.length,
            photos: Array.isArray(data.zdjeciaWady) ? data.zdjeciaWady.length : 0
        });

        // 1 wiersz w return_requests na każdy produkt
        const values = products.map(p => [
            returnNumber,                        // internal_return_number
            orderNumber,                         // order_number (PL0...)
            requestType,                         // request_type (RETURN / COMPLAINT)
            shopOrderNumber,                     // shop_order_number (ID z Presty)
            email,                               // customer_email
            contactName,                         // customer_name
            contactPhone,                        // customer_phone
            p.nazwaProduktu || 'UNKNOWN',        // product_name (NOT NULL)
            p.kodProduktu || null,               // ean
            p.iloscZwrotu || 1,                  // quantity
            reasonType,                          // reason_type
            reasonComment                        // reason_comment
        ]);

        const sql = `
      INSERT INTO return_requests (
        internal_return_number,
        order_number,
        request_type,
        shop_order_number,
        customer_email,
        customer_name,
        customer_phone,
        product_name,
        ean,
        quantity,
        reason_type,
        reason_comment
      ) VALUES ?
    `;

        await db.query(sql, [values]);

        // --- ZAPIS ZDJĘĆ DO return_photos (tylko przy reklamacji) ---
        const photos = Array.isArray(data.zdjeciaWady) ? data.zdjeciaWady : [];

        if (requestType === 'COMPLAINT' && photos.length > 0) {
            for (const photo of photos) {
                let dataUrl = null;
                let productEan = null;

                if (typeof photo === 'string') {
                    // Gdyby kiedyś było po prostu: "data:image/jpeg;base64,..."
                    dataUrl = photo;
                } else if (photo && typeof photo === 'object') {
                    // DOPASOWANIE DO OBECNEGO FRONTU:
                    // { nazwa, dane, rozmiar }
                    dataUrl = photo.dane || photo.dataUrl || photo.base64 || photo.data || null;
                    productEan = photo.kodProduktu || photo.ean || null;
                }

                if (!dataUrl) {
                    continue;
                }

                // data:image/jpeg;base64,....
                const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
                let mimeType = 'image/jpeg';
                let base64Data = dataUrl;

                if (match) {
                    mimeType = match[1] || 'image/jpeg';
                    base64Data = match[2];
                }

                const buffer = Buffer.from(base64Data, 'base64');

                await db.query(
                    `INSERT INTO return_photos (
         internal_return_number,
         product_ean,
         mime_type,
         data
       ) VALUES (?, ?, ?, ?)`,
                    [
                        returnNumber,
                        productEan,
                        mimeType,
                        buffer
                    ]
                );
            }
        }

        res.status(200).json({
            message: 'Zgłoszenie zapisane w systemie zwrotów.'
        });
    } catch (err) {
        console.error('Błąd w /api/submit-return:', err);
        res.status(500).json({
            message: 'Wystąpił błąd podczas zapisywania zgłoszenia.'
        });
    }
});



// ======================================================================
// 3) /api/generateReturnNumber  → numer zwrotu z licznika
// ======================================================================
app.get('/api/generateReturnNumber', async (req, res) => {
    try {
        const number = await getNextReturnNumber();
        res.json({ returnNumber: number });
    } catch (err) {
        console.error('Błąd w /api/generateReturnNumber:', err);
        res.status(500).json({ error: 'Nie udało się wygenerować numeru zwrotu.' });
    }
});

// ====== START ======
const PORT = process.env.FORM_PORT || 4000;
app.listen(PORT, () => {
    console.log(`📦 Formularz działa na porcie ${PORT}`);
});
