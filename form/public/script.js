const steps          = [...document.querySelectorAll('.step')];
const progressEls    = [...document.querySelectorAll('.progress-step')];
let orderData        = null;
let currentOrderId   = '';
let generatedReturnNumber = '';

const state          = {
  products: [],
  type: 'return',
  reason: '',
  comment: '',
  orderDate: '',
  defectDescription: '',
  serialNumber: '',
  defectPhotos: [],
  shipping: { name:'', address:'', city:'', postal:'', account: '' },
  returnNumber: ''
};

function showStep(i) {
  steps.forEach((s, idx) => {
    if (idx === i) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });
  progressEls.forEach((p, idx) => p.classList.toggle('progress-step-active', idx === i));
}

// Obsługa wyboru typu zgłoszenia
document.getElementById('claimType').addEventListener('change', (e) => {
  const claimType = e.target.value;
  const productsSection = document.getElementById('productsSection');
  const returnSection = document.getElementById('returnSection');
  const complaintSection = document.getElementById('complaintSection');
  const productsSectionTitle = document.getElementById('productsSectionTitle');

  if (claimType === 'return') {
    state.type = 'return';
    productsSection.classList.remove('hidden');
    returnSection.classList.remove('hidden');
    complaintSection.classList.add('hidden');
    productsSectionTitle.textContent = 'Wybierz produkty do zwrotu';
  } else if (claimType === 'complaint') {
    state.type = 'complaint';
    productsSection.classList.remove('hidden');
    returnSection.classList.add('hidden');
    complaintSection.classList.remove('hidden');
    productsSectionTitle.textContent = 'Wybierz produkty do reklamacji';
  } else {
    productsSection.classList.add('hidden');
    returnSection.classList.add('hidden');
    complaintSection.classList.add('hidden');
  }
});

// Obsługa zdjęć
document.getElementById('defectPhotos').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  state.defectPhotos = [];

  if (files.length > 5) {
    alert('Możesz dodać maksymalnie 5 zdjęć.');
    e.target.value = '';
    return;
  }

  files.forEach((file, index) => {
    if (file.size > 5 * 1024 * 1024) {
      alert(`Plik ${file.name} jest za duży. Maksymalny rozmiar to 5MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      state.defectPhotos.push({
        name: file.name,
        data: event.target.result,
        size: file.size
      });

      const imgContainer = document.createElement('div');
      imgContainer.className = 'photo-preview-item';
      imgContainer.innerHTML = `
        <img src="${event.target.result}" alt="Zdjęcie ${index + 1}">
        <button type="button" class="remove-photo" data-index="${index}">
          <i class="fas fa-times"></i>
        </button>
        <span class="photo-name">${file.name}</span>
      `;
      preview.appendChild(imgContainer);
    };
    reader.readAsDataURL(file);
  });
});

// Obsługa usuwania zdjęć
document.getElementById('photoPreview').addEventListener('click', (e) => {
  if (e.target.closest('.remove-photo')) {
    const index = parseInt(e.target.closest('.remove-photo').dataset.index);
    state.defectPhotos.splice(index, 1);
    e.target.closest('.photo-preview-item').remove();
    
    // Aktualizuj indeksy
    document.querySelectorAll('.remove-photo').forEach((btn, i) => {
      btn.dataset.index = i;
    });
  }
});

document.getElementById('checkBtn').addEventListener('click', async () => {
  const orderInput = document.getElementById('orderId');
  const emailInput = document.getElementById('email');
  const msg        = document.getElementById('message');
  const loader     = document.getElementById('loader');
  msg.textContent = '';

  const raw   = orderInput.value.trim().toUpperCase();
  const email = emailInput.value.trim().toLowerCase();

  if (!/^PL0\d+$/.test(raw)) {
    msg.textContent = 'Numer zamówienia musi zaczynać się od "PL0".';
    return;
  }
  if (!email) {
    msg.textContent = 'Podaj numer zamówienia i e-mail.';
    return;
  }

  currentOrderId = raw;
  orderInput.value = raw;
  const idNumeric = raw.slice(3);

  loader.classList.remove('hidden');

  try {
    const res = await fetch(`/api/order/${encodeURIComponent(idNumeric)}?email=${encodeURIComponent(email)}`);
    loader.classList.add('hidden');

    if (res.status === 401) return msg.textContent = 'Numer zamówienia i e-mail nie pasują.';
    if (res.status === 404) return msg.textContent = 'Nie znaleziono zamówienia.';
    if (res.status === 403) {
      const errorData = await res.json();
      return msg.textContent = errorData.message || 'To zamówienie nie jest w statusie, który pozwala na zwrot.';
    }
    if (!res.ok) return msg.textContent = `Błąd serwera (${res.status}).`;

    const data = await res.json();
    orderData = data.items;
    state.orderDate = data.orderDate;
    state.shipping = {
      name:    data.shippingName,
      address: data.shippingAddress,
      city:    data.shippingCity,
      postal:  data.shippingPostal,
      account: ''
    };

    buildProductsStep();
    showStep(1);
  } catch (err) {
    console.error(err);
    loader.classList.add('hidden');
    msg.textContent = 'Błąd sieciowy. Spróbuj ponownie.';
  }
});

function buildProductsStep() {
  const orderInfoDiv = document.querySelector('#step-2 .order-header');
  const date = new Date(state.orderDate);
  const formattedDate = date.toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
  });

  orderInfoDiv.innerHTML = `
      <p><strong>Numer zamówienia:</strong> ${currentOrderId}</p>
      <p><strong>Data zamówienia:</strong> ${formattedDate}</p>
  `;

  const list = document.getElementById('productsList');
  list.innerHTML = '';
  
  const placeholder = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%23f0f0f0\'/%3E%3Cpath d=\'M60 40L40 60M40 40L60 60\' stroke=\'%23ccc\' stroke-width=\'5\'/%3E%3C/svg%3E';

  orderData.forEach((item, i) => {
    const roundedPrice = Math.round(item.productPrice);
    const productCode = item.ean13 || item.reference || '—';

    const div = document.createElement('div');
    div.className = 'product-item';
    div.innerHTML = `
      <div class="product-img">
        <img src="${item.imageUrl || placeholder}" alt="Zdjęcie produktu"/>
      </div>
      <div class="product-info">
        <div class="name">${item.productName}</div>
        <div class="code">Kod: ${productCode}</div>
        <div class="price">Cena: ${roundedPrice} PLN</div>
        <div class="ordered-qty">W zamówieniu: ${item.productQuantity}</div>
      </div>
      <div class="qty-control">
        <button type="button" class="decr" data-i="${i}">−</button>
        <div class="count" id="count-${i}">0</div>
        <button type="button" class="incr" data-i="${i}">+</button>
      </div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.incr').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.currentTarget.dataset.i;
      const c = document.getElementById(`count-${i}`);
      let v = +c.textContent;
      if (v < orderData[i].productQuantity) c.textContent = ++v;
    });
  });

  list.querySelectorAll('.decr').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.currentTarget.dataset.i;
      const c = document.getElementById(`count-${i}`);
      let v = +c.textContent;
      if (v > 0) c.textContent = --v;
    });
  });
}

