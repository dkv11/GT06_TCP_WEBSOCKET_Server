document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok) {
            localStorage.setItem('token', result.token);
            localStorage.setItem('imei', result.imei);
            window.location.href = '/'; // Redirect to homepage or dashboard
        } else {
            document.getElementById('error-message').innerText = result.message;
        }
    } catch (error) {
        console.error('Login failed:', error);
        document.getElementById('error-message').innerText = 'An error occurred during login.';
    }
});
