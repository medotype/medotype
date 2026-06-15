(function () {
    function applyInitialTheme() {
        const savedTheme = localStorage.getItem('user-theme') || 'default';
        const targetClass = savedTheme === 'default' ? '' : savedTheme;


        document.documentElement.className = targetClass;
    }


    // fixed tom fuckery
    applyInitialTheme();

    document.addEventListener("DOMContentLoaded", () => {
        const savedTheme = localStorage.getItem('user-theme') || 'default';
        if (document.body) {
            document.body.className = savedTheme === 'default' ? '' : savedTheme;
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'user-theme') {
            const newTheme = e.newValue || 'default';
            const targetClass = newTheme === 'default' ? '' : newTheme;
            document.documentElement.className = targetClass;
            if (document.body) {
                document.body.className = targetClass;
            }
        }
    });
})();
