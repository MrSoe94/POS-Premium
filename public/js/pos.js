// pos.js

// --- DEBUG LOG: Cek apakah script ini berjalan ---
console.log("pos-v3.js is loaded and running.");

let cart = [];
let products = [];
let categories = [];
let currentFilter = 'all';
let currentCategory = 'all';
let searchTerm = '';
let qrisImageSrc = 'https://via.placeholder.com/200.png?text=QRIS';
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let recentTransactions = [];
let transactionToVoidId = null;
let drafts = [];

// DOM Elements
const productList = document.getElementById('productList');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');
const checkoutBtn = document.getElementById('checkoutBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userNameSpan = document.getElementById('userName');
const bannerContainer = document.getElementById('bannerContainer');
const recentTransactionsList = document.getElementById('recentTransactionsList');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const categoryDropdownMenu = document.getElementById('categoryDropdownMenu');
const categoryDropdownToggle = document.getElementById('categoryDropdownToggle');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const draftsList = document.getElementById('draftsList');

// Modal Elements
const checkoutModal = new bootstrap.Modal(document.getElementById('checkoutModal'));
const transactionDetailsModal = new bootstrap.Modal(document.getElementById('transactionDetailsModal'));
const paymentSuccessModal = new bootstrap.Modal(document.getElementById('paymentSuccessModal'));
const modalTotal = document.getElementById('modalTotal');
const amountReceivedInput = document.getElementById('amountReceived');
const changeAmountSpan = document.getElementById('changeAmount');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const cashPaymentSection = document.getElementById('cashPaymentSection');
const qrisPaymentSection = document.getElementById('qrisPaymentSection');
const voidTransactionBtn = document.getElementById('voidTransactionBtn');
const printReceiptBtn = document.getElementById('printReceiptBtn');
const printReceiptFromDetailsBtn = document.getElementById('printReceiptFromDetailsBtn');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded. Initializing app...");
    await fetchUserInfo();
    await loadCategories();
    await loadBanner();
    await loadProducts();
    await loadQrisImage();
    await loadRecentTransactions();
    await loadDrafts();
    setupEventListeners();
    console.log("App initialization complete.");
});

async function fetchUserInfo() { 
    if (userNameSpan) {
        userNameSpan.textContent = 'Cashier'; 
    }
}

async function loadCategories() {
    try {
        const res = await fetch('/api/categories', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load categories');
        categories = await res.json();
        console.log("Categories fetched:", categories);
        populateCategoryDropdown();
    } catch (error) {
        console.error("Failed to load categories:", error);
    }
}

function populateCategoryDropdown() {
    if (!categoryDropdownMenu) return;

    const itemsToKeep = categoryDropdownMenu.querySelectorAll('li:first-child, li:nth-child(2)');
    categoryDropdownMenu.innerHTML = '';
    itemsToKeep.forEach(item => categoryDropdownMenu.appendChild(item));

    categories.forEach(category => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.classList.add('dropdown-item');
        a.href = '#';
        a.setAttribute('data-category-id', category.id);
        a.textContent = category.name;
        li.appendChild(a);
        categoryDropdownMenu.appendChild(li);
    });
}

