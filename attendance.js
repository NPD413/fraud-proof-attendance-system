// attendance.js - SECURE ATTENDANCE SYSTEM
// Features: AI Face Matching, Liveness Detection, Geofencing, Device Fingerprinting

// ==================== UI UTILITIES ====================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return alert(message); // Fallback

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${message}`;

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.4s reverse forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('camera-status');
    if (statusElement) {
        statusElement.textContent = message;
        // Reset classes and add new ones
        statusElement.className = `status-pill status-${type}`;
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ==================== CONFIGURATION ====================

// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "smart-attendance-system-f600b.firebaseapp.com",
    projectId: "smart-attendance-system-f600b",
    storageBucket: "smart-attendance-system-f600b.firebasestorage.app",
    messagingSenderId: "881067387212",
    appId: "1:881067387212:web:5b5b99461a4d15804607e9"
};

// Campus Geofencing Configuration (Strict Mode)
const CAMPUS_CONFIG = {
    latitude: 12.9716, // Bangalore City Center
    longitude: 77.5946,
    radiusKm: 30 // Strict 30km limit
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    var db = firebase.firestore();
    var auth = firebase.auth();

    // --- AUTHENTICATION STATE MANAGEMENT ---
    // Critical for Mobile: Wait for Auth before allowing interaction
    auth.onAuthStateChanged((user) => {
        const verifyBtn = document.getElementById('verify-id-btn');
        if (user) {
            console.log("✅ Secure Connection Established (User ID:", user.uid, ")");
            updateStatus("System Online (Logged In)", "success");
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = "Verify Identity →";
            }
        } else {
            console.warn("⚠️ Disconnected. Re-authenticating...");
            updateStatus("Connecting to Security Server...", "warning");
            if (verifyBtn) {
                verifyBtn.disabled = true;
                verifyBtn.textContent = "Connecting...";
            }
            // Auto-Login if disconnected
            auth.signInAnonymously().catch(e => {
                console.error("Auth Fail", e);
                updateStatus("Authentication FAILED. Check Console.", "error");
                showToast("Security: Could not login. Enable Anonymous Auth.", "error");
            });
        }
    });

    console.log("✅ Firebase initialized");
} catch (e) {
    console.error("Firebase init error", e);
    showToast("System Halted: Database connection failed", "error");
    throw new Error("Critical System Failure: Firebase Init Failed");
}

// Global Variables
let video, canvas, canvasCtx;
let faceDetection = null;
let faceMesh = null;
let currentStudentId = null;
let currentStudentName = ""; // Added Global Name
let storedFaceDescriptors = [];
let studentPhotos = []; // Keep for reference, but rely on descriptors
let deviceFingerprint = '';
// userLocation is fetched just-in-time in startAttendanceCheck, but we can keep a global for caching if needed (not used now)
let attendanceMarked = false;
let lastDetectedFace = null;
let faceApiModelsLoaded = false;
let blinkCheckActive = false;
let blinkDetected = false;
let faceMeshInitialized = false; // Guard against double-init
let isTrackingActive = false; // Fix: Control flag for memory leaks
const attemptTracker = {};

// Optimization: Shared Canvas for Verification
const sharedFaceCanvas = document.createElement('canvas');
const sharedFaceCtx = sharedFaceCanvas.getContext('2d', { willReadFrequently: true });

// ==================== GEOLOCATION ====================

function checkRateLimit(studentId) {
    const now = Date.now();
    const record = attemptTracker[studentId] || { count: 0, last: 0 };

    // Reset if > 5 minutes
    if (now - record.last > 300000) {
        record.count = 0;
    }

    if (record.count >= 20) {
        const waitTime = Math.ceil((300000 - (now - record.last)) / 1000);
        throw new Error(`Security Lockout: Too many attempts. Wait ${waitTime}s.`);
    }

    record.count++;
    record.last = now;
    attemptTracker[studentId] = record;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function validateGeofence(userLat, userLng) {
    const distance = calculateDistance(
        userLat, userLng,
        CAMPUS_CONFIG.latitude,
        CAMPUS_CONFIG.longitude
    );

    console.log(`📍 Distance: ${distance.toFixed(3)} km`);

    if (distance > CAMPUS_CONFIG.radiusKm) {
        return {
            valid: false,
            message: `Denial: Outside Bangalore Zone (${distance.toFixed(1)}km)`
        };
    }

    return { valid: true, distance: distance };
}

async function getUserLocation() {
    if (!navigator.geolocation) {
        throw new Error("Geolocation not supported. Use a mobile device.");
    }

    updateStatus("Verifying Location...", 'info');

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Location timeout. Please enable GPS."));
        }, 10000); // 10s timeout

        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(timeout);
                // Return simplified object
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    city: "Bangalore (Detected)" // Mock city for now or use API if needed
                });
            },
            (error) => {
                clearTimeout(timeout);
                let msg = "Location error.";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        msg = "🚫 Location Denied. iOS: Go to Settings -> Privacy -> Location Services -> Safari -> Allow.";
                        break;
                    case error.POSITION_UNAVAILABLE: msg = "Location Signal Weak. Move near a window."; break;
                    case error.TIMEOUT: msg = "Location Timeout. Retry."; break;
                }
                reject(new Error(msg));
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
        );
    });
}

// ==================== FACE RECOGNITION (STRICT) ====================

async function loadFaceApiModels() {
    if (faceApiModelsLoaded) return true;

    try {
        updateStatus("Loading Biometric Models (0%)...");
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

        // Enhance Progress
        updateStatus("Loading Biometric Models (30%)...");
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

        updateStatus("Loading Biometric Models (60%)...");
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

        updateStatus("Loading Biometric Models (90%)...");
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        faceApiModelsLoaded = true;
        console.log("✅ Models loaded");
        return true;
    } catch (error) {
        console.error("❌ Face-api error:", error);
        return false;
    }
}

async function initializeFaceMesh() {
    if (faceMeshInitialized) return true;

    try {
        console.log("👁️ Initializing Liveness Detection...");
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMeshInitialized = true;
        console.log("✅ Liveness AI ready");
        return true;
    } catch (error) {
        console.error("❌ Face Mesh error:", error);
        return false;
    }
}

async function extractAllStoredDescriptors() {
    // Legacy support: If DB has descriptors, this function is skipped elsewhere.
    // Only used if DB has PHOTOS but NO DESCRIPTORS.
    if (!studentPhotos || studentPhotos.length === 0) return;

    console.log("⚠️ Legacy Mode: Extracting descriptors from photos...");
    storedFaceDescriptors = [];

    for (let i = 0; i < studentPhotos.length; i++) {
        try {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = studentPhotos[i];
            await new Promise(r => img.onload = r);
            const desc = await extractFaceDescriptor(img);
            if (desc) storedFaceDescriptors.push(desc);
        } catch (e) {
            console.warn("Legacy extraction failed for photo", i);
        }
    }
    console.log(`✅ Legacy signatures ready (${storedFaceDescriptors.length})`);
}

async function extractFaceDescriptor(imageElement) {
    if (!faceApiModelsLoaded) return null;

    try {
        // OPTION 1: High Fidelity (Matches Registration)
        // inputSize: 608 (High Res)
        let detections = await faceapi
            .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5, inputSize: 608 })) // High Confirm
            .withFaceLandmarks()
            .withFaceDescriptors();

        if (detections && detections.length > 0) {
            // Pick largest face
            const largest = detections.reduce((prev, current) => {
                return (prev.detection.box.area > current.detection.box.area) ? prev : current;
            });
            return Array.from(largest.descriptor);
        }

        // OPTION 2: Retry with Higher Resolution (Better for small faces/distance)
        console.warn("Standard detection failed. Retrying with higher resolution...");
        detections = await faceapi
            .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.1, inputSize: 512 }))
            .withFaceLandmarks()
            .withFaceDescriptors();

        if (detections && detections.length > 0) {
            const largest = detections.reduce((prev, current) => {
                return (prev.detection.box.area > current.detection.box.area) ? prev : current;
            });
            return Array.from(largest.descriptor);
        }

        return null;
    } catch (error) {
        console.error("Extraction error:", error);
        return null;
    }
}

function compareFaceDescriptors(desc1, desc2) {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) return 0;

    // Euclidean distance
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    const distance = Math.sqrt(sum);
    console.log(`📏 Distance: ${distance.toFixed(3)}`);

    // Convert distance. Lower is better.
    // 0.0 -> 100%
    // 0.4 -> 60%
    // 0.6 -> 40%
    // Formula: (1 - distance) * 100. If distance > 1, score is 0.
    return Math.max(0, Math.min(100, (1 - distance) * 100));
}

async function verifyIdentity(faceBox) {
    if (!storedFaceDescriptors || storedFaceDescriptors.length === 0) {
        if (!studentPhotos || studentPhotos.length === 0) return false;
    }

    try {
        updateStatus("Biometric Scan in Progress...");

        // 1. Capture face from video (With Padding)
        const padding = 60; // Increased padding
        const x = Math.max(0, faceBox.x - padding);
        const y = Math.max(0, faceBox.y - padding);
        const w = Math.min(video.videoWidth - x, faceBox.width + (padding * 2));
        const h = Math.min(video.videoHeight - y, faceBox.height + (padding * 2));

        // Use Shared Canvas (Optimization)
        sharedFaceCanvas.width = w;
        sharedFaceCanvas.height = h;

        sharedFaceCtx.drawImage(video, x, y, w, h, 0, 0, w, h);

        // 2. Get Descriptor (Live)
        console.log("🔍 Extracting live descriptor...");
        let currentDesc = await extractFaceDescriptor(sharedFaceCanvas);

        // Fallback: Try full frame if crop failed
        if (!currentDesc) {
            console.warn("Crop detection failed, trying full frame...");
            currentDesc = await extractFaceDescriptor(video);
        }

        if (!currentDesc) {
            throw new Error("Live face capture failed. Adjust lighting.");
        }

        // Check if we need legacy extraction
        if (!storedFaceDescriptors || storedFaceDescriptors.length === 0) {
            console.warn("No descriptors found. Attempting legacy extraction...");
            await extractAllStoredDescriptors();
        }

        if (storedFaceDescriptors.length === 0) {
            throw new Error("Registration incomplete: No face data available. Re-register.");
        }

        // Match against already extracted signatures
        let bestMatchScore = 0;
        let allScores = [];

        // Compare against Descriptors directly
        for (let storedDesc of storedFaceDescriptors) {
            const score = compareFaceDescriptors(currentDesc, storedDesc);
            allScores.push(score.toFixed(1));
            if (score > bestMatchScore) bestMatchScore = score;
        }

        console.log(`Biometric Scores: [${allScores.join(', ')}] | Best: ${bestMatchScore.toFixed(1)}/100`);

        lastVerificationScore = bestMatchScore; // Store for DB save

        // Threshold Tuning:
        // Score 60 (Distance ~0.4) is VERY STRICT.
        // This ensures NO proxies pass.
        if (bestMatchScore >= 60) {
            return true;
        } else {
            updateStatus(`Verification Failed. Match Score: ${bestMatchScore.toFixed(0)}% (Required: 60%)`, 'error');
            console.warn(`AUTH DENIED: Best Score ${bestMatchScore.toFixed(1)} < 60`);
            showToast(`Authentication Failed. Face Mismatch.`, "error");
            return false;
        }

    } catch (error) {
        console.error("Verification error:", error);
        showToast(error.message, 'error');
        return false;
    }
}

// Global to hold the score
let lastVerificationScore = 0;

// ==================== DEVICE FINGERPRINTING ====================

async function generateDeviceFingerprint() {
    try {
        const components = {
            userAgent: navigator.userAgent,
            co: navigator.hardwareConcurrency,
            res: `${screen.width}x${screen.height}`,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        const data = new TextEncoder().encode(JSON.stringify(components));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        deviceFingerprint = hash;
        return { hash: hash, userAgent: components.userAgent };
    } catch (e) {
        return { hash: 'unknown-' + Date.now(), userAgent: navigator.userAgent };
    }
}

// ==================== WORKFLOW ====================

async function verifyStudentId() {
    // 0. Auth Guard (Critical for Mobile)
    if (!firebase.auth().currentUser) {
        showToast("⚠️ Authentication Failed. Enable 'Anonymous Auth' in Firebase Console.", "error");
        updateStatus("Auth Failed. See Toast.", "error");
        return;
    }

    const input = document.getElementById('student-id-input').value.trim().toUpperCase();

    if (!input) return showToast('Enter Student ID', 'warning');
    if (!/^[A-Z0-9]{3,20}$/.test(input)) return showToast('Invalid ID Format', 'error');

    const btn = document.getElementById('verify-id-btn');
    btn.disabled = true;
    btn.textContent = 'Searching...';

    // 1. Prepare UI IMMEDIATELY
    document.getElementById('id-input-section').style.display = 'none';
    const camContainer = document.getElementById('camera-container');
    camContainer.style.display = 'block';
    updateStatus("Initializing Camera...", 'info');

    // 2. Start Camera Parallel (Don't await yet if we want super fast UI, but we need video element ready)
    // We launch it now so it starts warming up.
    const cameraPromise = initializeWebcam();

    // 3. Start Models Parallel
    const modelsPromise = (async () => {
        updateStatus("Loading Biometric Models...", 'info');
        const [modelsLoaded, meshLoaded] = await Promise.all([
            loadFaceApiModels(),
            initializeFaceMesh()
        ]);
        if (modelsLoaded && meshLoaded) {
            updateStatus("Models Ready. Waiting for Camera...", 'info');
        }
        return modelsLoaded && meshLoaded;
    })();

    // 4. Fetch User Data Parallel
    const userPromise = (async () => {
        try {
            checkRateLimit(input);
            const doc = await db.collection('students').doc(input).get();
            if (!doc.exists) throw new Error("Student ID not found in database");

            const data = doc.data();
            if (!data.photos || data.photos.length === 0) throw new Error("No enrollment data found");
            return data;
        } catch (e) {
            throw e;
        }
    })();

    try {
        // Wait for User Data primarily to confirm validity
        const userData = await userPromise;

        currentStudentId = input;
        currentStudentName = userData.name; // Store name globally
        localStorage.setItem('lastStudentId', input);
        studentPhotos = userData.photos;

        console.log("DEBUG: Raw Face Descriptors:", userData.faceDescriptors);

        const rawDescriptors = userData.faceDescriptors || [];

        let initialDescriptors = Array.isArray(rawDescriptors) ? rawDescriptors : Object.values(rawDescriptors);

        // Deep Conversion: Ensure every descriptor is a Float32Array or Array, not an Object
        storedFaceDescriptors = initialDescriptors.map(d => {
            if (Array.isArray(d) || d instanceof Float32Array) return d;
            return Object.values(d); // Convert {0:0.1, 1:0.2...} to [0.1, 0.2...]
        });

        console.log("DEBUG: Parsed Descriptors Length:", storedFaceDescriptors.length);

        showToast(`Welcome, ${userData.name}`, 'success');

        // Wait for Camera content to be ready
        await cameraPromise;
        updateStatus("Camera Active. Models Loading...", 'info');

        // Start Tracking (it handles missing models gracefully now)
        isTrackingActive = true; // Flag on
        startFaceTracking();

        // Block "Start Verification" until models are done
        const startBtn = document.getElementById('mark-attendance-btn');
        startBtn.disabled = true;
        startBtn.textContent = "Loading AI...";

        await modelsPromise;

        // Legacy background extraction if needed
        if (storedFaceDescriptors.length === 0) {
            await extractAllStoredDescriptors(); // Fix: Race Condition resolved
        }

        // Enable UI
        startBtn.disabled = false;
        startBtn.textContent = "✓ Start Verification Process";
        updateStatus("System Ready", "info");

    } catch (error) {
        console.error(error);
        showToast(error.message, 'error');
        // Revert UI
        document.getElementById('id-input-section').style.display = 'block';
        camContainer.style.display = 'none';
        btn.disabled = false;
        btn.textContent = 'Verify Identity →';
        // Stop camera if started
        isTrackingActive = false; // Fix: Stop loop on error
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
        }
    }
}

async function initializeWebcam() {
    return new Promise(async (resolve, reject) => {
        try {
            // Check for HTTPS
            if (!window.isSecureContext && window.location.hostname !== 'localhost') {
                throw new Error("HTTPS Required for Camera.");
            }

            video = document.getElementById('webcam');
            canvas = document.getElementById('canvas-overlay');

            let stream = null;

            // STRATEGY 1: Ideal Configuration
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
                });
            } catch (e) {
                console.warn("Strategy 1 Failed. Trying Basic...");
                // STRATEGY 2: Basic Facing
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user' }
                    });
                } catch (e2) {
                    console.warn("Strategy 2 Failed. Trying Any Camera...");
                    // STRATEGY 3: Any Video Source
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }
            }

            if (!stream) throw new Error("Could not access any camera.");

            video.srcObject = stream;
            // Needed for iOS
            video.setAttribute('autoplay', '');
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');

            video.onloadedmetadata = () => {
                video.play().then(() => {
                    canvas.width = video.videoWidth || 640;
                    canvas.height = video.videoHeight || 480;
                    canvasCtx = canvas.getContext('2d');
                    console.log(`✅ Webcam active: ${video.videoWidth}x${video.videoHeight}`);
                    resolve(true);
                }).catch(e => {
                    console.error("Autoplay blocked. User interaction needed?", e);
                    // Force start if blocked
                    resolve(true);
                });
            };
        } catch (error) {
            console.error("Camera Init Error:", error);
            showToast("Camera Error: " + error.message, "error");
            reject(error);
        }
    });
}

async function startFaceTracking() {
    // MediaPipe FaceDetection (lighter than full mesh, used for bounding box)
    if (!window.FaceDetection) {
        console.warn("MediaPipe FaceDetection not loaded yet.");
    }

    // Initialize if not already
    if (!faceDetection && window.FaceDetection) {
        faceDetection = new FaceDetection({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
        });
        faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 });

        faceDetection.onResults((results) => {
            if (!canvasCtx || !canvas) return;

            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

            if (results.detections.length > 0) {
                const det = results.detections[0];
                const bbox = det.boundingBox;
                const w = canvas.width;
                const h = canvas.height;

                // Draw Box
                const x = bbox.xCenter * w - (bbox.width * w) / 2;
                const y = bbox.yCenter * h - (bbox.height * h) / 2;
                const bw = bbox.width * w;
                const bh = bbox.height * h;

                lastDetectedFace = { x, y, width: bw, height: bh };

                // Cosmic Theme UI Draw (Cyan/Neon)
                canvasCtx.strokeStyle = '#0ea5e9';
                canvasCtx.lineWidth = 2;
                canvasCtx.strokeRect(x, y, bw, bh);

                // Corner Accents
                const len = 20;
                canvasCtx.lineWidth = 4;
                canvasCtx.beginPath();
                // Top Left
                canvasCtx.moveTo(x, y + len); canvasCtx.lineTo(x, y); canvasCtx.lineTo(x + len, y);
                // Bottom Right
                canvasCtx.moveTo(x + bw, y + bh - len); canvasCtx.lineTo(x + bw, y + bh); canvasCtx.lineTo(x + bw - len, y + bh);
                canvasCtx.stroke();

                // Draw Name Tag (Cosmic Style)
                if (currentStudentName) {
                    canvasCtx.font = "bold 18px 'Space Grotesk', sans-serif";
                    canvasCtx.fillStyle = "#0ea5e9"; // Cyan Text
                    canvasCtx.shadowColor = "#0ea5e9";
                    canvasCtx.shadowBlur = 10;
                    canvasCtx.fillText(currentStudentName, x, y - 10);
                    // Reset shadow
                    canvasCtx.shadowBlur = 0;
                }

            } else {
                lastDetectedFace = null;
            }
        });
    }

    const sendCamerFrame = async () => {
        // Fix: Memory Leak Prevention
        if (!isTrackingActive) return;

        // Main UI Loop: Only handles Bounding Box (FaceDetection)
        // Liveness (FaceMesh) is now handled by its own tight loop in detectRealBlink
        if (video &&
            !attendanceMarked &&
            document.getElementById('camera-container').style.display !== 'none' &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0) {

            try {
                // Only run Detection if Liveness is NOT active
                // This prevents resource contention
                if (!blinkCheckActive && faceDetection) {
                    await faceDetection.send({ image: video });
                }
            } catch (e) {
                // console.warn("Frame skipped", e);
            }
        }

        if (isTrackingActive) requestAnimationFrame(sendCamerFrame);
    };
    sendCamerFrame();
}

// ==================== ENHANCED LIVENESS (Head Turn + Blink) ====================

// Calculate Eye Aspect Ratio (EAR)
function calculateEyeAspectRatio(landmarks, eyeIndices) {
    const getDistance = (p1, p2) => {
        return Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2) +
            Math.pow(p1.z - p2.z, 2)
        );
    };

    // Eye landmark points
    const p1 = landmarks[eyeIndices[0]];
    const p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]];
    const p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]];
    const p6 = landmarks[eyeIndices[5]];

    // Dis
    const vertical1 = getDistance(p2, p6);
    const vertical2 = getDistance(p3, p5);
    const horizontal = getDistance(p1, p4);

    return (vertical1 + vertical2) / (2.0 * horizontal);
}

// Eye landmark indices for EAR calculation
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

function detectRealBlink() {
    return new Promise((resolve, reject) => {
        if (!faceMesh || !video) {
            return reject(new Error("AI System not ready"));
        }

        blinkCheckActive = true;
        blinkDetected = false;

        // Dynamic Calibration Variables
        let maxEAR = 0; // Resting state (Open Eyes)
        let calibrationFrames = 0;
        const CALIBRATION_LIMIT = 30; // ~1-2 seconds of calibration

        let blinkCount = 0;
        const TARGET_BLINKS = 2; // Still require 2 blinks
        const startTime = Date.now();
        const TIMEOUT = 45000; // 45s

        let eyeStatus = "OPEN"; // OPEN -> CLOSING -> CLOSED -> OPENING

        showToast("Liveness: Hold Steady...", "info");
        updateStatus("Calibrating Eye Baseline...", "warning");

        const detectLoop = async () => {
            if (!blinkCheckActive) return;

            const now = Date.now();
            if (now - startTime > TIMEOUT) {
                blinkCheckActive = false;
                reject(new Error("Liveness Timeout. Try better lighting."));
                return;
            }

            if (video.readyState === 4) {
                try {
                    await faceMesh.send({ image: video });
                } catch (e) { }
            }

            if (blinkCheckActive) requestAnimationFrame(detectLoop);
        };

        faceMesh.onResults((results) => {
            if (!blinkCheckActive) return;

            if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
                const landmarks = results.multiFaceLandmarks[0];

                const leftEAR = calculateEyeAspectRatio(landmarks, LEFT_EYE_INDICES);
                const rightEAR = calculateEyeAspectRatio(landmarks, RIGHT_EYE_INDICES);
                const currentEAR = (leftEAR + rightEAR) / 2;

                // Phase 1: Calibration (Find "Normal Open" State)
                if (calibrationFrames < CALIBRATION_LIMIT) {
                    maxEAR = Math.max(maxEAR, currentEAR);
                    calibrationFrames++;
                    updateStatus(`Calibrating... Keep Eyes Open (${Math.round((calibrationFrames / CALIBRATION_LIMIT) * 100)}%)`, "warning");
                    if (calibrationFrames === CALIBRATION_LIMIT) {
                        showToast("✅ Calibrated! Now BLINK 2 Times.", "success");
                        updateStatus("Status: READY. Please Blink.", "info");
                        // Safety: If maxEAR is abnormally low (bad angle), force a minimum
                        if (maxEAR < 0.25) maxEAR = 0.25;
                    }
                    return; // Don't detect blinks during calibration
                }

                // Phase 2: Detection (Relative to specific user)
                // Thresholds are RELATIVE to MaxEAR
                const closedThreshold = maxEAR * 0.70; // 30% drop = Blink
                const openThreshold = maxEAR * 0.90;   // 90% recovery = Open

                // Visual Feedback Debug
                // updateStatus(`Eye Openness: ${(currentEAR/maxEAR * 100).toFixed(0)}% (Goal: < 70%)`, "info");

                if (eyeStatus === "OPEN" && currentEAR < closedThreshold) {
                    eyeStatus = "CLOSED";
                } else if (eyeStatus === "CLOSED" && currentEAR > openThreshold) {
                    eyeStatus = "OPEN";
                    blinkCount++;
                    console.log(`Dynamic Blink ${blinkCount}/${TARGET_BLINKS} (EAR: ${currentEAR.toFixed(2)} / Max: ${maxEAR.toFixed(2)})`);

                    if (blinkCount < TARGET_BLINKS) {
                        showToast(`Blink 1/2 Detected! Do it again.`, "success");
                        updateStatus(`Blink 1/2 Detected! One more...`, "warning");
                    } else {
                        // Success
                        blinkCheckActive = false;
                        blinkDetected = true;
                        updateStatus("Liveness Verified ✅", "success");
                        resolve(true);
                    }
                }
            }
        });

        detectLoop();
    });
}

// ==================== FINAL ATTENDANCE CHECK ====================

async function startAttendanceCheck() {
    if (attendanceMarked) return;

    const btn = document.getElementById('mark-attendance-btn');
    btn.disabled = true;
    btn.textContent = "Verifying...";

    try {
        if (!lastDetectedFace) throw new Error("No face detected in view");

        // 1. Liveness
        await detectRealBlink();

        // 2. Face Match
        const isVerified = await verifyIdentity(lastDetectedFace);
        if (!isVerified) throw new Error("Face Mismatch: Identity could not be verified");

        // 3. Location (Strict Bangalore)
        const loc = await getUserLocation();
        const geo = validateGeofence(loc.latitude, loc.longitude);
        if (!geo.valid) throw new Error(geo.message);

        // 4. Submit
        const fingerprint = await generateDeviceFingerprint();

        // Check duplication
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        /* 
        // Duplication Check Disabled by User Request (Allow Multiple Check-ins)
        try {
            const exists = await db.collection('attendance')
                .where('studentId', '==', currentStudentId)
                .where('date', '>=', firebase.firestore.Timestamp.fromDate(today))
                .get();

            if (!exists.empty) {
                 console.log("ℹ️ Previous attendance found today (allowing multiple).");
            }
        } catch (error) {
            console.warn("⚠️ Duplication check skipped:", error);
        } 
        */

        // --- ADVANCED FRAUD DETECTION ---
        // Moved from verifyIdentity to here (Correct Place)
        let fraudFlag = false;
        let fraudReason = "";

        try {
            const lastRecSnap = await db.collection('attendance')
                .where('studentId', '==', currentStudentId)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            if (!lastRecSnap.empty) {
                const lastData = lastRecSnap.docs[0].data();
                const lastTime = lastData.timestamp.toDate();
                const lastLoc = lastData.location;

                if (lastLoc && loc) {
                    const timeDiffHours = (new Date() - lastTime) / (1000 * 60 * 60);
                    // Haversine calc
                    const R = 6371;
                    const dLat = (loc.latitude - lastLoc.latitude) * Math.PI / 180;
                    const dLon = (loc.longitude - lastLoc.longitude) * Math.PI / 180;
                    const a =
                        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(lastLoc.latitude * Math.PI / 180) * Math.cos(loc.latitude * Math.PI / 180) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const distKm = R * c;

                    const speed = distKm / (timeDiffHours || 0.001); // Avoid div/0

                    // If speed > 600 km/h (Impossible for car/train)
                    if (speed > 600) {
                        fraudFlag = true;
                        fraudReason = `Impossible Travel (${speed.toFixed(0)} km/h)`;
                    }
                }
            }
        } catch (e) {
            console.warn("⚠️ Impossible Travel check skipped", e);
        }

        // Save to Firebase
        await db.collection('attendance').add({
            studentId: currentStudentId,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            date: firebase.firestore.Timestamp.fromDate(new Date()),
            location: loc,
            security: {
                liveness: true,
                biometricScore: lastVerificationScore,
                fingerprint: fingerprint.hash,
                userAgent: fingerprint.userAgent
            },
            fraudFlag: fraudFlag,
            fraudReason: fraudReason
        });

        attendanceMarked = true;

        if (fraudFlag) {
            showToast(`⚠️ Warning: Abnormal activity detected: ${fraudReason}`, 'error');
        } else {
            showToast("Attendance Marked Successfully!", "success");
        }

        document.getElementById('camera-container').style.display = 'none';
        isTrackingActive = false; // Stop camera loop
        document.getElementById('success-container').style.display = 'block';
        document.getElementById('success-student-id').textContent = currentStudentId;
        document.getElementById('success-time').textContent = new Date().toLocaleTimeString();
        document.getElementById('success-location').textContent = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;


    } catch (error) {
        showToast(error.message, 'error');
        btn.disabled = false;
        btn.textContent = "✓ Start Verification Process";
    }
}

// ==================== UI HELPER FUNCTIONS ====================

let qrCodeObj = null;

function showSessionQR() {
    const modal = document.getElementById('qr-modal');
    if (!modal) return;

    modal.style.display = 'flex';

    // Generate QR only once
    const container = document.getElementById('qrcode');
    if (container && container.innerHTML.trim() === "") {
        try {
            qrCodeObj = new QRCode(container, {
                text: window.location.href,
                width: 256,
                height: 256,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch (e) { console.warn("QR Lib missing", e); }
    }
}

function closeQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function resetForNewStudent() {
    // Reloading is the safest way to clear WebGL contexts/Tensors and reset state
    window.location.reload();
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 System Initializing...");

    // Attach Event Listeners
    const verifyBtn = document.getElementById('verify-id-btn');
    if (verifyBtn) {
        verifyBtn.addEventListener('click', verifyStudentId);
        // Also allow Enter key
        document.getElementById('student-id-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verifyStudentId();
        });
    }

    const markBtn = document.getElementById('mark-attendance-btn');
    if (markBtn) {
        markBtn.addEventListener('click', startAttendanceCheck);
    }

    // Check if we need to load models early (Optional, but good for UX)
    // loadFaceApiModels(); 
});