document.getElementById('toStep3').addEventListener('click', () => {
  const claimType = document.getElementById('claimType').value;
  
  if (!claimType) {
    alert('Wybierz typ zgłoszenia.');
    return;
  }

  const sel = [];
  orderData.forEach((item, i) => {
    const qty = +document.getElementById(`count-${i}`).textContent;
    if (qty > 0) sel.push({ ...item, returnQuantity: qty });
  });
  
  if (!sel.length) {
    alert('Wybierz przynajmniej jedną sztukę.');
    return;
  }
  
  state.products = sel;

  if (claimType === 'return') {
    const r = document.getElementById('reason').value;
    if (!r) {
      alert('Wybierz powód zwrotu.');
      return;
    }
    state.reason = r;
    state.defectDescription = '';
    state.serialNumber = '';
    state.defectPhotos = [];
  } else if (claimType === 'complaint') {
    const defectDesc = document.getElementById('defectDescription').value.trim();
    if (!defectDesc) {
      alert('Opisz wadę produktu.');
      return;
    }
    state.defectDescription = defectDesc;
    state.serialNumber = document.getElementById('serialNumber').value.trim();
    state.reason = '';
  }

  state.comment = document.getElementById('comment').value.trim();

  fillShippingData();
  showStep(2);
});

document.getElementById('backTo1').addEventListener('click', () => showStep(0));
document.getElementById('backTo2').addEventListener('click', () => showStep(1));
document.getElementById('backTo3').addEventListener('click', () => showStep(2));

function fillShippingData() {
  let addr = state.shipping.address || '';
  addr = addr.replace(/ *\/ */g, ' ').replace(/\s{2,}/g, ' ').trim();
  document.getElementById('name').value    = state.shipping.name;
  document.getElementById('address').value = addr;
  document.getElementById('city').value    = state.shipping.city;
  document.getElementById('postal').value  = state.shipping.postal;
  document.getElementById('account').value = state.shipping.account || '';
}

