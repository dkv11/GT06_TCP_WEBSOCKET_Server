document.getElementById('registrationForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        email: document.getElementById('email').value,
        deviceid: document.getElementById('deviceid').value,
        contact: document.getElementById('contact').value,
        location: document.getElementById('location').value,
        chessisnumber: document.getElementById('chessisnumber').value,
        motorwattage: document.getElementById('motorwattage').value,
        braketype: document.getElementById('braketype').value,
        vehiclemodel: document.getElementById('vehiclemodel').value,
    };

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (response.ok) {
            document.getElementById('message').textContent = 'Registration successful!';
            document.getElementById('message').style.color = 'green';
        } else {
            document.getElementById('message').textContent = result.message;
        }
    } catch (error) {
        document.getElementById('message').textContent = 'An error occurred. Please try again.';
    }
});
