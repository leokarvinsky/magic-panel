let returns = [];
let filtered = [];
let selectedIds = new Set();
let currentId = null;
let tempItems = [];

const STATUS_LIST = [
    'ZGLOSZONY',
    'W_DRODZE',
    'NA_MAGAZYNIE',
    'ZWERYFIKOWANY',
    'ZAKONCZONY'
];

document.addEventListener('DOMContentLoaded', () => {
    const quickSearch = document.getElementById('quickSearch');
    const filterSource = document.getElementById('filterSource');
    const sortSelect = document.getElementById('sortSelect');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const btnClearFilters = document.getElementById('btnClearFilters');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    const statusChips = document.getElementById('statusChips');

    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnAddManualItem = document.getElementById('btnAddManualItem');
    const btnAccept = document.getElementById('btnAccept');
    const btnReject = document.getElementById('btnReject');
    const btnPartial = document.getElementById('btnPartial');
    const btnSaveStatuses = document.getElementById('btnSaveStatuses');

    const btnBulkAccept = document.getElementById('btnBulkAccept');
    const btnBulkClear = document.getElementById('btnBulkClear');

    loadReturns();

    if (quickSearch) {
        quickSearch.addEventListener('input', applyFilters);
        quickSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (filtered.length >= 1) {
                    openModal(filtered[0].id);
                }
            }
        });
    }

    if (filterSource) filterSource.addEventListener('change', applyFilters);
    if (sortSelect) sortSelect.addEventListener('change', applyFilters);
    if (dateFrom) dateFrom.addEventListener('change', applyFilters);
    if (dateTo) dateTo.addEventListener('change', applyFilters);

    if (btnClearFilters) {
        btnClearFilters.addEventListener('click', () => {
            if (quickSearch) quickSearch.value = '';
            if (filterSource) filterSource.value = 'ALL';
            if (sortSelect) sortSelect.value = 'date_desc';
            if (dateFrom) dateFrom.value = '';
            if (dateTo) dateTo.value = '';
            setActiveStatusChip('ALL');
            applyFilters();
        });
    }

    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            toggleSelectAll(e.target);
        });
    }

    if (statusChips) {
        statusChips.addEventListener('click', (e) => {
            const btn = e.target.closest('.status-chip');
            if (!btn) return;
            const status = btn.dataset.status;
            setActiveStatusChip(status);
            applyFilters();
        });
    }

    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnAddManualItem) btnAddManualItem.addEventListener('click', addManualItem);
    if (btnAccept) btnAccept.addEventListener('click', () => processReturn('ACCEPT'));
    if (btnReject) btnReject.addEventListener('click', () => processReturn('REJECT'));
    if (btnPartial) btnPartial.addEventListener('click', () => processReturn('PARTIAL'));
    if (btnSaveStatuses) btnSaveStatuses.addEventListener('click', saveStatusesOnly);

    if (btnBulkAccept) btnBulkAccept.addEventListener('click', () => bulkAction('ACCEPT'));
    if (btnBulkClear) btnBulkClear.addEventListener('click', clearSelection);

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (quickSearch) quickSearch.focus();
        }
        if (e.key === 'Escape') {
            const modal = document.getElementById('detailModal');
            if (modal && modal.classList.contains('open')) {
                closeModal();
            }
        }
    });

    const modalOverlay = document.getElementById('detailModal');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }
});

async function loadReturns() {
    try {
        const res = await fetch('/api/returns');
        if (!res.ok) throw new Error('Błąd pobierania danych zwrotów');
        const data = await res.json();
        returns = Array.isArray(data) ? data.map(normalizeReturn) : [];
        applyFilters();
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('tableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Błąd ładowania danych z backendu</td></tr>';
        }
    }
}