async function loadBanner() {
    try {
        const res = await fetch('/api/banner', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load banner');
        const banner = await res.json();
        const bannerImage = (banner && banner.imageBase64) ? banner.imageBase64 : PLACEHOLDER_IMAGE;
        if (bannerContainer) {
            const title = banner && banner.title ? banner.title : '';
            const subtitle = banner && banner.subtitle ? banner.subtitle : '';
            bannerContainer.innerHTML = `
                <div class="card text-white bg-dark">
                    <img src="${bannerImage}" class="card-img" alt="${title}" style="object-fit: cover; height: 200px;">
                    <div class="card-img-overlay d-flex flex-column justify-content-center">
                        <h2 class="card-title">${title}</h2>
                        <p class="card-text">${subtitle}</p>
                    </div>
                </div>`;
        }
    } catch (error) {
        console.error('Failed to load banner:', error);
    }
}

async function loadQrisImage() {
    try {
        const res = await fetch('/api/qris', { cache: 'no-store' }); 
        const qris = await res.json();
        if (qris && qris.imageBase64) { 
            qrisImageSrc = qris.imageBase64; 
        } else { 
            qrisImageSrc = PLACEHOLDER_IMAGE; 
        }
        const qrisCheckoutImage = document.getElementById('qrisCheckoutImage');
        if (qrisCheckoutImage) {
            qrisCheckoutImage.src = qrisImageSrc;
        }
    } catch (error) { 
        console.error("Failed to load QRIS image:", error); 
    }
}

async function loadProducts() {
    try {
        console.log("Fetching products from API...");
        const res = await fetch('/api/products', { cache: 'no-store' }); 
        if (!res.ok) { 
            throw new Error(`HTTP error! status: ${res.status}`); 
        }
        products = await res.json();
        console.log("Products fetched:", products);
        renderProducts();
    } catch (error) { 
        console.error("Failed to load products:", error); 
        if (productList) {
            productList.innerHTML = `<div class="col-12"><div class="alert alert-danger">Failed to load products. Please check the console.</div></div>`; 
        }
    }
}

function getFilteredProducts() {
    let filteredProducts = products;

    if (currentCategory !== 'all') {
        filteredProducts = filteredProducts.filter(p => p.categoryId && p.categoryId.toString() === currentCategory);
    }

    if (searchTerm) {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        filteredProducts = filteredProducts.filter(product => {
            const productNameMatch = product.name && product.name.toLowerCase().includes(lowerCaseSearchTerm);
            const category = categories.find(c => c.id === product.categoryId);
            const categoryNameMatch = category && category.name && category.name.toLowerCase().includes(lowerCaseSearchTerm);
            return productNameMatch || categoryNameMatch;
        });
    }

    if (currentFilter === 'top') {
        filteredProducts = filteredProducts.filter(p => p.isTopProduct);
    } else if (currentFilter === 'best') {
        filteredProducts = filteredProducts.filter(p => p.isBestSeller);
    }
    
    return filteredProducts;
}

function renderProducts() {
    if (!productList) return;

    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) { 
        const tooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl); 
        if (tooltip) { 
            tooltip.dispose(); 
        } 
    });

    const filteredProducts = getFilteredProducts();
    
    if (filteredProducts.length === 0) { 
        productList.innerHTML = `<div class="col-12"><p class="text-muted">No products found.</p></div>`; 
        return; 
    }
    
    productList.innerHTML = filteredProducts.map(product => {
        const productId = product.id || 0;
        const productName = product.name || 'Unknown Product';
        const productPrice = product.price || 0;
        const productStock = product.stock || 0;
        const productImage = product.imageBase64 || PLACEHOLDER_IMAGE;
        const tooltipContent = `<strong>${productName}</strong><br><img src="${productImage}" alt="${productName}">`;
        
        return `
        <div class="col-md-6 col-lg-4">
            <div class="card product-card h-100" onclick="addToCart(${productId})">
                <img src="${productImage}" class="card-img-top" alt="${productName}" data-bs-toggle="tooltip" data-bs-html="true" data-bs-title="${tooltipContent.replace(/"/g, '&quot;')}">
                <div class="card-body">
                    <h5 class="card-title">${productName}</h5>
                    <p class="card-text">Rp ${productPrice.toLocaleString('id-ID')}</p>
                    <span class="badge bg-secondary">Stock: ${productStock}</span>
                </div>
            </div>
        </div>
    `}).join('');

    const newTooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    newTooltipTriggerList.map(function (tooltipTriggerEl) { 
        return new bootstrap.Tooltip(tooltipTriggerEl, { 
            trigger: 'hover focus', 
            placement: 'auto', 
            delay: { "show": 300, "hide": 100 } 
        }); 
    });
}

function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock === 0) { 
        alert('Product is out of stock!'); 
        return; 
    }
    
    const existingItem = cart.find(item => item.productId === productId);
    if (existingItem) { 
        if (existingItem.qty < product.stock) existingItem.qty++; 
        else { 
            alert('Cannot add more. Stock limit reached.'); 
            return; 
        } 
    } else { 
        cart.push({ 
            productId, 
            name: product.name || 'Unknown Product', 
            price: product.price || 0, 
            qty: 1 
        }); 
    }
    renderCart();
}