document.getElementById('shippingForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  state.shipping = {
    name:    document.getElementById('name').value.trim(),
    address: document.getElementById('address').value.trim(),
    city:    document.getElementById('city').value.trim(),
    postal:  document.getElementById('postal').value.trim(),
    account: document.getElementById('account').value.trim()
  };

  if (!state.shipping.name || !state.shipping.address || !state.shipping.city || !state.shipping.postal) {
      alert('Proszę wypełnić wszystkie wymagane pola kontaktowe (imię i nazwisko, adres, miasto, kod pocztowy).');
      return;
  }

  try {
    const response = await fetch('/api/generateReturnNumber');
    if (!response.ok) {
        throw new Error('Nie udało się wygenerować numeru zgłoszenia.');
    }
    const data = await response.json();
    state.returnNumber = data.returnNumber;
  } catch (error) {
    console.error('Błąd generowania numeru zgłoszenia:', error);
    alert('Wystąpił błąd podczas generowania numeru zgłoszenia. Spróbuj ponownie.');
    return;
  }

  const s = document.getElementById('summary');
  s.innerHTML = '';

  const reasonMap = {
      'nie_odpowiada': 'Nie odpowiada mi',
      'pomylka': 'Zakup przez pomyłkę',
      'bez_przyczyny': 'Bez podania przyczyny',
      'niezgodny_opis': 'Niezgodny z opisem',
      'nie_dotarl_czas': 'Nie dotarł na czas'
  };

  const date = new Date(state.orderDate);
  const formattedDate = date.toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
  });

  const typeLabel = state.type === 'return' ? 'Zwrot' : 'Reklamacja';
  const numberLabel = state.type === 'return' ? 'Numer zwrotu' : 'Numer reklamacji';

  let summaryHTML = `
    <table>
      <thead>
        <tr><th>Pole</th><th>Wartość</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>${numberLabel}</strong></td><td>${state.returnNumber}</td></tr>
        <tr><td><strong>Numer zamówienia</strong></td><td>${currentOrderId}</td></tr>
        <tr><td><strong>Data zamówienia</strong></td><td>${formattedDate}</td></tr>
        <tr><td><strong>E-mail zamówienia</strong></td><td>${document.getElementById('email').value}</td></tr>
        <tr><td><strong>Typ zgłoszenia</strong></td><td>${typeLabel}</td></tr>
        <tr><td><strong>Wybrane produkty</strong></td><td>
          <ul class="product-list-summary">
            ${state.products.map(p => {
              const productCode = p.ean13 || p.reference || '—';
              return `<li>${p.productName} – ${p.returnQuantity} szt.</li>`;
            }).join('')}
          </ul>
        </td></tr>`;

  if (state.type === 'return') {
    summaryHTML += `<tr><td><strong>Powód zwrotu</strong></td><td>${reasonMap[state.reason] || state.reason}</td></tr>`;
  } else {
    summaryHTML += `
      <tr><td><strong>Opis wady</strong></td><td>${state.defectDescription}</td></tr>
      <tr><td><strong>Numer seryjny</strong></td><td>${state.serialNumber || 'Nie podano'}</td></tr>
      <tr><td><strong>Zdjęcia wady</strong></td><td>${state.defectPhotos.length} zdjęć</td></tr>`;
  }

  summaryHTML += `
        <tr><td><strong>Komentarz</strong></td><td>${state.comment || 'Nie podano'}</td></tr>
        <tr><td><strong>Imię i nazwisko</strong></td><td>${state.shipping.name}</td></tr>
        <tr><td><strong>Adres</strong></td><td>${state.shipping.address}</td></tr>
        <tr><td><strong>Miasto</strong></td><td>${state.shipping.city}</td></tr>
        <tr><td><strong>Kod pocztowy</strong></td><td>${state.shipping.postal}</td></tr>
        <tr><td><strong>Numer konta bankowego</strong></td><td>${state.shipping.account || 'Nie podano'}</td></tr>
      </tbody>
    </table>
  `;

  s.innerHTML = summaryHTML;
  showStep(3);
});

