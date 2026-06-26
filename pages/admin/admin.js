const JUMPSCARE_PRESETS = {
    "shittyclown": { "name": "that one shitty clown", "url": "../data/images/jumpscares/shittyclown.png" },
    "cityboii": { "name": "city boii", "url": "../data/images/jumpscares/cityboii.png" },
    "fart": { "name": "fart", "url": "../data/images/jumpscares/fart.png" },
    "doggun": { "name": "doggun", "url": "../data/images/jumpscares/doggun.png" }
};

const SB_URL = 'https://tzaowqeofmwfnprrfwat.supabase.co';
const SB_KEY = 'sb_publishable_Sr33ux9FL6QZaJlfhjoqFw_tIwQhSbx';
const _supabase = supabase.createClient(SB_URL, SB_KEY);

// Globals
let loadedUsersList = [];
let currentPage = 1;
const USERS_PER_PAGE = 10;

// Shop & Inventory Globals
let masterCatalog = [];
let activeStockIds = [];
let editingUserId = null;
let currentAdminUsername = "Administrator";

const communicationChannel = _supabase.channel('app-jumpscare-stream');
communicationChannel.subscribe();

window.onload = function() {
    buildPresetsMenu();
    if (sessionStorage.getItem('admin_session_active') === 'true') {
        if (sessionStorage.getItem('admin_username')) {
            currentAdminUsername = sessionStorage.getItem('admin_username');
        }
        displayDashboardView();
    }
};

// Organization Navigation Controls
function switchAdminTab(tabId, element) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    element.classList.add('active');
}

function buildPresetsMenu() {
    const selectMenu = document.getElementById('scare-type');
    if (!selectMenu) return;
    selectMenu.innerHTML = '';
    
    for (const key in JUMPSCARE_PRESETS) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = JUMPSCARE_PRESETS[key].name;
        selectMenu.appendChild(option);
    }
    
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom URL';
    selectMenu.appendChild(customOption);
}

async function verifyDashboardAccess() {
    const inputPassword = document.getElementById('gate-pass').value;

    if (inputPassword !== 'admin53') {
        showToastMessage("Incorrect password.", true);
        return;
    }

    const { data: { session }, error: sessionErr } = await _supabase.auth.getSession();
    if (sessionErr || !session) {
        showToastMessage("No active user login found. Please sign in first.", true);
        return;
    }

    const { data: profile, error: profileErr } = await _supabase
        .from('profiles')
        .select('is_admin, username')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profileErr || !profile || !profile.is_admin) {
        showToastMessage("Access denied. Your account is not marked as an administrator.", true);
        return;
    }

    currentAdminUsername = profile.username || "Admin";
    sessionStorage.setItem('admin_session_active', 'true');
    sessionStorage.setItem('admin_username', currentAdminUsername);
    displayDashboardView();
}