function renderCart() {
    if (!cartItems || !cartTotal) return;
    
    if (cart.length === 0) { 
        cartItems.innerHTML = '<p class="text-muted">Cart is empty.</p>'; 
        cartTotal.textContent = 'Rp 0'; 
        return; 
    }
    
    cartItems.innerHTML = cart.map((item, index) => {
        const itemName = item.name || 'Unknown Item';
        const itemPrice = item.price || 0;
        const itemQty = item.qty || 0;
        
        return `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
                <strong>${itemName}</strong><br>
                <small>Rp ${itemPrice.toLocaleString('id-ID')} x ${itemQty}</small>
            </div>
            <div>
                <button class="btn btn-sm btn-outline-secondary" onclick="updateCartQty(${index}, -1)">-</button>
                <span class="mx-2">${itemQty}</span>
                <button class="btn btn-sm btn-outline-secondary" onclick="updateCartQty(${index}, 1)">+</button>
                <button class="btn btn-sm btn-danger ms-2" onclick="removeFromCart(${index})">&times;</button>
            </div>
        </div>
    `}).join('');
    
    const total = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
    cartTotal.textContent = `Rp ${total.toLocaleString('id-ID')}`;
}

function updateCartQty(index, change) {
    if (index < 0 || index >= cart.length) return;
    
    const product = products.find(p => p.id === cart[index].productId);
    if (!product) return;
    
    cart[index].qty = (cart[index].qty || 0) + change;
    
    if (cart[index].qty <= 0) { 
        removeFromCart(index); 
    } else if (cart[index].qty > product.stock) { 
        alert('Cannot add more. Stock limit reached.'); 
        cart[index].qty = product.stock; 
    }
    renderCart();
}

function removeFromCart(index) { 
    if (index < 0 || index >= cart.length) return;
    cart.splice(index, 1); 
    renderCart(); 
}

// --- PERBAIKAN: Fungsi Draf yang Benar ---
async function loadDrafts() {
    if (!draftsList) return;
    try {
        const res = await fetch('/api/drafts', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch drafts');
        drafts = await res.json();
        renderDrafts();
    } catch (error) {
        console.error("Failed to load drafts:", error);
        draftsList.innerHTML = `<p class="text-danger">Failed to load drafts.</p>`;
    }
}

function renderDrafts() {
    if (!draftsList) return;
    
    if (drafts.length === 0) { 
        draftsList.innerHTML = `<p class="text-muted">No saved drafts.</p>`; 
        return; 
    }
    
    draftsList.innerHTML = `
        <div class="list-group">
            ${drafts.map(d => {
                const total = d.items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
                return `
                <div class="list-group-item">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">${d.items.length} Items</h6>
                        <small>${new Date(d.timestamp).toLocaleString()}</small>
                    </div>
                    <p class="mb-1">Total: Rp ${total.toLocaleString('id-ID')}</p>
                    <div class="btn-group btn-group-sm" role="group">
                        <button class="btn btn-outline-primary" onclick="loadDraftToCart('${d.id}')">Load</button>
                        <button class="btn btn-outline-danger" onclick="deleteDraft('${d.id}')">Delete</button>
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
}

async function saveDraft() {
    if (cart.length === 0) { 
        alert('Cart is empty! Nothing to save.'); 
        return; 
    }
    
    try {
        const res = await fetch('/api/drafts', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ items: cart }) 
        });
        const result = await res.json();

        if (!res.ok) throw new Error(result.message || 'Failed to save draft');

        alert(result.message);
        cart = [];
        renderCart();
        await loadDrafts();
    } catch (error) {
        console.error("Failed to save draft:", error);
        alert(`Failed to save draft: ${error.message}`);
    }
}

async function loadDraftToCart(draftId) {
    if (!confirm('Loading this draft will replace your current cart. Are you sure?')) { return; }
    try {
        const res = await fetch(`/api/drafts/${draftId}/load`, { method: 'PUT' });
        const result = await res.json();

        if (!res.ok) throw new Error(result.message || 'Failed to load draft');

        cart = result.items;
        renderCart();
        
        // Hapus draf dari array lokal untuk update UI yang cepat
        drafts = drafts.filter(d => d.id !== draftId);
        renderDrafts();

    } catch (error) {
        console.error("Failed to load draft:", error);
        alert(`Failed to load draft: ${error.message}`);
    }
}