document.getElementById('submitSummary').addEventListener('click', async () => {
    const localProxyUrl = '/api/submit-return';
    const submitBtn = document.getElementById('submitSummary');
    const backBtn = document.getElementById('backTo3');
    const sendDataLoader = document.getElementById('sendDataLoader');
    const sendInfoMessage = document.getElementById('sendInfoMessage');

    submitBtn.classList.add('hidden');
    backBtn.classList.add('hidden');
    sendDataLoader.classList.remove('hidden');
    sendInfoMessage.textContent = 'Wysyłanie zgłoszenia, proszę czekać...';
    sendInfoMessage.classList.remove('hidden');
    sendInfoMessage.classList.remove('error-message', 'success-message');

    const reasonMapToSend = {
        'nie_odpowiada': 'Nie odpowiada mi',
        'pomylka': 'Zakup przez pomyłkę',
        'bez_przyczyny': 'Bez podania przyczyny',
        'niezgodny_opis': 'Niezgodny z opisem',
        'nie_dotarl_czas': 'Nie dotarł na czas'
    };
    
    const dataToSend = {
        numerZgloszenia: state.returnNumber,
        numerZamowienia: currentOrderId,
        dataZamowienia: new Date(state.orderDate).toISOString(), 
        emailZamowienia: document.getElementById('email').value.trim(),
        typZgloszenia: state.type === 'return' ? 'Zwrot' : 'Reklamacja',
        powodZwrotu: state.reason ? (reasonMapToSend[state.reason] || state.reason) : '',
        opisWady: state.defectDescription || '',
        numerSeryjny: state.serialNumber || '',
        komentarz: state.comment || 'Nie podano',
        wybraneProdukty: state.products.map(p => ({
            nazwaProduktu: p.productName,
            kodProduktu: p.ean13 || p.reference || '—',
            iloscZwrotu: p.returnQuantity
        })),
        zdjeciaWady: state.defectPhotos.map(photo => ({
            nazwa: photo.name,
            dane: photo.data,
            rozmiar: photo.size
        })),
        imieNazwiskoKontakt: state.shipping.name,
        adresKontakt: state.shipping.address,
        miastoKontakt: state.shipping.city,
        kodPocztowyKontakt: state.shipping.postal,
        numerKonta: state.shipping.account || 'Nie podano'
    };

    try {
        const response = await fetch(localProxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });

        sendDataLoader.classList.add('hidden');

        if (response.ok) {
            document.getElementById('generatedReturnNumber').textContent = state.returnNumber;
            document.getElementById('finalSummaryOrderIdDisplay').textContent = currentOrderId;

            // Aktualizuj etykiety w zależności od typu zgłoszenia
            const returnOrComplaintLabel = document.getElementById('returnOrComplaintLabel');
            if (state.type === 'return') {
                returnOrComplaintLabel.textContent = 'Numer zwrotu:';
            } else {
                returnOrComplaintLabel.textContent = 'Numer reklamacji:';
            }

            // Pokaż/ukryj link do wygodnezwroty.pl tylko dla zwrotów
            const wygodnezwrotyInfo = document.getElementById('wygodnezwrotyInfo');
            const wygodnezwrotyBtn = document.getElementById('wygodnezwrotyBtn');
            
            if (state.type === 'complaint') {
                wygodnezwrotyInfo.style.display = 'none';
                wygodnezwrotyBtn.style.display = 'none';
            } else {
                wygodnezwrotyInfo.style.display = 'inline';
                wygodnezwrotyBtn.style.display = 'inline-block';
            }

            const showCopiedToast = (targetElement) => {
                const toast = document.createElement('div');
                toast.classList.add('copied-toast');
                toast.textContent = 'Skopiowano!';
                document.body.appendChild(toast);
                const rect = targetElement.getBoundingClientRect();
                toast.style.top = `${rect.top - 30}px`;
                toast.style.left = `${rect.left + rect.width / 2}px`;
                toast.style.transform = 'translateX(-50%)';
                setTimeout(() => toast.remove(), 3000);
            };

            const clipboardReturn = new ClipboardJS('#copyReturnNumberBtn');
            clipboardReturn.on('success', e => { showCopiedToast(e.trigger); e.clearSelection(); });
            clipboardReturn.on('error', e => {
                console.error('Action:', e.action, 'Trigger:', e.trigger);
                alert('Błąd podczas kopiowania numeru. Proszę skopiować ręcznie: ' + state.returnNumber);
            });

            const clipboardOrder = new ClipboardJS('#copyOrderIdBtn');
            clipboardOrder.on('success', e => { showCopiedToast(e.trigger); e.clearSelection(); });
            clipboardOrder.on('error', e => {
                console.error('Action:', e.action, 'Trigger:', e.trigger);
                alert('Błąd podczas kopiowania numeru zamówienia. Proszę skopiować ręcznie: ' + currentOrderId);
            });

            showStep(4);
            sendInfoMessage.textContent = 'Zgłoszenie wysłane pomyślnie!';
            sendInfoMessage.classList.add('success-message');
        } else {
            submitBtn.classList.remove('hidden');
            backBtn.classList.remove('hidden');
            const errorData = await response.json();
            console.error('Błąd podczas wysyłania przez proxy do Power Automate:', errorData);
            sendInfoMessage.textContent = `Błąd: ${errorData.message || response.statusText}. Spróbuj ponownie.`;
            sendInfoMessage.classList.add('error-message');
            alert(`Wystąpił błąd: ${errorData.message || response.statusText}.`);
        }
    } catch (error) {
        submitBtn.classList.remove('hidden');
        backBtn.classList.remove('hidden');
        sendDataLoader.classList.add('hidden');
        console.error('Błąd sieciowy lub serwera proxy:', error);
        sendInfoMessage.textContent = 'Błąd sieciowy. Upewnij się, że serwer jest uruchomiony.';
        sendInfoMessage.classList.add('error-message');
        alert('Wystąpił błąd sieciowy. Sprawdź konsolę.');
    }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('orderId').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('checkBtn').click();
  });
  showStep(0);
});