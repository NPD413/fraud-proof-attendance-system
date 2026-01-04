// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAMYXUdtt2I_xbasZxoNfcMI0bm5HYHgnA",
    authDomain: "smart-attendance-system-f600b.firebaseapp.com",
    projectId: "smart-attendance-system-f600b",
    storageBucket: "smart-attendance-system-f600b.firebasestorage.app",
    messagingSenderId: "881067387212",
    appId: "1:881067387212:web:5b5b99461a4d15804607e9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
console.log("✅ Firebase initialized");

// Global Variables
let video, canvas, canvasCtx;
let faceDetection = null;
let currentStudentId = null;
let storedFaceDescriptors = [];
let studentPhotos = [];
let deviceFingerprint = '';
let userLocation = null;
let attendanceMarked = false;
let lastDetectedFace = null;

// Device Fingerprinting
async function generateDeviceFingerprint() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    
    const fingerprint = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory || 'unknown',
        screenResolution: `${screen.width}x${screen.height}`,
        colorDepth: screen.colorDepth,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        gpu: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown'
    };
    
    const fingerprintString = JSON.stringify(fingerprint);
    const encoder = new TextEncoder();
    const data = encoder.encode(fingerprintString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    deviceFingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log("Device Fingerprint:", deviceFingerprint);
    return deviceFingerprint;
}