async function deleteDraft(draftId) {
    if (!confirm('Are you sure you want to delete this draft?')) { return; }
    try {
        const res = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
        const result = await res.json();

        if (!res.ok) throw new Error(result.message || 'Failed to delete draft');

        // Hapus dari array lokal dan render ulang
        drafts = drafts.filter(d => d.id !== draftId);
        renderDrafts();
    } catch (error) {
        console.error("Failed to delete draft:", error);
        alert(`Failed to delete draft: ${error.message}`);
    }
}

// --- Functions for Recent Transactions ---
async function loadRecentTransactions() {
    if (!recentTransactionsList) return;
    try {
        const res = await fetch('/api/recent-transactions', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch recent transactions');
        const recentTransactionsData = await res.json();
        renderRecentTransactions(recentTransactionsData);
    } catch (error) {
        console.error("Failed to load recent transactions:", error);
        recentTransactionsList.innerHTML = `<p class="text-danger">Failed to load transactions.</p>`;
    }
}

function renderRecentTransactions(transactions) {
    recentTransactions = transactions;
    if (!recentTransactionsList) return;
    
    if (transactions.length === 0) { 
        recentTransactionsList.innerHTML = `<p class="text-muted">No recent transactions.</p>`; 
        return; 
    }
    
    recentTransactionsList.innerHTML = `
        <div class="table-responsive">
            <table class="table table-sm table-striped">
                <thead><tr><th>ID</th><th>Time</th><th>Total</th><th>Actions</th></tr></thead>
                <tbody>${transactions.map(t => {
                    const totalAmount = t.totalAmount || 0;
                    return `<tr>
                        <td>${t.id}</td>
                        <td>${new Date(t.timestamp).toLocaleTimeString()}</td>
                        <td>Rp ${totalAmount.toLocaleString('id-ID')}</td>
                        <td><button class="btn btn-sm btn-info" onclick="showTransactionDetails('${t.id}')">View</button></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>
    `;
}

function showTransactionDetails(transactionId) {
    const transaction = recentTransactions.find(t => t.id === transactionId);
    if (!transaction) { 
        console.error('Transaction not found!'); 
        return; 
    }
    
    transactionToVoidId = transactionId;
    const itemsHtml = transaction.items.map(item => {
        const itemName = item.name || 'Unknown Item';
        const itemPrice = item.price || 0;
        const itemQty = item.qty || 0;
        const itemSubtotal = item.subtotal || (itemPrice * itemQty);
        
        return `<tr>
            <td>${itemName}</td>
            <td>Rp ${itemPrice.toLocaleString('id-ID')}</td>
            <td>${itemQty}</td>
            <td>Rp ${itemSubtotal.toLocaleString('id-ID')}</td>
        </tr>`;
    }).join('');
    
    const transactionDetailsContent = document.getElementById('transactionDetailsContent');
    if (transactionDetailsContent) {
        const totalAmount = transaction.totalAmount || 0;
        transactionDetailsContent.innerHTML = `
            <p><strong>Transaction ID:</strong> ${transaction.id}</p>
            <p><strong>Date & Time:</strong> ${new Date(transaction.timestamp).toLocaleString()}</p>
            <p><strong>Payment Method:</strong> ${transaction.paymentMethod}</p>
            <hr>
            <div class="table-responsive">
                <table class="table">
                    <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
                    <tbody>${itemsHtml}</tbody>
                    <tfoot><tr><th colspan="3">Total</th><th>Rp ${totalAmount.toLocaleString('id-ID')}</th></tr></tfoot>
                </table>
            </div>
        `;
    }
    
    if (printReceiptFromDetailsBtn) {
        printReceiptFromDetailsBtn.onclick = () => printReceipt(transaction);
    }

    transactionDetailsModal.show();
}

function printReceipt(transaction) {
    const receiptWindow = window.open('', '_blank');
    receiptWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt</title>
            <style>
                body { font-family: 'Courier New', Courier, monospace; padding: 20px; }
                h1 { text-align: center; }
                .details { margin: 20px 0; }
                .details p { margin: 5px 0; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px dashed #000; padding: 8px; text-align: left; }
                th { border-bottom: 2px solid #000; }
                .total { border-top: 2px solid #000; font-weight: bold; }
                .footer { margin-top: 30px; text-align: center; font-size: 0.9em; }
                @media print { body { padding: 0; }
            </style>
        </head>
        <body>
            <h1>SALES RECEIPT</h1>
            <div class="details">
                <p><strong>Transaction ID:</strong> ${transaction.id}</p>
                <p><strong>Date:</strong> ${new Date(transaction.timestamp).toLocaleDateString()}</p>
                <p><strong>Cashier:</strong> ${userNameSpan ? userNameSpan.textContent : 'Cashier'}</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Price</th>
                        <th>Qty</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${transaction.items.map(item => {
                        const itemName = item.name || 'Unknown Item';
                        const itemPrice = item.price || 0;
                        const itemQty = item.qty || 0;
                        const itemSubtotal = item.subtotal || (itemPrice * itemQty);
                        
                        return `
                        <tr>
                            <td>${itemName}</td>
                            <td>Rp ${itemPrice.toLocaleString('id-ID')}</td>
                            <td>${itemQty}</td>
                            <td>Rp ${itemSubtotal.toLocaleString('id-ID')}</td>
                        </tr>
                    `}).join('')}
                </tbody>
                <tfoot>
                    <tr class="total">
                        <td colspan="3">TOTAL</td>
                        <td>Rp ${(transaction.totalAmount || 0).toLocaleString('id-ID')}</td>
                    </tr>
                </tfoot>
            </table>
            <div class="details">
                <p><strong>Payment Method:</strong> ${transaction.paymentMethod ? transaction.paymentMethod.toUpperCase() : 'UNKNOWN'}</p>
                ${transaction.paymentMethod === 'cash' ? `
                    <p><strong>Amount Received:</strong> Rp ${(transaction.amountReceived || 0).toLocaleString('id-ID')}</p>
                    <p><strong>Change:</strong> Rp ${(transaction.change || 0).toLocaleString('id-ID')}</p>
                ` : ''}
            </div>
            <div class="footer">
                <p>Thank you for your purchase!</p>
            </div>
        </body>
        </html>
    `);
    receiptWindow.document.close();
    receiptWindow.print();
}

