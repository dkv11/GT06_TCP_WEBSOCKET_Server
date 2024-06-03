// Initialize the map
const map = L.map('map').setView([0, 0], 2); // Start at a global view

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let marker;

// Retrieve token and IMEI from local storage
const token = localStorage.getItem('token');
const imei = localStorage.getItem('imei');
console.log(token);
console.log(imei);

if (!token || !imei) {
    window.location.href = '/login'; // Redirect to login page if not authenticated
}

// Fetch the last known coordinate from the server
fetch(`/gps/${imei}`, {
    method: 'GET',
    headers: {
        'Authorization': token
    }
})
.then(response => response.json())
.then(data => {
    if (data.lat && data.lon) {
        const latLng = [data.lat, data.lon];
        map.setView(latLng, 19); // Set the view to the last known coordinate
        marker = L.marker(latLng).addTo(map);
    } else {
        console.error('No valid coordinates found for this IMEI');
    }
})
.catch(error => {
    console.error('Error fetching last known coordinates:', error);
});


// Connect to the WebSocket server
const socket = io({
    auth: {
        token: token
    }
});




socket.on('connect', () => {
    console.log('WebSocket connected');

    // Subscribe to location data namespace
    socket.emit('subscribeLocation', imei);

    // Subscribe to status data namespace
    socket.emit('subscribeStatus', imei);
});


// Listen for GPS coordinate data
socket.on('gpsData', (data) => {
    console.log('Received gpsData:', data);
    if (data.lat && data.lon) {
        const latLng = [data.lat, data.lon];
        if (!marker) {
            marker = L.marker(latLng).addTo(map);
        } else {
            marker.setLatLng(latLng);
        }
        map.setView(latLng, 19); // Zoom in to the location
    }
});

// Listen for status data
socket.on('statusData', (data) => {
    console.log('Received statusData:', data);
    document.getElementById('imei').textContent = `IMEI: ${data.imei}`;
    document.getElementById('voltageLevel').textContent = `Voltage Level: ${data.voltageLevel}`;
    document.getElementById('gsmSigStrength').textContent = `GSM Signal Strength: ${data.gsmSigStrength}`;
    document.getElementById('ignition').textContent = `Ignition: ${data.terminalInfo.ignition}`;
    document.getElementById('charging').textContent = `Charging: ${data.terminalInfo.charging}`;
    document.getElementById('alarmType').textContent = `Alarm Type: ${data.terminalInfo.alarmType}`;
    document.getElementById('gpsTracking').textContent = `GPS Tracking: ${data.terminalInfo.gpsTracking}`;
    document.getElementById('relayState').textContent = `Relay State: ${data.terminalInfo.relayState}`;
});
socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
});