function normalizeReturn(r) {
    const created = r.created_at_external || r.created_at;
    const waybill = r.waybill || 'Brak';
    const order = r.shop_order_number || r.external_order_id || '-';
    const customer = r.customer_name || r.buyer_email || r.buyer_login || '-';
    const login = r.buyer_login || r.buyer_email || '';
    const phone = r.customer_phone || '';
    const carrier = r.carrier || '';
    const shortReturn = r.external_reference_number || '';
    const externalId = r.external_return_id || '';
    const erpError = r.erp_status === 'BLAD';

    const items = Array.isArray(r.items)
        ? r.items.map(it => ({
            name: it.product_name || '',
            qty: it.quantity || 1,
            ean: it.ean || '',
            price_amount: it.price_amount,
            price_currency: it.price_currency,
            reason_type: it.reason_type || '',
            reason_comment: it.reason_comment || '',
            is_ok: true,
            reason: it.reason_comment || ''
        }))
        : [];

    return {
        raw: r,
        id: r.id,
        source: r.source,
        waybill,
        carrier,
        order,
        shop_order: r.shop_order_number || '',
        customer,
        login,
        phone,
        shortReturn,
        externalId,
        status: r.internal_status,
        external_status: r.status_external || '',
        erp_status: r.erp_status,
        erpUpdated: r.erp_status_updated_at || null,
        created_external: r.created_at_external || null,
        received_at: r.received_at || null,
        date: created,
        items
    };
}

function applyFilters() {
    const quickSearch = document.getElementById('quickSearch');
    const filterSource = document.getElementById('filterSource');
    const sortSelect = document.getElementById('sortSelect');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');

    const q = quickSearch ? quickSearch.value.toLowerCase() : '';
    const src = filterSource ? filterSource.value : 'ALL';
    const sortVal = sortSelect ? sortSelect.value : 'date_desc';
    const dFrom = dateFrom && dateFrom.value ? dateFrom.value : null;
    const dTo = dateTo && dateTo.value ? dateTo.value : null;

    const activeStatus = getActiveStatusChip();

    filtered = returns.filter(r => {
        const haystack = [
            r.waybill,
            r.order,
            r.customer,
            r.login,
            r.shortReturn,
            r.externalId
        ].join(' ').toLowerCase();

        const matchQ = !q || haystack.includes(q);
        const matchSrc = src === 'ALL' || r.source === src;
        const matchStatus = activeStatus === 'ALL' || r.status === activeStatus;

        let matchDate = true;
        if (r.date) {
            const d = new Date(r.date);
            if (!isNaN(d.getTime())) {
                const dStr = d.toISOString().slice(0, 10);
                if (dFrom && dStr < dFrom) matchDate = false;
                if (dTo && dStr > dTo) matchDate = false;
            }
        }

        return matchQ && matchSrc && matchStatus && matchDate;
    });

    sortFiltered(sortVal);
    updateKpis();
    updateStatusChipCounts();
    renderTable();
}

function sortFiltered(sortVal) {
    filtered.sort((a, b) => {
        if (sortVal === 'date_desc' || sortVal === 'date_asc') {
            const da = a.date ? new Date(a.date) : null;
            const db = b.date ? new Date(b.date) : null;
            const va = da && !isNaN(da.getTime()) ? da.getTime() : 0;
            const vb = db && !isNaN(db.getTime()) ? db.getTime() : 0;
            return sortVal === 'date_desc' ? vb - va : va - vb;
        }
        if (sortVal === 'id_desc') {
            return b.id - a.id;
        }
        if (sortVal === 'id_asc') {
            return a.id - b.id;
        }
        return 0;
    });
}

function updateKpis() {
    const elTodo = document.getElementById('kpi-todo');
    const elAcc = document.getElementById('kpi-accepted-today');
    const elErr = document.getElementById('kpi-erp-errors');

    const todo = returns.filter(r => r.status !== 'ZWERYFIKOWANY' && r.status !== 'ZAKONCZONY').length;
    if (elTodo) elTodo.innerText = todo;

    const todayStr = new Date().toISOString().slice(0, 10);
    const acceptedToday = returns.filter(r =>
        (r.status === 'ZWERYFIKOWANY' || r.status === 'ZAKONCZONY') &&
        r.erpUpdated &&
        String(r.erpUpdated).slice(0, 10) === todayStr
    ).length;
    if (elAcc) elAcc.innerText = acceptedToday;

    const erpErrors = returns.filter(r => r.erp_status === 'BLAD').length;
    if (elErr) elErr.innerText = erpErrors;
}