function displayDashboardView() {
    document.getElementById('lock-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'block';
    
    loadShopManagementData();
    showToastMessage("Dashboard session opened.");
}

// ==========================================
// Global Messaging Broadcast Logic
// ==========================================
function sendGlobalServerMessage() {
    const msgText = document.getElementById('global-msg-text').value.trim();
    if (!msgText) {
        showToastMessage("Please enter a message to broadcast.", true);
        return;
    }

    communicationChannel.send({
        type: 'broadcast',
        event: 'global-message',
        payload: {
            sender: currentAdminUsername,
            message: msgText
        }
    });

    document.getElementById('global-msg-text').value = '';
    showToastMessage("Global system announcement broadcasted successfully.");
}

// ==========================================
// Daily Chest Settings Configuration Logic
// ==========================================
async function saveGlobalChestSettings() {
    const baseCoins = parseInt(document.getElementById('chest-base-coins').value) || 250;
    const cooldownHrs = parseInt(document.getElementById('chest-cooldown-hours').value) || 24;

    // Broadcasting setting shifts so active connected client instances catch architecture updates
    communicationChannel.send({
        type: 'broadcast',
        event: 'chest-settings-update',
        payload: { baseCoins, cooldownHrs }
    });

    showToastMessage(`Rewards Architecture updated: ${baseCoins} Coins / ${cooldownHrs}hr cooldown`);
}

async function resetUserChestCooldown(userId, username) {
    // Standard system update tracking mapping directly into user's state column entries
    const { error } = await _supabase
        .from('profiles')
        .update({ last_chest_claim: null, daily_chest_available: true })
        .eq('id', userId);

    if (error) {
        console.error(error);
        showToastMessage("Failed to clear claim tracking limits.", true);
    } else {
        showToastMessage(`Daily chest reset for ${username}!`);
        loadAllUsers();
    }
}

// ==========================================
// Shop Management Logic
// ==========================================
async function loadShopManagementData() {
    const { data: items } = await _supabase.from('items').select('*').order('price', { ascending: true });
    masterCatalog = items || [];
    
    const { data: stock } = await _supabase.from('instock').select('item_id');
    activeStockIds = (stock || []).map(row => row.item_id);
    
    renderShopManagementPanel();
}

function renderShopManagementPanel() {
    const container = document.getElementById('shop-items-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (masterCatalog.length === 0) {
        container.innerHTML = '<span style="color: var(--text-faded);">No items found in database.</span>';
        return;
    }

    masterCatalog.forEach(item => {
        const isStocked = activeStockIds.includes(item.id);
        const fallbackSrc = "../../data/images/default.png";
        
        container.innerHTML += `
            <label class="item-checkbox-label">
                <input type="checkbox" class="shop-stock-checkbox" value="${item.id}" ${isStocked ? 'checked' : ''}>
                <img src="${item.src}" onerror="this.src='${fallbackSrc}'" alt="${item.name}">
                <span>${item.name} <span style="color: var(--text-faded); font-size: 0.75rem;">(${item.price}c)</span></span>
            </label>
        `;
    });
}

async function saveShopStock() {
    const checkboxes = document.querySelectorAll('.shop-stock-checkbox:checked');
    const newStockIds = Array.from(checkboxes).map(cb => cb.value);

    await _supabase.from('instock').delete().not('item_id', 'is', null);

    const insertData = newStockIds.map(id => ({ item_id: id }));
    if (insertData.length > 0) {
        const { error } = await _supabase.from('instock').insert(insertData);
        if (error) {
            console.error(error);
            showToastMessage("Failed to update shop stock.", true);
            return;
        }
    }
    
    activeStockIds = newStockIds;
    showToastMessage("Storefront rotation updated successfully!");
}

async function addNewItem() {
    const id = document.getElementById('new-item-id').value.trim();
    const name = document.getElementById('new-item-name').value.trim();
    const src = document.getElementById('new-item-src').value.trim();
    const price = parseInt(document.getElementById('new-item-price').value) || 0;
    const category = document.getElementById('new-item-category').value.trim() || 'Standard';

    if (!id || !name || !src) {
        showToastMessage("ID, Name, and Image Source are required.", true);
        return;
    }

    const { error } = await _supabase.from('items').insert([
        { id: id, name: name, src: src, price: price, category: category }
    ]);

    if (error) {
        console.error(error);
        showToastMessage("Failed to add avatar: " + error.message, true);
    } else {
        showToastMessage(`Successfully added avatar: ${name}`);
        
        document.getElementById('new-item-id').value = '';
        document.getElementById('new-item-name').value = '';
        document.getElementById('new-item-src').value = '';
        document.getElementById('new-item-price').value = '';
        document.getElementById('new-item-category').value = '';
        
        loadShopManagementData();
    }
}

// ==========================================
// User Inventory Modal Logic
// ==========================================
function openInventoryModal(userId, username) {
    editingUserId = userId;
    const user = loadedUsersList.find(u => u.id === userId);
    const userInv = user ? (user.unlocked_avatars || ["default"]) : ["default"];

    document.getElementById('inv-modal-title').innerText = `Manage Inventory: ${username}`;
    const container = document.getElementById('inv-modal-items');
    container.innerHTML = '';

    masterCatalog.forEach(item => {
        const ownsItem = userInv.includes(item.id);
        const isDefault = item.id === 'default';
        const fallbackSrc = "../../data/images/default.png";
        
        const disabledAttr = isDefault ? 'disabled checked' : (ownsItem ? 'checked' : '');
        
        container.innerHTML += `
            <label class="item-checkbox-label" style="justify-content: flex-start; opacity: ${isDefault ? '0.6' : '1'}">
                <input type="checkbox" class="user-inv-checkbox" value="${item.id}" ${disabledAttr}>
                <img src="${item.src}" onerror="this.src='${fallbackSrc}'" alt="${item.name}">
                <div style="display:flex; flex-direction: column;">
                    <span>${item.name} ${isDefault ? '<span style="font-size: 0.65rem; color: var(--accent);">(Base)</span>' : ''}</span>
                    <span style="font-size: 0.7rem; color: var(--text-faded);">${item.category || 'Standard'}</span>
                </div>
            </label>
        `;
    });

    document.getElementById('inventory-modal').style.display = 'block';
    document.getElementById('modal-overlay').style.display = 'block';
}

function closeInventoryModal() {
    document.getElementById('inventory-modal').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
    editingUserId = null;
}

async function saveUserInventory() {
    if (!editingUserId) return;
    
    const checkboxes = document.querySelectorAll('.user-inv-checkbox:checked');
    let newInv = Array.from(checkboxes).map(cb => cb.value);
    if (!newInv.includes('default')) newInv.push('default');

    const { error } = await _supabase
        .from('profiles')
        .update({ unlocked_avatars: newInv })
        .eq('id', editingUserId);

    if (error) {
        console.error(error);
        showToastMessage("Failed to update user inventory.", true);
    } else {
        showToastMessage("User inventory updated!");
        const user = loadedUsersList.find(u => u.id === editingUserId);
        if (user) user.unlocked_avatars = newInv;
        closeInventoryModal();
    }
}

// ==========================================
// Dashboard & User Logic
// ==========================================
async function searchForUser() {
    const usernameInput = document.getElementById('search-input').value.trim();
    if (!usernameInput) {
        showToastMessage("Please type a username to search.", true);
        return;
    }

    setTableLoadingState("Searching database...");

    const { data: results, error } = await _supabase
        .from('profiles')
        .select('id, username, coins, elo, unlocked_avatars')
        .ilike('username', `%${usernameInput}%`); 

    if (error) {
        setTableLoadingState("Error searching database.");
        return;
    }

    loadedUsersList = results;
    currentPage = 1;
    processAndDisplayPageData();
}

async function loadAllUsers() {
    setTableLoadingState("Loading all user data...");

    const { data: results, error } = await _supabase
        .from('profiles')
        .select('id, username, coins, elo, unlocked_avatars');

    if (error) {
        setTableLoadingState("Error loading tables from server.");
        return;
    }

    loadedUsersList = results;
    currentPage = 1;
    processAndDisplayPageData();
}

function processAndDisplayPageData() {
    const tbody = document.getElementById('user-tbody');
    if (!tbody) return;

    if (loadedUsersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-faded)">No user entries found matching criteria.</td></tr>`;
        updateDashboardMetrics(0, 0, 0);
        updatePaginationControls(1, 1);
        return;
    }

    let totalCoins = 0;
    let totalEloSum = 0;
    loadedUsersList.forEach(u => {
        totalCoins += (u.coins || 0);
        totalEloSum += (u.elo || 0);
    });
    const averageElo = Math.round(totalEloSum / loadedUsersList.length);
    updateDashboardMetrics(loadedUsersList.length, totalCoins, averageElo);

    const selectedSort = document.getElementById('sort-filter').value;
    let listToSort = [...loadedUsersList];

    if (selectedSort === 'username') {
        listToSort.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    } else if (selectedSort === 'coins') {
        listToSort.sort((a, b) => (b.coins || 0) - (a.coins || 0));
    } else if (selectedSort === 'elo') {
        listToSort.sort((a, b) => (b.elo || 0) - (a.elo || 0));
    }

    const totalPages = Math.ceil(listToSort.length / USERS_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = startIndex + USERS_PER_PAGE;
    const activePageItems = listToSort.slice(startIndex, endIndex);

    updatePaginationControls(currentPage, totalPages);

    tbody.innerHTML = '';
    activePageItems.forEach(user => {
        const tr = document.createElement('tr');
        const cleanNameEscaped = (user.username || 'Unregistered').replace(/'/g, "\\'");
        
        tr.innerHTML = `
            <td style="font-size: 0.8rem; color: var(--text-faded); font-family: monospace;">${user.id.substring(0, 8)}...</td>
            <td><strong>${user.username || 'Unregistered'}</strong></td>
            <td><input type="number" class="edit-input" id="coins-${user.id}" value="${user.coins || 0}"></td>
            <td><input type="number" class="edit-input" id="elo-${user.id}" value="${user.elo || 0}"></td>
            <td>
                <div class="action-cell-cluster">
                    <button class="btn btn-save" onclick="saveUserRowEdits('${user.id}')">Save</button>
                    <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 5px 10px;" onclick="openInventoryModal('${user.id}', '${cleanNameEscaped}')"><i class="fa-solid fa-box-open"></i> Inv</button>
                    <button class="btn btn-chest" onclick="resetUserChestCooldown('${user.id}', '${cleanNameEscaped}')"><i class="fa-solid fa-gift"></i> Reset Chest</button>
                    <button class="btn btn-mini-scare" onclick="transmitJumpscareSignal('${cleanNameEscaped}')"><i class="fa-solid fa-ghost"></i> Scare</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveUserRowEdits(userId) {
    const newCoinValue = parseInt(document.getElementById(`coins-${userId}`).value) || 0;
    const newEloValue = parseInt(document.getElementById(`elo-${userId}`).value) || 0;

    const { error } = await _supabase
        .from('profiles')
        .update({ coins: newCoinValue, elo: newEloValue })
        .eq('id', userId);

    if (error) {
        showToastMessage("Error: Saved changes rejected by database permissions.", true);
    } else {
        const localIndex = loadedUsersList.findIndex(u => u.id === userId);
        if (localIndex !== -1) {
            loadedUsersList[localIndex].coins = newCoinValue;
            loadedUsersList[localIndex].elo = newEloValue;
        }
        showToastMessage("User record saved successfully.");
        processAndDisplayPageData();
    }
}

function toggleCustomUrlInput() {
    const typeSelect = document.getElementById('scare-type').value;
    const customInput = document.getElementById('custom-scare-url');
    if (!customInput) return;
    if (typeSelect === 'custom') {
        customInput.style.display = 'block';
    } else {
        customInput.style.display = 'none';
    }
}

function transmitJumpscareSignal(targetUsername) {
    const typeSelect = document.getElementById('scare-type').value;
    let selectedVisual = '';
    
    if (typeSelect === 'custom') {
        selectedVisual = document.getElementById('custom-scare-url').value.trim();
        if (!selectedVisual) {
            showToastMessage("Please enter a custom image URL.", true);
            return;
        }
    } else {
        selectedVisual = JUMPSCARE_PRESETS[typeSelect].url;
    }

    communicationChannel.send({
        type: 'broadcast',
        event: 'execute-scare',
        payload: { 
            targetUsername: targetUsername,
            visualSource: selectedVisual
        }
    });

    if (targetUsername === 'all') {
        showToastMessage("Global jumpscare command sent to everyone online.");
    } else {
        showToastMessage(`Jumpscare command sent to target user: "${targetUsername}".`);
    }
}

function changeActivePage(step) {
    currentPage += step;
    processAndDisplayPageData();
}

function updateDashboardMetrics(count, coins, elo) {
    document.getElementById('stat-count').innerText = count;
    document.getElementById('stat-coins').innerText = coins.toLocaleString();
    document.getElementById('stat-elo').innerText = elo || 0;
}

function updatePaginationControls(current, total) {
    document.getElementById('page-indicator').innerText = `Page ${current} of ${total}`;
    document.getElementById('btn-prev').disabled = (current === 1);
    document.getElementById('btn-next').disabled = (current === total || total === 0);
}

function setTableLoadingState(message) {
    document.getElementById('user-tbody').innerHTML = `
        <tr><td colspan="5" style="text-align:center; color: var(--text-faded)"><i class="fa-solid fa-spinner fa-spin"></i> ${message}</td></tr>
    `;
}

function showToastMessage(text, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = text;
    if (isError) {
        toast.classList.add('err');
    } else {
        toast.classList.remove('err');
    }
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}
