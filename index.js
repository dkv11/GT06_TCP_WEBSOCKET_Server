const net = require('net');
const path = require('path');
const { MongoClient } = require('mongodb');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cluster = require('cluster');
const os = require('os');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const getCrc16 = require('./crc16'); 

const TCP_PORT = 21100;
const HTTP_PORT = 3000;
const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'hyoxenapp1';
const numCPUs = os.cpus().length;
const JWT_SECRET = 'hyoxeniot';

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the HTML file from the views directory
app.get('/',(req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Serve the registration page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// Serve the registration page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Connect to MongoDB
const clientDB = new MongoClient(mongoUrl, { useUnifiedTopology: true, maxPoolSize: 10 });
let gpsCoordinatesCollection;
let gpsDataCollection;
let userDataCollection;


async function connectToMongo() {
    try {
        await clientDB.connect();
        console.log('Connected successfully to MongoDB server');
        const db = clientDB.db(dbName);
        gpsCoordinatesCollection = db.collection('gpsCoordinates');
        gpsDataCollection = db.collection('gpsData');
        userDataCollection = db.collection('userData');
        await gpsCoordinatesCollection.createIndex({ imei: 1 });
        await gpsDataCollection.createIndex({ imei: 1 }, { unique: true });
        await userDataCollection.createIndex({ email: 1 }, { unique: true });
        console.log('Collections initialized');
    } catch (error) {
        console.error('MongoDB connection failed:', error);
        process.exit(1);
    }
}

// Middleware to authenticate JWT tokens
function authenticateToken(req, res, next) {
    
    const token = req.headers['authorization'];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// POST API for registration
app.post('/register', async (req, res) => {
    const { username, password, email, deviceid,contact,location, chessisnumber, motorwattage, braketype, vehiclemodel } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await userDataCollection.insertOne({
            username,
            password: hashedPassword,
            email,
            deviceid,
            contact,
            location,
            chessisnumber,
            motorwattage,
            braketype,
            vehiclemodel
        });
        const token = jwt.sign({ deviceid }, JWT_SECRET, { expiresIn: '5d' });
        res.status(201).json({ message: 'Registration successful', token, imei: deviceid });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Email already exists' });
        } else {
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }
});

// POST API for login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await userDataCollection.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ imei: user.deviceid }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'Login successful', token, imei: user.deviceid});
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET API for user details
app.get('/user', authenticateToken, async (req, res) => {
    try {
        const user = await userDataCollection.findOne({ deviceid: req.user.deviceid });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ username: user.username, email: user.email, imei: user.deviceid });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


// TCP Server function
function startTcpServer() {
    net.createServer(async (client) => {
        console.log('New TCP Client connected');
        client.imei = null;
        client.locationData = {};
        client.statusData = {};

        client.on('data', async (data) => {
            try {
                let parsedData;
                if (!client.imei && checkHeader(data)) {
                    parsedData = parseLogin(data);
                    if (parsedData && parsedData.type === 'login') {
                        client.imei = parsedData.imei;
                        console.log(`IMEI stored for this connection: ${client.imei}`);
                    }
                } else {
                    parsedData = parseData(data, client.imei);
                }

                // Ensure parsedData is valid
                if (!parsedData) {
                    console.error(`IMEI: ${client.imei} - Error parsing data: Parsed data is undefined. Data:`, data.toString('hex'));
                    return;
                }

                // Update and store data
                if (parsedData.type === 'location') {
                    client.locationData = parsedData;
                    console.log(`IMEI: ${client.imei} - Updated location data:`, client.locationData);
                    // Emit to the location room
                    io.to(`location-${client.imei}`).emit('gpsData', client.locationData);

                } else if (parsedData.type === 'status') {
                    client.statusData = parsedData;
                    console.log(`IMEI: ${client.imei} - Updated status data:`, client.statusData);
                    // Emit to the status room
                    io.to(`status-${client.imei}`).emit('statusData', client.statusData);
                }

                if (parsedData.type === 'login') {
                    const response = createResponse(parsedData);
                    if (response) {
                        client.write(response);
                        console.log(`Sent login response for IMEI: ${client.imei}`);
                    }
                }

                setTimeout(async () => {
                    try {
                        if (!gpsCoordinatesCollection || !gpsDataCollection) {
                            console.error('GPS collections are not initialized');
                            return;
                        }
                        if (parsedData.type === 'location') {
                            // Insert new GPS coordinates
                            const coordinatesData = {
                                imei: client.imei,
                                lat: client.locationData.lat,
                                lon: client.locationData.lon,
                                course: client.locationData.course,
                                timestamp: new Date()
                            };
                            await gpsCoordinatesCollection.insertOne(coordinatesData);
                        }
                        if (parsedData.type === 'status') {
                            // Update GPS status data
                            const statusData = {
                                terminalInfo: client.statusData.terminalInfo,
                                voltageLevel: client.statusData.voltageLevel,
                                gsmSigStrength: client.statusData.gsmSigStrength,
                                imei: client.imei,
                                timestamp: new Date()
                            };
                            await gpsDataCollection.updateOne(
                                { imei: client.imei },
                                { $set: statusData },
                                { upsert: true }
                            );
                        }
                        console.log(`Data updated in MongoDB for IMEI: ${client.imei}`);
                    } catch (dbError) {
                        console.error('MongoDB update failed:', dbError);
                    }
                }, 1000);

            } catch (error) {
                console.error(`IMEI: ${client.imei} - Error parsing data:`, error.message, 'Data:', data.toString('hex'));
            }
        });

        client.on('close', () => {
            console.log(`Client with IMEI ${client.imei} disconnected`);
        });

        client.on('end', () => {
            console.log(`Client disconnected`);
        });

         
    }).listen(TCP_PORT, () => {
        console.log(`TCP Server listening on port ${TCP_PORT}`);
    });
}

// HTTP and WebSocket Server function
function startHttpServer() {
    io.on('connection', (socket) => {
        console.log('New client connected');

        socket.on('subscribeLocation', (imei) => {
            console.log(`Client subscribed to location data for IMEI: ${imei}`);
            socket.join(`location-${imei}`);
            console.log(`location-${imei}`)
        });

        socket.on('subscribeStatus', (imei) => {
            console.log(`Client subscribed to status data for IMEI: ${imei}`);
            socket.join(`status-${imei}`);
            console.log(`status-${imei}`)
        });

        socket.on('disconnect', () => {
            console.log('New Client disconnected');
        });
        socket.emit('hello', 'world');
    });

    server.listen(HTTP_PORT, () => {
        console.log(`HTTP server running on port ${HTTP_PORT}`);
    });
}

async function initializeWorker() {
    await connectToMongo();
    startTcpServer();
    startHttpServer();
    console.log(`Worker ${process.pid} started`);
}


if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    initializeWorker();
}

// Parsing and Utility Functions

function updateDataToSend(dataToSend, parsedData) {
    for (const key in parsedData) {
        if (dataToSend.hasOwnProperty(key)) {
            dataToSend[key] = parsedData[key];
        }
    }
}

function parseData(data, imei) {
    const protocolNumber = data[3];
    switch (protocolNumber) {
        case 0x01: return parseLogin(data);
        case 0x22: return parseLocation(data, imei);
        case 0x13: return parseStatus(data, imei);
        case 0x26: return parseGPSLBSStatus(data,imei);
        case 0x24: return parseLBS(data);
        default: 
            console.error(`Unsupported message type with protocol number: ${protocolNumber}`);
            return null; // Ensure to return null for unsupported types
    }
}

function checkHeader(data) {
    return data.length >= 2 && data.slice(0, 2).equals(Buffer.from('7878', 'hex'));
}

function parseLogin(data) {
    const imei = data.slice(4, 12).toString('hex');
    const serialNumber = data.readUInt16BE(12);
    const timeZoneLanguage = data.readUInt16BE(14);
    const timeZoneValue = (timeZoneLanguage & 0xFFE0) >> 4;
    const isWest = (timeZoneLanguage & 0x0008) !== 0;
    let hours = Math.floor(timeZoneValue / 100);
    let minutes = timeZoneValue % 100;
    if (isWest) {
        hours = -hours;
        if (minutes > 0) {
            hours -= 1;
            minutes = 60 - minutes;
        }
    }
    const timeZone = `GMT${hours >= 0 ? '+' : ''}${hours}:${minutes.toString().padStart(2, '0')} ${isWest ? 'W' : 'E'}`;
    return { type: 'login', imei, timeZone, serialNumber };
}

function parseLocation(data, imei) {
    let datasheet = {
        startBit: data.readUInt16BE(0),
        protocolLength: data.readUInt8(2),
        protocolNumber: data.readUInt8(3),
        fixTime: data.slice(4, 10),
        quantity: data.readUInt8(10),
        lat: data.readUInt32BE(11),
        lon: data.readUInt32BE(15),
        speed: data.readUInt8(19),
        course: data.readUInt16BE(20),
        mcc: data.readUInt16BE(22),
        mnc: data.readUInt8(24),
        lac: data.readUInt16BE(25),
        cellId: parseInt(data.slice(27, 30).toString('hex'), 16),
        serialNr: data.readUInt16BE(30),
        errorCheck: data.readUInt16BE(32)
    };

    return {
        //fixTime: parseDatetime(datasheet.fixTime).toISOString(),
        //fixTimestamp: parseDatetime(datasheet.fixTime).getTime() / 1000,
        //satCnt: (datasheet.quantity & 0xF0) >> 4,
        //satCntActive: (datasheet.quantity & 0x0F),
        lat: decodeGt06Lat(datasheet.lat, datasheet.course),
        lon: decodeGt06Lon(datasheet.lon, datasheet.course),
        speed: datasheet.speed,
        //speedUnit: 'km/h',
        realTimeGps: Boolean(datasheet.course & 0x2000),
        gpsPositioned: Boolean(datasheet.course & 0x1000),
        eastLongitude: !Boolean(datasheet.course & 0x0800),
        northLatitude: Boolean(datasheet.course & 0x0400),
        course: (datasheet.course & 0x3FF),
        //mcc: datasheet.mcc,
        // mnc: datasheet.mnc,
        // lac: datasheet.lac,
        // cellId: datasheet.cellId,
        imei: imei,
        type: 'location'
    };

   
}

function parseDatetime(data) {
    let date = new Date(Date.UTC(data[0] + 2000, data[1] - 1, data[2], data[3], data[4], data[5]));
    // Adjust for UTC+5:30
    date.setHours(date.getHours() + 5);
    date.setMinutes(date.getMinutes() + 30);
    return date;
}

function decodeGt06Lat(lat, course) {
    let latitude = lat / 60.0 / 30000.0;
    if (!(course & 0x0400)) {
        latitude = -latitude;
    }
    return latitude;
}

function decodeGt06Lon(lon, course) {
    let longitude = lon / 60.0 / 30000.0;
    if (course & 0x0800) {
        longitude = -longitude;
    }
    return longitude;
}

function parseStatus(data, imei) {
    let statusInfo = data.slice(4, 9);
    let terminalInfo = statusInfo.readUInt8(0);
    let voltageLevel = statusInfo.readUInt8(1);
    let gsmSigStrength = statusInfo.readUInt8(2);
    let alarm = (terminalInfo & 0x38) >> 3;
    let alarmType = ['normal', 'shock', 'power cut', 'low battery', 'sos'][alarm] || 'normal';

    return {
        type: 'status',
        info: 'Status information',
        terminalInfo: {
            status: Boolean(terminalInfo & 0x01),
            ignition: Boolean(terminalInfo & 0x02),
            charging: Boolean(terminalInfo & 0x04),
            alarmType: alarmType,
            gpsTracking: Boolean(terminalInfo & 0x40),
            relayState: Boolean(terminalInfo & 0x80)
        },
        voltageLevel: ['no power (shutting down)', 'extremely low battery', 'very low battery (low battery alarm)', 'low battery (can be used normally)', 'medium', 'high', 'very high'][voltageLevel] || 'no power (shutting down)',
        gsmSigStrength: ['no signal', 'extremely weak signal', 'very weak signal', 'good signal', 'strong signal'][gsmSigStrength] || 'no signal',
        imei: imei,
    };
}

function parseGPSLBSStatus(data,imei) {
    let datasheet = {
        startBit: data.readUInt16BE(0),
        protocolLength: data.readUInt8(2),
        protocolNumber: data.readUInt8(3),
        fixTime: data.slice(4, 10),
        quantity: data.readUInt8(10),
        lat: data.readUInt32BE(11),
        lon: data.readUInt32BE(15),
        speed: data.readUInt8(19),
        course: data.readUInt16BE(20),
        mcc: data.readUInt16BE(22),
        mnc: data.readUInt8(24),
        lac: data.readUInt16BE(25),
        cellId: parseInt(data.slice(27, 30).toString('hex'), 16),
        terminalInfo: data.readUInt8(31),
        voltageLevel: data.readUInt8(32),
        gpsSignal: data.readUInt8(33),
        alarmLang: data.readUInt16BE(34),
        serialNr: data.readUInt16BE(36),
        errorCheck: data.readUInt16BE(38)
    };

    return {
        //fixTime: parseDatetime(datasheet.fixTime).toISOString(),
        //fixTimestamp: parseDatetime(datasheet.fixTime).getTime() / 1000,
        //satCnt: (datasheet.quantity & 0xF0) >> 4,
        //satCntActive: (datasheet.quantity & 0x0F),
        lat: decodeGt06Lat(datasheet.lat, datasheet.course),
        lon: decodeGt06Lon(datasheet.lon, datasheet.course),
        speed: datasheet.speed,
        //speedUnit: 'km/h',
        realTimeGps: Boolean(datasheet.course & 0x2000),
        gpsPositioned: Boolean(datasheet.course & 0x1000),
        eastLongitude: !Boolean(datasheet.course & 0x0800),
        northLatitude: Boolean(datasheet.course & 0x0400),
        course: (datasheet.course & 0x3FF),
        // mmc: datasheet.mnc,
        // cellId: datasheet.cellId,
        // terminalInfo: datasheet.terminalInfo,
        // voltageLevel: datasheet.voltageLevel,
        // gpsSignal: datasheet.gpsSignal,
        // alarmLang: datasheet.alarmLang,
        // serialNr: datasheet.serialNr,
        // errorCheck: datasheet.errorCheck
        imei: imei,
        type: 'location'
    };
    
}

function parseLBS(data) {
    // Implement parsing logic here based on the expected data structure
    return { type: 'LBS Data', info: 'LBS' };
}

function createResponse(parsedData) {
    if (parsedData.type === 'login') {
        let response = Buffer.alloc(10);
        response.write('7878', 0, 'hex');
        response.writeUInt8(5, 2);
        response.writeUInt8(0x01, 3);
        response.writeUInt16BE(parsedData.serialNumber, 4);
        const crc = getCrc16(response.slice(2, 6));
        response.writeUInt16BE(crc, 6);
        response.write('0d0a', 8, 'hex');
        return response;
    }
    return null;
}

app.get('/gps/:imei', async (req, res) => {
    const imei = req.params.imei;
    try {
        const deviceData = await gpsCoordinatesCollection.findOne({ imei }, { sort: { timestamp: -1 } });
        if (deviceData) {
            res.json(deviceData);
        } else {
            res.status(404).send('Data not found for the specified IMEI');
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

// GET API to fetch user data by IMEI
app.get('/user/:imei', async (req, res) => {
    const imei = req.params.imei;
    try {
        const userData = await userDataCollection.findOne({ deviceid: imei });
        if (userData) {
            res.json(userData);
        } else {
            res.status(404).json({ message: 'User data not found for the specified IMEI' });
        }
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ message: 'Error fetching user data' });
    }
});

