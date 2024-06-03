// Include the MovingMarker class definition in main.js
L.interpolatePosition = function (p1, p2, duration, t) {
    if (!p1 || !p2) {
        return L.latLng(0, 0); // Default to a valid position if either point is missing
    }
    var k = t / duration;
    k = (k > 0) ? k : 0;
    k = (k > 1) ? 1 : k;
    return L.latLng(p1.lat + k * (p2.lat - p1.lat),
        p1.lng + k * (p2.lng - p1.lng));
};

L.Marker.MovingMarker = L.Marker.extend({

    // state constants
    statics: {
        notStartedState: 0,
        endedState: 1,
        pausedState: 2,
        runState: 3
    },

    options: {
        autostart: false,
        loop: false,
    },

    initialize: function (latlngs, durations, options) {
        L.Marker.prototype.initialize.call(this, latlngs[0], options);

        this._latlngs = latlngs.map(function (e, index) {
            return L.latLng(e);
        });

        if (durations instanceof Array) {
            this._durations = durations;
        } else {
            this._durations = this._createDurations(this._latlngs, durations);
        }

        this._currentDuration = 0;
        this._currentIndex = 0;

        this._state = L.Marker.MovingMarker.notStartedState;
        this._startTime = 0;
        this._startTimeStamp = 0;  // timestamp given by requestAnimFrame
        this._pauseStartTime = 0;
        this._animId = 0;
        this._animRequested = false;
        this._currentLine = [];
        this._stations = {};
    },

    isRunning: function () {
        return this._state === L.Marker.MovingMarker.runState;
    },

    isEnded: function () {
        return this._state === L.Marker.MovingMarker.endedState;
    },

    isStarted: function () {
        return this._state !== L.Marker.MovingMarker.notStartedState;
    },

    isPaused: function () {
        return this._state === L.Marker.MovingMarker.pausedState;
    },

    start: function () {
        if (this.isRunning()) {
            return;
        }

        if (this.isPaused()) {
            this.resume();
        } else {
            this._loadLine(0);
            this._startAnimation();
            this.fire('start');
        }
    },

    resume: function () {
        if (!this.isPaused()) {
            return;
        }
        // update the current line
        this._currentLine[0] = this.getLatLng();
        this._currentDuration -= (this._pauseStartTime - this._startTime);
        this._startAnimation();
    },

    pause: function () {
        if (!this.isRunning()) {
            return;
        }

        this._pauseStartTime = Date.now();
        this._state = L.Marker.MovingMarker.pausedState;
        this._stopAnimation();
        this._updatePosition();
    },

    stop: function (elapsedTime) {
        if (this.isEnded()) {
            return;
        }

        this._stopAnimation();

        if (typeof (elapsedTime) === 'undefined') {
            // user call
            elapsedTime = 0;
            this._updatePosition();
        }

        this._state = L.Marker.MovingMarker.endedState;
        this.fire('end', {elapsedTime: elapsedTime});
    },

    addLatLng: function (latlng, duration) {
        this._latlngs.push(L.latLng(latlng));
        this._durations.push(duration);
    },

    moveTo: function (latlng, duration) {
        this._stopAnimation();
        this._latlngs = [this.getLatLng(), L.latLng(latlng)];
        this._durations = [duration];
        this._state = L.Marker.MovingMarker.notStartedState;
        this.start();
        this.options.loop = false;
    },

    addStation: function (pointIndex, duration) {
        if (pointIndex > this._latlngs.length - 2 || pointIndex < 1) {
            return;
        }
        this._stations[pointIndex] = duration;
    },

    onAdd: function (map) {
        L.Marker.prototype.onAdd.call(this, map);

        if (this.options.autostart && (!this.isStarted())) {
            this.start();
            return;
        }

        if (this.isRunning()) {
            this._resumeAnimation();
        }
    },

    onRemove: function (map) {
        L.Marker.prototype.onRemove.call(this, map);
        this._stopAnimation();
    },

    _createDurations: function (latlngs, duration) {
        var lastIndex = latlngs.length - 1;
        var distances = [];
        var totalDistance = 0;
        var distance = 0;

        // compute array of distances between points
        for (var i = 0; i < lastIndex; i++) {
            distance = latlngs[i + 1].distanceTo(latlngs[i]);
            distances.push(distance);
            totalDistance += distance;
        }

        var ratioDuration = duration / totalDistance;

        var durations = [];
        for (i = 0; i < distances.length; i++) {
            durations.push(distances[i] * ratioDuration);
        }

        return durations;
    },

    _startAnimation: function () {
        this._state = L.Marker.MovingMarker.runState;
        this._animId = L.Util.requestAnimFrame(function (timestamp) {
            this._startTime = Date.now();
            this._startTimeStamp = timestamp;
            this._animate(timestamp);
        }, this, true);
        this._animRequested = true;
    },

    _resumeAnimation: function () {
        if (!this._animRequested) {
            this._animRequested = true;
            this._animId = L.Util.requestAnimFrame(function (timestamp) {
                this._animate(timestamp);
            }, this, true);
        }
    },

    _stopAnimation: function () {
        if (this._animRequested) {
            L.Util.cancelAnimFrame(this._animId);
            this._animRequested = false;
        }
    },

    _updatePosition: function () {
        var elapsedTime = Date.now() - this._startTime;
        this._animate(this._startTimeStamp + elapsedTime, true);
    },

    _loadLine: function (index) {
        this._currentIndex = index;
        this._currentDuration = this._durations[index];
        this._currentLine = this._latlngs.slice(index, index + 2);
    },

    _updateLine: function (timestamp) {
        var elapsedTime = timestamp - this._startTimeStamp;

        if (elapsedTime <= this._currentDuration) {
            return elapsedTime;
        }

        var lineIndex = this._currentIndex;
        var lineDuration = this._currentDuration;
        var stationDuration;

        while (elapsedTime > lineDuration) {
            elapsedTime -= lineDuration;
            stationDuration = this._stations[lineIndex + 1];

            if (stationDuration !== undefined) {
                if (elapsedTime < stationDuration) {
                    this.setLatLng(this._latlngs[lineIndex + 1]);
                    return null;
                }
                elapsedTime -= stationDuration;
            }

            lineIndex++;

            if (lineIndex >= this._latlngs.length - 1) {
                if (this.options.loop) {
                    lineIndex = 0;
                    this.fire('loop', {elapsedTime: elapsedTime});
                } else {
                    this.setLatLng(this._latlngs[this._latlngs.length - 1]);
                    this.stop(elapsedTime);
                    return null;
                }
            }
            lineDuration = this._durations[lineIndex];
        }

        this._loadLine(lineIndex);
        this._startTimeStamp = timestamp - elapsedTime;
        this._startTime = Date.now() - elapsedTime;
        return elapsedTime;
    },

    _animate: function (timestamp, noRequestAnim) {
        this._animRequested = false;

        var elapsedTime = this._updateLine(timestamp);

        if (this.isEnded()) {
            return;
        }

        if (elapsedTime != null) {
            var p = L.interpolatePosition(this._currentLine[0],
                this._currentLine[1],
                this._currentDuration,
                elapsedTime);

            this.setLatLng(p);
        }

        if (!noRequestAnim) {
            this._animId = L.Util.requestAnimFrame(this._animate, this, false);
            this._animRequested = true;
        }
    }
});

L.Marker.movingMarker = function (latlngs, duration, options) {
    return new L.Marker.MovingMarker(latlngs, duration, options);
};

// Main script to integrate with the MovingMarker

// Initialize the map
const map = L.map('map').setView([0, 0], 2); // Start at a global view

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let movingMarker;

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
        'Authorization': `Bearer ${token}`
    }
})
.then(response => response.json())
.then(data => {
    if (data && data.lat && data.lon) {
        const latLng = [data.lat, data.lon];
        map.setView(latLng, 19); // Set the view to the last known coordinate
        movingMarker = L.Marker.movingMarker([latLng], [1000], { autostart: true }).addTo(map); // 1-second duration for initial position
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
    if (data && data.lat && data.lon) {
        const latLng = [data.lat, data.lon];
        if (!movingMarker) {
            movingMarker = L.Marker.movingMarker([latLng], [1000], { autostart: true }).addTo(map);
        } else {
            movingMarker.addLatLng(latLng, 1000); // Add new point with 1-second duration
        }
        map.setView(latLng, 19); // Zoom in to the location
    } else {
        console.error('Invalid GPS data received:', data);
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
