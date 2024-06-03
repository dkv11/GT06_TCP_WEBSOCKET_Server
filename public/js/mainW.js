// Initialize the map
const map = L.map('map').setView([0, 0], 2); // Start at a global view

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let marker;

// Connect to the WebSocket server
const socket = io();

// Hardcoded IMEI for demonstration
const imei = '0866436050434744';


// Subscribe to location data namespace
socket.emit('subscribeLocation', imei);

// Subscribe to status data namespace
socket.emit('subscribeStatus', imei);

// Listen for GPS coordinate data
socket.on('gpsData', (data) => {
    console.log(data);
    if (data.lat && data.lon) {
        const latLng = [data.lat, data.lon];
        if (!marker) {
            marker = L.marker(latLng).addTo(map);
        } else {
            marker.setLatLng(latLng);
        }
        map.setView(latLng, 15); // Zoom in to the location
    }
});

// Listen for status data
socket.on('statusData', (data) => {
    console.log(data);
    document.getElementById('imei').textContent = `IMEI: ${data.imei}`;
    document.getElementById('voltageLevel').textContent = `Voltage Level: ${data.voltageLevel}`;
    document.getElementById('gsmSigStrength').textContent = `GSM Signal Strength: ${data.gsmSigStrength}`;
    document.getElementById('ignition').textContent = `Ignition: ${data.terminalInfo.ignition}`;
    document.getElementById('charging').textContent = `Charging: ${data.terminalInfo.charging}`;
    document.getElementById('alarmType').textContent = `Alarm Type: ${data.terminalInfo.alarmType}`;
    document.getElementById('gpsTracking').textContent = `GPS Tracking: ${data.terminalInfo.gpsTracking}`;
    document.getElementById('relayState').textContent = `Relay State: ${data.terminalInfo.relayState}`;
});