function updateStatusChipCounts() {
    const allCount = returns.length;
    const chipAll = document.getElementById('chip-ALL');
    if (chipAll) chipAll.innerText = allCount;

    STATUS_LIST.forEach(st => {
        const cnt = returns.filter(r => r.status === st).length;
        const el = document.getElementById('chip-' + st);
        if (el) el.innerText = cnt;
    });
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Brak zwrotów do wyświetlenia</td></tr>';
        return;
    }

    filtered.forEach(r => {
        const tr = document.createElement('tr');
        if (selectedIds.has(r.id)) tr.className = 'selected';

        let stClass = 'st-new';
        let stText = 'Zgłoszony';

        if (r.erp_status === 'BLAD') {
            stClass = 'st-error';
            stText = 'Błąd ERP';
        } else {
            switch (r.status) {
                case 'W_DRODZE':
                    stClass = 'st-pending';
                    stText = 'W drodze';
                    break;
                case 'NA_MAGAZYNIE':
                    stClass = 'st-pending';
                    stText = 'Na magazynie';
                    break;
                case 'ZWERYFIKOWANY':
                    stClass = 'st-done';
                    stText = 'Zweryfikowany';
                    break;
                case 'ZAKONCZONY':
                    stClass = 'st-done';
                    stText = 'Zakończony';
                    break;
                default:
                    stClass = 'st-new';
                    stText = 'Zgłoszony';
            }
        }

        const srcClass = r.source === 'ALLEGRO' ? 'src-allegro' : 'src-wzw';

        let dateStr = '-';
        let timeStr = '';
        if (r.date) {
            const d = new Date(r.date);
            if (!isNaN(d.getTime())) {
                dateStr = d.toISOString().slice(0, 10);
                timeStr = d.toISOString().slice(11, 16);
            }
        }

        tr.innerHTML = `
            <td style="text-align: center;">
                <input
                    type="checkbox"
                    style="width:18px; height:18px; accent-color:var(--primary); cursor:pointer;"
                    ${selectedIds.has(r.id) ? 'checked' : ''}
                    data-id="${r.id}">
            </td>
            <td class="col-date">${dateStr} <span style="color:var(--text-muted); font-size:0.8em;">${timeStr}</span></td>
            <td class="col-id">#${r.id}</td>
            <td>
                <div class="col-waybill">${r.waybill}</div>
                <div class="col-meta">${r.order}${r.shortReturn ? ' • Zwrot: ' + r.shortReturn : ''}</div>
            </td>
            <td class="col-customer">
                <div>${r.customer}</div>
                <div class="col-meta">
                    ${r.login || ''} <span class="source-tag ${srcClass}">${r.source}</span>
                </div>
            </td>
            <td style="text-align: right;">
                <span class="status-badge ${stClass}">
                    <span class="status-dot"></span> ${stText}
                </span>
                ${r.erp_status && r.erp_status !== 'NOWY'
                    ? `<div class="col-meta">ERP: ${r.erp_status}</div>`
                    : ''}
            </td>
            <td style="text-align: right;">
                <button class="btn-icon" data-action="details" data-id="${r.id}">
                    <i class="ph-bold ph-caret-right"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(cb.dataset.id, 10);
            toggleSelect(id);
        });
    });

    tbody.querySelectorAll('button[data-action="details"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id, 10);
            openModal(id);
        });
    });
}

function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    renderTable();
    updateBulkBar();
}

function toggleSelectAll(cb) {
    if (cb.checked) filtered.forEach(r => selectedIds.add(r.id));
    else selectedIds.clear();
    renderTable();
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    if (selectedIds.size > 0) {
        bar.classList.add('visible');
        const cntEl = document.getElementById('bulkCount');
        if (cntEl) cntEl.innerText = selectedIds.size;
    } else {
        bar.classList.remove('visible');
    }
}

function clearSelection() {
    selectedIds.clear();
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    renderTable();
    updateBulkBar();
}

function setActiveStatusChip(status) {
    const chips = document.querySelectorAll('.status-chip');
    chips.forEach(c => {
        if (c.dataset.status === status) c.classList.add('active');
        else c.classList.remove('active');
    });
}

function getActiveStatusChip() {
    const chip = document.querySelector('.status-chip.active');
    if (!chip) return 'ALL';
    return chip.dataset.status || 'ALL';
}

/* Modal */

function openModal(id) {
    const r = returns.find(x => x.id === id);
    if (!r) return;
    currentId = id;
    tempItems = JSON.parse(JSON.stringify(r.items || []));

    setText('mId', r.id);
    const badge = document.getElementById('mSourceBadge');
    if (badge) {
        badge.innerText = r.source;
        badge.className = 'source-tag ' + (r.source === 'ALLEGRO' ? 'src-allegro' : 'src-wzw');
    }

    setText('mCustomer', r.customer);
    setText('mEmail', r.login || r.raw.buyer_email || '-');
    setText('mPhone', r.phone || '-');
    setText('mWaybill', r.waybill);
    setText('mCourier', r.carrier || '-');
    setText('mOrder', r.order || '-');
    setText('mShopOrder', r.shop_order || '-');
    setText('mReturnShort', r.shortReturn || '-');
    setText('mSource', r.source || '-');
    setText('mExternalId', r.externalId || '-');
    setText('mInternalReturn', r.raw.internal_return_number || '-');

    setText('mCreatedExt', formatDateTime(r.created_external));
    setText('mReceivedAt', formatDateTime(r.received_at));
    setText('mErpUpdated', formatDateTime(r.erpUpdated));

    const externalBadge = document.getElementById('mStatusExternalBadge');
    const mStatusExternal = document.getElementById('mStatusExternal');
    if (externalBadge && mStatusExternal) {
        mStatusExternal.innerText = r.external_status || '-';
        externalBadge.className = 'status-badge status-badge-large ' +
            (r.external_status === 'DELIVERED'
                ? 'st-done'
                : r.external_status === 'SENT'
                    ? 'st-pending'
                    : 'st-new');
    }

    const internalSelect = document.getElementById('mInternalStatusSelect');
    const erpSelect = document.getElementById('mErpStatusSelect');
    if (internalSelect) internalSelect.value = r.status || 'ZGLOSZONY';
    if (erpSelect) erpSelect.value = r.erp_status || 'NOWY';

    renderModalItems();

    const modal = document.getElementById('detailModal');
    if (modal) modal.classList.add('open');
}

function closeModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.classList.remove('open');
    currentId = null;
    tempItems = [];
}

function renderModalItems() {
    const container = document.getElementById('mItemsList');
    if (!container) return;

    if (!tempItems.length) {
        container.innerHTML = '<div class="item-row" style="justify-content:center; color:var(--text-muted); font-size:0.85rem;">Brak pozycji zwrotu (WZW na razie bez produktów)</div>';
        return;
    }

    container.innerHTML = tempItems.map((item, idx) => {
        const price =
            item.price_amount != null && item.price_amount !== ''
                ? `${Number(item.price_amount).toFixed(2)} ${item.price_currency || ''}`
                : '';
        return `
            <div class="item-row">
                <input
                    type="checkbox"
                    class="item-check"
                    ${item.is_ok ? 'checked' : ''}
                    data-idx="${idx}">
                <div class="item-main">
                    <div class="item-name">
                        ${item.name || `<input
                            type="text"
                            placeholder="Nazwa produktu..."
                            class="item-text-input"
                            data-idx="${idx}"
                            data-field="name">`}
                    </div>
                    <div class="item-meta">
                        Ilość:
                        <input
                            type="number"
                            min="1"
                            value="${item.qty}"
                            style="width:50px; border:1px solid #e2e8f0; border-radius:4px; padding:2px;"
                            data-idx="${idx}"
                            data-field="qty">
                        ${item.ean ? ` • EAN: ${item.ean}` : ''}
                        ${price ? ` • ${price}` : ''}
                    </div>
                </div>
                <div class="item-controls">
                    <input
                        type="text"
                        placeholder="Uwagi (np. Uszkodzony)..."
                        value="${item.reason || ''}"
                        class="item-text-input"
                        data-idx="${idx}"
                        data-field="reason">
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.item-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt(cb.dataset.idx, 10);
            if (!isNaN(idx) && tempItems[idx]) tempItems[idx].is_ok = cb.checked;
        });
    });

    container.querySelectorAll('input[data-field]').forEach(input => {
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx, 10);
            const field = input.dataset.field;
            if (isNaN(idx) || !field || !tempItems[idx]) return;
            if (field === 'qty') {
                const n = parseInt(input.value, 10);
                tempItems[idx].qty = !isNaN(n) && n > 0 ? n : 1;
                input.value = tempItems[idx].qty;
            } else {
                tempItems[idx][field] = input.value;
            }
        });
    });
}

