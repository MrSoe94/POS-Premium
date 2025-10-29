document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const alertContainer = document.getElementById('alertContainer');

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (result.success) {
        window.location.href = result.role === 'admin' ? '/admin.html' : '/pos.html';
    } else {
        alertContainer.innerHTML = `<div class="alert alert-danger">${result.message}</div>`;
    }
});