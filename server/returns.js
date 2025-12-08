const { pool } = require('./db');

/* ==================== ALLEGRO ==================== */

function mapAllegroReturnToDbRow(r) {
  const firstParcel = Array.isArray(r.parcels) && r.parcels.length ? r.parcels[0] : null;
  return {
    source: 'ALLEGRO',
    external_return_id: r.id || null,
    external_reference_number: r.referenceNumber || null,
    external_order_id: r.orderId || null,
    shop_order_number: null,
    internal_return_number: null,
    buyer_email: r.buyer && r.buyer.email ? r.buyer.email : null,
    buyer_login: r.buyer && r.buyer.login ? r.buyer.login : null,
    customer_name: null,
    customer_phone: firstParcel && firstParcel.sender ? firstParcel.sender.phoneNumber || null : null,
    waybill: firstParcel ? firstParcel.waybill || null : null,
    carrier: firstParcel ? firstParcel.carrierId || null : null,
    status_external: r.status || null,
    erp_status: 'NOWY',
    internal_status: 'ZGLOSZONY',
    created_at_external: r.createdAt ? new Date(r.createdAt) : null
  };
}

function mapAllegroItemsToDbRows(returnId, r) {
  if (!Array.isArray(r.items)) return [];
  return r.items.map(it => ({
    return_id: returnId,
    offer_id: it.offerId || null,
    product_name: it.name || '',
    ean: null,
    quantity: it.quantity || 1,
    price_amount: it.price && it.price.amount ? it.price.amount : null,
    price_currency: it.price && it.price.currency ? it.price.currency : null,
    reason_type: it.reason && it.reason.type ? it.reason.type : null,
    reason_comment: it.reason && it.reason.userComment ? it.reason.userComment : null
  }));
}