function addManualItem() {
    tempItems.push({ name: '', qty: 1, is_ok: true, reason: '', ean: '', price_amount: null, price_currency: '' });
    renderModalItems();
}

async function processReturn(action, idOverride, options) {
    const silent = options && options.silent;
    const id = idOverride || currentId;
    if (!id) return;

    const idx = returns.findIndex(x => x.id === id);
    if (idx === -1) return;
    const r = returns[idx];

    let newInternal = r.status || 'ZGLOSZONY';
    let newErp = r.erp_status || 'NOWY';

    if (action === 'ACCEPT') {
        newInternal = 'ZWERYFIKOWANY';
        newErp = 'DO_IMPORTU';
    } else if (action === 'REJECT') {
        newInternal = 'ZWERYFIKOWANY';
        newErp = 'BLAD';
    } else if (action === 'PARTIAL') {
        newInternal = 'ZWERYFIKOWANY';
        newErp = 'DO_IMPORTU';
    }

    await saveStatusToBackend(id, newInternal, newErp, silent);
}

async function saveStatusesOnly() {
    if (!currentId) return;
    const idx = returns.findIndex(x => x.id === currentId);
    if (idx === -1) return;

    const internalSelect = document.getElementById('mInternalStatusSelect');
    const erpSelect = document.getElementById('mErpStatusSelect');

    const newInternal = internalSelect ? internalSelect.value : returns[idx].status;
    const newErp = erpSelect ? erpSelect.value : returns[idx].erp_status;

    await saveStatusToBackend(currentId, newInternal, newErp, false);
}

async function saveStatusToBackend(id, internalStatus, erpStatus, silent) {
    const idx = returns.findIndex(x => x.id === id);
    if (idx === -1) return;
    const r = returns[idx];

    try {
        const res = await fetch(`/api/returns/${r.raw.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                internal_status: internalStatus,
                erp_status: erpStatus
            })
        });

        if (!res.ok) {
            if (!silent) alert('Błąd zapisu zmian statusu.');
            return;
        }

        const updated = await res.json();
        const mergedRaw = { ...r.raw, ...updated };
        returns[idx] = normalizeReturn(mergedRaw);

        if (!silent) {
            closeModal();
            applyFilters();
        } else {
            applyFilters();
        }
    } catch (e) {
        console.error(e);
        if (!silent) alert('Błąd sieci przy zapisie statusu.');
    }
}

async function bulkAction(action) {
    if (selectedIds.size === 0) return;
    if (!confirm(`Zatwierdzić ${selectedIds.size} zwrotów?`)) return;

    const ids = Array.from(selectedIds);
    for (const id of ids) {
        await processReturn(action, id, { silent: true });
    }
    clearSelection();
}

/* Helpers */

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value != null && value !== '' ? value : '-';
}

function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('pl-PL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