// PERBAIKAN: Fungsi startNewTransaction yang lebih andal
function startNewTransaction() {
    const isConfirmed = confirm("Are you sure you want to start a new transaction? The current cart will be cleared.");
    if (isConfirmed) {
        // Menggunakan location.reload() adalah cara termudah untuk mereset semua state
        window.location.reload();
    } else {
        // Tutup modal jika ada
        if (paymentSuccessModal) paymentSuccessModal.hide();
    }
}

function setupEventListeners() {
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            renderProducts();
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchTerm = '';
            renderProducts();
        });
    }

    if (categoryDropdownMenu) {
        categoryDropdownMenu.addEventListener('click', (e) => {
            e.preventDefault();
            if (e.target.classList.contains('dropdown-item')) {
                const categoryId = e.target.getAttribute('data-category-id');
                currentCategory = categoryId;
                
                if (categoryDropdownToggle) {
                    categoryDropdownToggle.innerHTML = `<i class="bi bi-funnel"></i> ${e.target.textContent}`;
                }
                renderProducts();
            }
        });
    }

    if (saveDraftBtn) {
        saveDraftBtn.addEventListener('click', saveDraft);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => { 
            await fetch('/api/logout', { method: 'POST' }); 
            window.location.href = '/login.html'; 
        });
    }

    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => { 
            if (cart.length === 0) { 
                alert('Cart is empty!'); 
                return; 
            } 
            
            const total = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0); 
            modalTotal.textContent = `Rp ${total.toLocaleString('id-ID')}`; 
            amountReceivedInput.value = ''; 
            changeAmountSpan.textContent = 'Rp 0'; 
            checkoutModal.show(); 
        });
    }

    document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => { 
        radio.addEventListener('change', (e) => { 
            if (e.target.value === 'cash') { 
                cashPaymentSection.style.display = 'block'; 
                qrisPaymentSection.style.display = 'none'; 
            } else { 
                cashPaymentSection.style.display = 'none'; 
                qrisPaymentSection.style.display = 'block'; 
            } 
        }); 
    });

    if (amountReceivedInput) {
        amountReceivedInput.addEventListener('input', () => { 
            const total = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0); 
            const received = parseInt(amountReceivedInput.value) || 0; 
            changeAmountSpan.textContent = `Rp ${(received - total).toLocaleString('id-ID')}`; 
        });
    }
    
    if (confirmPaymentBtn) {
        confirmPaymentBtn.addEventListener('click', async () => {
            const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
            const total = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
            let amountReceived = total;
            
            if (paymentMethod === 'cash') { 
                amountReceived = parseInt(amountReceivedInput.value) || 0; 
                if (amountReceived < total) { 
                    alert('Amount received is not enough!'); 
                    return; 
                } 
            }
            
            try {
                const res = await fetch('/api/transactions', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ items: cart, paymentMethod, amountReceived }) 
                });
                
                const result = await res.json();
                
                if (!res.ok) {
                    throw new Error(result.message || 'Transaction failed');
                }
                
                checkoutModal.hide();

                document.getElementById('successTransactionId').textContent = result.id;
                paymentSuccessModal.show();
                
                printReceiptBtn.onclick = () => printReceipt(result);

                // PERBAIKAN: Menambahkan event listener untuk tombol di modal yang dinamis
                const newTransactionBtn = document.querySelector('[data-bs-dismiss="modal"][onclick*="startNewTransaction"]');
                if(newTransactionBtn) {
                    newTransactionBtn.setAttribute('onclick', 'startNewTransaction()');
                }

                await loadProducts(); 
                await loadRecentTransactions();

            } catch (error) { 
                alert(`Transaction failed: ${error.message}`); 
            }
        });
    }

    if (voidTransactionBtn) {
        voidTransactionBtn.addEventListener('click', async () => {
            if (!transactionToVoidId) return;
            if (!confirm(`Are you sure you want to void transaction ${transactionToVoidId}? This will add the items back to your cart.`)) { return; }
            
            try {
                const res = await fetch(`/api/transactions/${transactionToVoidId}`, { method: 'DELETE' });
                const result = await res.json();
                
                if (result.success) {
                    alert(result.message);
                    const voidedTransaction = recentTransactions.find(t => t.id === transactionToVoidId);
                    if (voidedTransaction && voidedTransaction.items) {
                        cart = voidedTransaction.items;
                        renderCart();
                    }
                    transactionDetailsModal.hide();
                    await loadProducts(); 
                    await loadRecentTransactions();
                } else { 
                    alert(`Error: ${result.message}`); 
                }
            } catch (error) { 
                alert('Failed to void transaction.'); 
            }
        });
    }

    // --- Event Listener untuk Tombol Filter ---
    const filterAllBtn = document.getElementById('filterAll');
    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => { 
            currentFilter = 'all'; 
            searchTerm = ''; 
            if (searchInput) searchInput.value = ''; 
            currentCategory = 'all';
            if (categoryDropdownToggle) categoryDropdownToggle.innerHTML = '<i class="bi bi-funnel"></i> Category';
            renderProducts(); 
        });
    }

    const filterTopBtn = document.getElementById('filterTop');
    if (filterTopBtn) {
        filterTopBtn.addEventListener('click', () => { 
            currentFilter = 'top'; 
            searchTerm = ''; 
            if (searchInput) searchInput.value = ''; 
            currentCategory = 'all';
            if (categoryDropdownToggle) categoryDropdownToggle.innerHTML = '<i class="bi bi-funnel"></i> Category';
            renderProducts(); 
        });
    }

    const filterBestBtn = document.getElementById('filterBest');
    if (filterBestBtn) {
        filterBestBtn.addEventListener('click', () => { 
            currentFilter = 'best'; 
            searchTerm = ''; 
            if (searchInput) searchInput.value = ''; 
            currentCategory = 'all';
            if (categoryDropdownToggle) categoryDropdownToggle.innerHTML = '<i class="bi bi-funnel"></i> Category';
            renderProducts(); 
        });
    }
}