async function saveAllegroReturn(allegroReturn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = mapAllegroReturnToDbRow(allegroReturn);

    const [insertResult] = await conn.query(
      `INSERT INTO returns (
         source,
         external_return_id,
         external_reference_number,
         external_order_id,
         shop_order_number,
         internal_return_number,
         buyer_email,
         buyer_login,
         customer_name,
         customer_phone,
         waybill,
         carrier,
         status_external,
         erp_status,
         internal_status,
         created_at_external
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         external_reference_number = VALUES(external_reference_number),
         external_order_id        = VALUES(external_order_id),
         buyer_email              = VALUES(buyer_email),
         buyer_login              = VALUES(buyer_login),
         customer_phone           = VALUES(customer_phone),
         waybill                  = VALUES(waybill),
         carrier                  = VALUES(carrier),
         status_external          = VALUES(status_external),
         created_at_external      = VALUES(created_at_external),
         updated_at               = CURRENT_TIMESTAMP`,
      [
        row.source,
        row.external_return_id,
        row.external_reference_number,
        row.external_order_id,
        row.shop_order_number,
        row.internal_return_number,
        row.buyer_email,
        row.buyer_login,
        row.customer_name,
        row.customer_phone,
        row.waybill,
        row.carrier,
        row.status_external,
        row.erp_status,
        row.internal_status,
        row.created_at_external
      ]
    );

    let returnId;
    if (insertResult.insertId && insertResult.affectedRows === 1) {
      returnId = insertResult.insertId;
    } else {
      const [rows] = await conn.query(
        'SELECT id FROM returns WHERE source = ? AND external_return_id = ? LIMIT 1',
        [row.source, row.external_return_id]
      );
      if (!rows.length) throw new Error('Nie znaleziono zwrotu po ON DUPLICATE KEY (ALLEGRO)');
      returnId = rows[0].id;
    }

    const itemRows = mapAllegroItemsToDbRows(returnId, allegroReturn);
    await conn.query('DELETE FROM return_items WHERE return_id = ?', [returnId]);
    if (itemRows.length) {
      const values = itemRows.map(it => [
        it.return_id,
        it.offer_id,
        it.product_name,
        it.ean,
        it.quantity,
        it.price_amount,
        it.price_currency,
        it.reason_type,
        it.reason_comment
      ]);
      await conn.query(
        `INSERT INTO return_items (
           return_id,
           offer_id,
           product_name,
           ean,
           quantity,
           price_amount,
           price_currency,
           reason_type,
           reason_comment
         ) VALUES ?`,
        [values]
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/* ==================== WZW + FORM ==================== */

function parseWzwDate(str) {
  if (!str) return null;
  const iso = str.replace(' ', 'T');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mapWzwOrderToDbRow(order) {
  const fields = Array.isArray(order.additional_fields) ? order.additional_fields : [];
  const orderNumberField = fields.find(f => f.name === 'orderNumber');
  const returnNumberField = fields.find(f => f.name === 'Input');

  const orderNumber = orderNumberField && orderNumberField.value ? orderNumberField.value.trim() : null;
  const returnNumber = returnNumberField && returnNumberField.value ? returnNumberField.value.trim() : null;

  let status = 'CREATED';
  if (order.delivered_at) {
    status = 'DELIVERED';
  } else if (order.sent_at) {
    status = 'SENT';
  }

  const createdExternal = parseWzwDate(order.created_at) || null;

  return {
    source: 'Prestashop',
    external_return_id: returnNumber || order.hid || null,   // numer zwrotu z WZW (Input) lub hid
    external_reference_number: returnNumber || null,          // numer zwrotu (Input) – ważny do łączenia z FORM
    external_order_id: orderNumber || null,                   // numer zamówienia
    shop_order_number: orderNumber || null,
    internal_return_number: null,                             // uzupełnimy z FORM
    buyer_email: order.sender_email || null,
    buyer_login: null,
    customer_name: order.sender_name || null,
    customer_phone: order.sender_phone || null,
    waybill: order.tracking_number || null,
    carrier: order.carrier_name || null,
    status_external: status,
    erp_status: 'NOWY',
    internal_status: 'ZGLOSZONY',
    created_at_external: createdExternal
  };
}

/**
 * Szuka pasującego zgłoszenia FORM w return_requests:
 * 1) po numerze zwrotu (external_reference_number ↔ internal_return_number)
 * 2) jeśli brak – po numerze zamówienia / shop_order_number
 */
async function findMatchingFormInternalNumber(conn, row) {
  // 1) po numerze zwrotu (Input z WZW)
  if (row.external_reference_number) {
    const [rows] = await conn.query(
      `SELECT internal_return_number
       FROM return_requests
       WHERE internal_return_number = ?
         AND processed_at IS NULL
       LIMIT 1`,
      [row.external_reference_number]
    );
    if (rows.length) {
      return rows[0].internal_return_number;
    }
  }

  // 2) po numerze zamówienia (shop_order_number)
  if (row.shop_order_number) {
    const [rows] = await conn.query(
      `SELECT internal_return_number
       FROM return_requests
       WHERE shop_order_number = ?
         AND processed_at IS NULL
       LIMIT 1`,
      [row.shop_order_number]
    );
    if (rows.length) {
      return rows[0].internal_return_number;
    }
  }

  // 3) fallback – po order_number (np. PL0177777)
  if (row.external_order_id) {
    const [rows] = await conn.query(
      `SELECT internal_return_number
       FROM return_requests
       WHERE order_number = ?
         AND processed_at IS NULL
       LIMIT 1`,
      [row.external_order_id]
    );
    if (rows.length) {
      return rows[0].internal_return_number;
    }
  }

  return null;
}

/**
 * Łączy zwrot z WZW z danymi z formularza:
 *  - ustawia internal_return_number w tabeli returns
 *  - przepisuje dane klienta (jeśli trzeba)
 *  - tworzy return_items na podstawie produktów z FORM
 *  - ustawia processed_at w return_requests
 */
async function syncWithFormRequest(conn, returnId, row) {
  const internalNumber = await findMatchingFormInternalNumber(conn, row);

  if (!internalNumber) {
    // brak formularza – zostawiamy zwrot jako samą przesyłkę
    return;
  }

  // pobierz wszystkie wiersze zgłoszenia formularza
  const [reqRows] = await conn.query(
    `SELECT *
     FROM return_requests
     WHERE internal_return_number = ?`,
    [internalNumber]
  );

  if (!reqRows.length) {
    return;
  }

  const first = reqRows[0];

  // 1) uzupełniamy nagłówek returns o dane z formularza
  await conn.query(
    `UPDATE returns
     SET internal_return_number = ?,
         customer_email        = COALESCE(?, customer_email),
         customer_name         = COALESCE(?, customer_name),
         customer_phone        = COALESCE(?, customer_phone)
     WHERE id = ?`,
    [
      internalNumber,
      first.customer_email || null,
      first.customer_name || null,
      first.customer_phone || null,
      returnId
    ]
  );

  // 2) budujemy pozycje zwrotu na podstawie produktów z formularza
  await conn.query('DELETE FROM return_items WHERE return_id = ?', [returnId]);

  const itemValues = reqRows.map(r => [
    returnId,
    null,                     // offer_id – dla FORM nie mamy
    r.product_name,
    r.ean,
    r.quantity,
    null,                     // price_amount – na razie nie używamy
    null,                     // price_currency
    r.reason_type,
    r.reason_comment
  ]);

  await conn.query(
    `INSERT INTO return_items (
       return_id,
       offer_id,
       product_name,
       ean,
       quantity,
       price_amount,
       price_currency,
       reason_type,
       reason_comment
     ) VALUES ?`,
    [itemValues]
  );

  // 3) oznaczamy zgłoszenie formularza jako przetworzone
  await conn.query(
    `UPDATE return_requests
     SET processed_at = NOW()
     WHERE internal_return_number = ?`,
    [internalNumber]
  );
}

async function saveWzwReturn(order) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const row = mapWzwOrderToDbRow(order);

    const [insertResult] = await conn.query(
      `INSERT INTO returns (
         source,
         external_return_id,
         external_reference_number,
         external_order_id,
         shop_order_number,
         internal_return_number,
         buyer_email,
         buyer_login,
         customer_name,
         customer_phone,
         waybill,
         carrier,
         status_external,
         erp_status,
         internal_status,
         created_at_external
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         external_reference_number = VALUES(external_reference_number),
         external_order_id        = VALUES(external_order_id),
         shop_order_number        = VALUES(shop_order_number),
         buyer_email              = VALUES(buyer_email),
         customer_name            = VALUES(customer_name),
         customer_phone           = VALUES(customer_phone),
         waybill                  = VALUES(waybill),
         carrier                  = VALUES(carrier),
         status_external          = VALUES(status_external),
         created_at_external      = VALUES(created_at_external),
         updated_at               = CURRENT_TIMESTAMP`,
      [
        row.source,
        row.external_return_id,
        row.external_reference_number,
        row.external_order_id,
        row.shop_order_number,
        row.internal_return_number,
        row.buyer_email,
        row.buyer_login,
        row.customer_name,
        row.customer_phone,
        row.waybill,
        row.carrier,
        row.status_external,
        row.erp_status,
        row.internal_status,
        row.created_at_external
      ]
    );

    let returnId;
    if (insertResult.insertId && insertResult.affectedRows === 1) {
      returnId = insertResult.insertId;
    } else {
      const [rows] = await conn.query(
        'SELECT id FROM returns WHERE source = ? AND external_return_id = ? LIMIT 1',
        [row.source, row.external_return_id]
      );
      if (!rows.length) throw new Error('Nie znaleziono zwrotu WZW po ON DUPLICATE KEY');
      returnId = rows[0].id;
    }

    // 🔗 TU łączymy WZW z formularzem (FORM)
    await syncWithFormRequest(conn, returnId, row);

    await conn.commit();
    return returnId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/* ================================================== */

module.exports = {
  saveAllegroReturn,
  saveWzwReturn
};