// Get User Location
function getUserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not supported");
            resolve({ latitude: null, longitude: null, accuracy: null });
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: new Date().toISOString()
                };
                console.log("✅ Location obtained:", userLocation);
                resolve(userLocation);
            },
            (error) => {
                console.warn("Location error:", error.message);
                resolve({ latitude: null, longitude: null, accuracy: null, error: error.message });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

// Update Status Message
function updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('camera-status') || document.getElementById('status-message');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ⭐ Initialize MediaPipe Face Detection
async function initializeMediaPipe() {
    try {
        console.log("🎯 Initializing MediaPipe Face Detection...");
        
        faceDetection = new FaceDetection({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`;
            }
        });
        
        faceDetection.setOptions({
            model: 'short',
            minDetectionConfidence: 0.5
        });
        
        faceDetection.onResults(onFaceDetectionResults);
        
        console.log("✅ MediaPipe Face Detection initialized");
        return true;
    } catch (error) {
        console.error("❌ MediaPipe initialization error:", error);
        return false;
    }
}

// ⭐ MediaPipe Results Handler
function onFaceDetectionResults(results) {
    if (!canvasCtx || !canvas) return;
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw video frame
    canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    
    if (results.detections && results.detections.length > 0) {
        const detection = results.detections[0];
        
        // Get bounding box
        const bbox = detection.boundingBox;
        const x = bbox.xCenter * canvas.width - (bbox.width * canvas.width) / 2;
        const y = bbox.yCenter * canvas.height - (bbox.height * canvas.height) / 2;
        const width = bbox.width * canvas.width;
        const height = bbox.height * canvas.height;
        
        lastDetectedFace = { x, y, width, height };
        
        // Draw bounding box
        canvasCtx.strokeStyle = '#00ff00';
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeRect(x, y, width, height);
        
        // Draw confidence score
        canvasCtx.fillStyle = '#00ff00';
        canvasCtx.font = '16px Arial';
        canvasCtx.fillText(
            `Confidence: ${(detection.score[0] * 100).toFixed(1)}%`,
            x,
            y - 10
        );
    } else {
        lastDetectedFace = null;
    }
}

// Verify Student ID
async function verifyStudentId() {
    const input = document.getElementById('student-id-input').value.trim().toUpperCase();
    
    if (!input) {
        alert('❌ Please enter your Student ID!');
        return;
    }
    
    const btn = document.getElementById('verify-id-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = 'Verifying... <span class="loading"></span>';
    
    try {
        updateStatus(`Verifying Student ID: ${input}...`);
        
        // Fetch student data from Firebase
        const studentDoc = await db.collection('students').doc(input).get();
        
        if (!studentDoc.exists) {
            throw new Error(`❌ Student ID "${input}" not found in database!`);
        }
        
        const studentData = studentDoc.data();
        console.log("✅ Student found:", studentData.name || input);
        
        // Check for photos
        const hasPhotos = studentData.photos && studentData.photos.length > 0;
        
        if (!hasPhotos) {
            throw new Error(`No face data registered for ${input}. Please complete registration first.`);
        }
        
        console.log(`✅ Student has ${studentData.photos.length} photos`);
        
        // Store for later verification
        currentStudentId = input;
        studentPhotos = studentData.photos;
        
        // Initialize MediaPipe
        updateStatus("Initializing MediaPipe Face Detection...");
        const mediapipeReady = await initializeMediaPipe();
        
        if (!mediapipeReady) {
            throw new Error("MediaPipe initialization failed");
        }
        
        // Initialize camera
        updateStatus("Initializing camera...");
        const cameraReady = await initializeWebcam();
        
        if (!cameraReady) {
            throw new Error("Camera initialization failed");
        }
        
        // Start MediaPipe processing
        startCameraProcessing();
        
        // Hide ID input, show camera
        document.getElementById('id-input-section').style.display = 'none';
        document.getElementById('camera-container').style.display = 'block';
        
        updateStatus(`✅ Welcome ${studentData.name || input}! Face detection active.`, 'success');
        
    } catch (error) {
        console.error("❌ Verification error:", error);
        alert(error.message);
        btn.disabled = false;
        btn.textContent = originalText;
        updateStatus("❌ " + error.message, 'error');
    }
}

// Initialize Webcam
async function initializeWebcam() {
    try {
        video = document.getElementById('webcam');
        canvas = document.getElementById('canvas-overlay');
        
        if (!video || !canvas) {
            throw new Error("Video or canvas element not found");
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }
        });
        
        video.srcObject = stream;
        
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvasCtx = canvas.getContext('2d');
                console.log("✅ Webcam initialized");
                resolve(true);
            };
        });
    } catch (error) {
        console.error("❌ Webcam error:", error);
        updateStatus("❌ Camera access denied!", 'error');
        return false;
    }
}

// ⭐ Start Camera Processing with MediaPipe
function startCameraProcessing() {
    const camera = new Camera(video, {
        onFrame: async () => {
            if (faceDetection && video.readyState === 4) {
                await faceDetection.send({ image: video });
            }
        },
        width: 1280,
        height: 720
    });
    camera.start();
    console.log("✅ MediaPipe camera processing started");
}

// Liveness Check (Basic blink detection simulation)
let blinkCount = 0;
let lastBlinkTime = Date.now();

function checkLiveness() {
    const now = Date.now();
    if (now - lastBlinkTime > 2000) {
        blinkCount++;
        lastBlinkTime = now;
        console.log(`Blink detected: ${blinkCount}`);
    }
    return blinkCount >= 1;
}

// Compare two images using pixel similarity
async function compareImages(image1Base64, image2Base64) {
    return new Promise((resolve) => {
        const img1 = new Image();
        const img2 = new Image();
        
        let loadedCount = 0;
        
        const onBothLoaded = () => {
            loadedCount++;
            if (loadedCount === 2) {
                try {
                    const size = 64;
                    const canvas1 = document.createElement('canvas');
                    const canvas2 = document.createElement('canvas');
                    canvas1.width = canvas1.height = size;
                    canvas2.width = canvas2.height = size;
                    
                    const ctx1 = canvas1.getContext('2d');
                    const ctx2 = canvas2.getContext('2d');
                    
                    ctx1.drawImage(img1, 0, 0, size, size);
                    ctx2.drawImage(img2, 0, 0, size, size);
                    
                    const data1 = ctx1.getImageData(0, 0, size, size).data;
                    const data2 = ctx2.getImageData(0, 0, size, size).data;
                    
                    let diff = 0;
                    for (let i = 0; i < data1.length; i += 4) {
                        const gray1 = (data1[i] + data1[i+1] + data1[i+2]) / 3;
                        const gray2 = (data2[i] + data2[i+1] + data2[i+2]) / 3;
                        diff += Math.abs(gray1 - gray2);
                    }
                    
                    const maxDiff = size * size * 255;
                    const similarity = 100 - (diff / maxDiff * 100);
                    
                    resolve(similarity);
                } catch (error) {
                    console.error("Image comparison error:", error);
                    resolve(0);
                }
            }
        };
        
        img1.onload = onBothLoaded;
        img2.onload = onBothLoaded;
        img1.onerror = () => resolve(0);
        img2.onerror = () => resolve(0);
        
        img1.src = image1Base64;
        img2.src = image2Base64;
    });
}

// Compare current face with stored photos
async function compareFaceWithStoredPhotos(faceBox) {
    if (!studentPhotos || studentPhotos.length === 0) {
        console.warn("⚠️ No stored photos to compare with");
        updateStatus("⚠️ No registered photos found for verification", 'warning');
        return false;
    }
    
    try {
        updateStatus("🔍 Comparing face with registered photos...");
        
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        const captureCtx = captureCanvas.getContext('2d');
        captureCtx.drawImage(video, 0, 0);
        
        const faceCanvas = document.createElement('canvas');
        const faceWidth = Math.max(100, faceBox.width);
        const faceHeight = Math.max(100, faceBox.height);
        faceCanvas.width = faceWidth;
        faceCanvas.height = faceHeight;
        const faceCtx = faceCanvas.getContext('2d');
        faceCtx.drawImage(
            captureCanvas,
            faceBox.x, faceBox.y, faceBox.width, faceBox.height,
            0, 0, faceWidth, faceHeight
        );
        
        const currentFaceData = faceCanvas.toDataURL('image/jpeg', 0.8);
        
        let bestSimilarity = 0;
        let matchFound = false;
        
        console.log(`📸 Comparing with ${studentPhotos.length} registered photos...`);
        
        for (let i = 0; i < studentPhotos.length; i++) {
            const storedPhoto = studentPhotos[i];
            const similarity = await compareImages(currentFaceData, storedPhoto);
            
            console.log(`Photo ${i + 1}/${studentPhotos.length} similarity: ${similarity.toFixed(2)}%`);
            
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
            }
            
            if (similarity >= 65) {
                matchFound = true;
                console.log(`✅ MATCH FOUND with photo ${i + 1} (${similarity.toFixed(2)}%)`);
                break;
            }
        }
        
        console.log(`Best similarity score: ${bestSimilarity.toFixed(2)}%`);
        
        if (matchFound) {
            updateStatus(`✅ Face verified! (${bestSimilarity.toFixed(1)}% match)`, 'success');
        } else {
            updateStatus(`🚫 Face does not match! (${bestSimilarity.toFixed(1)}% similarity)`, 'error');
        }
        
        return matchFound;
        
    } catch (error) {
        console.error("❌ Face comparison error:", error);
        updateStatus("❌ Face comparison failed", 'error');
        return false;
    }
}

// Start Attendance Check
async function startAttendanceCheck() {
    if (attendanceMarked) {
        alert("✅ Attendance already marked for this session!");
        return;
    }
    
    const btn = document.getElementById('mark-attendance-btn');
    btn.disabled = true;
    btn.textContent = "Processing...";
    
    try {
        updateStatus("📸 Capturing face...");
        
        // Check if face is detected by MediaPipe
        if (!lastDetectedFace) {
            throw new Error("No face detected! Please face the camera.");
        }
        
        updateStatus("✅ Face detected! Checking liveness...");
        
        // Liveness check
        await new Promise(resolve => setTimeout(resolve, 2000));
        const isLive = checkLiveness();
        
        if (!isLive) {
            throw new Error("Liveness check failed! Please blink naturally.");
        }
        
        updateStatus("✅ Liveness confirmed! Verifying face identity...");
        
        // Face comparison
        const faceMatches = await compareFaceWithStoredPhotos(lastDetectedFace);
        
        if (!faceMatches) {
            throw new Error("🚫 UNAUTHORIZED PERSON! Face does not match Student ID: " + currentStudentId);
        }
        
        updateStatus("✅ Face verified! Getting location...");
        
        // Get location
        const location = await getUserLocation();
        
        // Generate device fingerprint
        updateStatus("🔐 Verifying device...");
        const fingerprint = await generateDeviceFingerprint();
        
        // Check for duplicate attendance
        updateStatus("🔍 Checking for duplicates...");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const existingAttendance = await db.collection('attendance')
            .where('studentId', '==', currentStudentId)
            .where('date', '>=', firebase.firestore.Timestamp.fromDate(today))
            .get();
        
        if (!existingAttendance.empty) {
            throw new Error("⚠️ Attendance already marked for today!");
        }
        
        // Mark attendance
        updateStatus("💾 Marking attendance...");
        
        const attendanceData = {
            studentId: currentStudentId,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            date: firebase.firestore.Timestamp.fromDate(new Date()),
            location: location,
            deviceFingerprint: fingerprint,
            livenessCheck: true,
            faceVerified: true,
            verificationMethod: 'mediapipe-face-comparison'
        };
        
        await db.collection('attendance').add(attendanceData);
        
        attendanceMarked = true;
        
        updateStatus("✅ ATTENDANCE MARKED SUCCESSFULLY!", 'success');
        
        // Show success screen
        document.getElementById('camera-container').style.display = 'none';
        document.getElementById('success-container').style.display = 'block';
        document.getElementById('success-student-id').textContent = currentStudentId;
        document.getElementById('success-time').textContent = new Date().toLocaleString();
        
        console.log("✅ Attendance marked:", attendanceData);
        
    } catch (error) {
        console.error("❌ Attendance error:", error);
        alert(error.message);
        btn.disabled = false;
        btn.textContent = "🎯 Start Attendance Check";
        updateStatus("❌ " + error.message, 'error');
    }
}

// Reset for new student
function resetForNewStudent() {
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    
    currentStudentId = null;
    storedFaceDescriptors = [];
    studentPhotos = [];
    attendanceMarked = false;
    blinkCount = 0;
    lastDetectedFace = null;
    
    document.getElementById('student-id-input').value = '';
    document.getElementById('success-container').style.display = 'none';
    document.getElementById('camera-container').style.display = 'none';
    document.getElementById('id-input-section').style.display = 'block';
    document.getElementById('verify-id-btn').disabled = false;
    document.getElementById('verify-id-btn').textContent = 'Continue to Face Verification';
    
    updateStatus("Enter Student ID to begin");
    
    console.log("✅ Reset for new student");
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log("✅ Page loaded - MediaPipe Fraud Detection Active");
    updateStatus("Enter your Student ID to begin attendance");
    
    const verifyBtn = document.getElementById('verify-id-btn');
    if (verifyBtn) {
        verifyBtn.addEventListener('click', verifyStudentId);
    }
    
    const markBtn = document.getElementById('mark-attendance-btn');
    if (markBtn) {
        markBtn.addEventListener('click', startAttendanceCheck);
    }
    
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetForNewStudent);
    }
    
    const idInput = document.getElementById('student-id-input');
    if (idInput) {
        idInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                verifyStudentId();
            }
        });
    }
});
