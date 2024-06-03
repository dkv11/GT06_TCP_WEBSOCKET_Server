const map = L.map('map').setView([0, 0], 2); // Default to a global view
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const markers = {}; // Store markers by IMEI
const gpsDataDiv = document.getElementById('gps-data'); // Get the div for GPS data

// Connect to WebSocket server
const socket = io('wss://2982-103-243-60-238.ngrok-free.app', {
  transports: ['websocket', 'polling']
});

// Function to subscribe to a device by IMEI
function subscribeToIMEI(imei) {
    socket.emit('trackDevice', imei);
    console.log(`Subscribed to track device with IMEI: ${imei}`);
}

// Function to update the GPS data div with new data
function updateGPSData(data) {
    gpsDataDiv.innerHTML = ''; // Clear previous data

    const fieldsToDisplay = {
        terminalInfo: data.terminalInfo,
        voltageLevel: data.voltageLevel,
        gsmSigStrength: data.gsmSigStrength,
        speed: data.speed,
        gpsPositioned: data.gpsPositioned,
        eastLongitude: data.eastLongitude,
        northLatitude: data.northLatitude,
        imei: data.imei
    };

    function createDataElement(key, value, isNested = false) {
        const p = document.createElement('p');
        p.textContent = `${key}: ${value}`;
        if (isNested) p.classList.add('nested');
        return p;
    }

    function appendData(key, value, parentElement) {
        if (typeof value === 'object' && value !== null) {
            parentElement.appendChild(createDataElement(key, '', false));
            Object.entries(value).forEach(([nestedKey, nestedValue]) => {
                parentElement.appendChild(createDataElement(nestedKey, nestedValue, true));
            });
        } else {
            parentElement.appendChild(createDataElement(key, value, false));
        }
    }

    // Create and append data elements
    Object.entries(fieldsToDisplay).forEach(([key, value]) => {
        appendData(key, value, gpsDataDiv);
    });

    console.log(`GPS data updated for IMEI: ${data.imei}`);
}

// Function to stop tracking a device by IMEI
function stopTrackingIMEI(imei) {
    socket.emit('stopTrackingDevice', imei);
    if (markers[imei]) {
        map.removeLayer(markers[imei]);
        delete markers[imei];
    }
}

// Handle incoming GPS data
socket.on('gpsData', function(data) {
    console.log("Received GPS data:", data);
    updateGPSData(data);
    const { imei, lat, lon } = data;

    // Ensure lat and lon are valid and not zero
    if (typeof lat === 'number' && typeof lon === 'number' && lat !== 0 && lon !== 0) {
        const position = [lat, lon];

        if (!markers[imei]) {
            markers[imei] = L.marker(position, { title: `IMEI: ${imei}` }).addTo(map);
        } else {
            markers[imei].setLatLng(position);
        }

        map.setView(position, 13); // Focus on the updated position
    } else {
        console.error('Invalid LatLng data:', lat, lon);
    }
});

// Example: Subscribe to a device
subscribeToIMEI('0866436050434744');
