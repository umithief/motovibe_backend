

async function testTelemetry() {
    try {
        const testEmail = `test${Date.now()}@test.com`;
        const testPassword = 'password123';
        const testName = 'Test User';
        
        console.log('--- REGISTER ---');
        const regRes = await fetch('http://localhost:5001/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: testName,
                email: testEmail,
                password: testPassword,
                username: `testuser${Date.now()}`
            })
        });
        const regData = await regRes.json();
        console.log('Reg Status:', regRes.status);
        if (!regData.token && !regData.data?.token) {
            console.log('No token in registration response, attempting login...');
        }
        
        console.log('\n--- LOGIN ---');
        const loginRes = await fetch('http://localhost:5001/api/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword
            })
        });
        const loginData = await loginRes.json();
        console.log('Login Status:', loginRes.status);
        const token = loginData.token || loginData.data?.token || regData.token;
        const userId = loginData._id || loginData.data?._id || regData._id;

        if (!token) {
            console.log('Failed to get token');
            return;
        }

        console.log('\n--- 1. UPDATE LIVE LOCATION ---');
        const locRes = await fetch('http://localhost:5001/api/rides/sos/location', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                lat: 41.0082,
                lng: 28.9784
            })
        });
        const locData = await locRes.json();
        console.log('Location Update Status:', locRes.status, locData);

        console.log('\n--- 2. TRIGGER SOS (CRASH DETECTION) ---');
        const sosRes = await fetch('http://localhost:5001/api/rides/sos/trigger', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId: userId,
                lat: 41.0082,
                lng: 28.9784,
                timestamp: new Date().toISOString(),
                severity: 'high'
            })
        });
        const sosData = await sosRes.json();
        console.log('SOS Trigger Status:', sosRes.status, sosData);

        console.log('\n--- 3. TEST TELEMETRY (CREATE RIDE WITH TELEMETRY) ---');
        const rideRes = await fetch('http://localhost:5001/api/rides', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                title: "Test Test Ride",
                coordinates: [
                    [28.9784, 41.0082],
                    [28.9800, 41.0100]
                ],
                telemetry: [
                    { speed: 50, leanAngle: 10, gForce: 0.5, timestamp: new Date().toISOString() },
                    { speed: 70, leanAngle: 25, gForce: 1.2, timestamp: new Date().toISOString() }
                ],
                distance: 2.5,
                duration: 600,
                avgSpeed: 40,
                maxSpeed: 70
            })
        });
        const rideData = await rideRes.json();
        console.log('Create Ride/Telemetry Status:', rideRes.status, rideData);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testTelemetry();
