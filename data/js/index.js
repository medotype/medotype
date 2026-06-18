const iframe = document.getElementById('main-frame');
const navLinks = document.querySelectorAll('.nav-links a');

function navigateFrame(url, element) {
    iframe.classList.remove('loaded');
    iframe.src = url;
    
    if (element && element.tagName === 'A') {
        navLinks.forEach(link => link.classList.remove('active'));
        element.classList.add('active');
    }
}

function updateTitle() {
    try {
        const newTitle = iframe.contentDocument.title || iframe.title;
        if (newTitle && newTitle !== "Loading...") {
            document.title = newTitle;
        }
    } catch (e) {
    }
}

iframe.onload = function() {
    iframe.classList.add('loaded');
    updateTitle();
    
    if (typeof window.syncNav === 'function') {
        window.syncNav();
    }
};

function handleSearch() {
    const input = document.getElementById('global-search');
    const query = input.value.trim();
    if (query) {

        navigateFrame(`pages/loadprofile.html?username=${encodeURIComponent(query)}`, { tagName: 'SEARCH' });
        input.value = ''; 
    }
}

setInterval(updateTitle, 1000);
