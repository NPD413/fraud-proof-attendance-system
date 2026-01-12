# 🛡️ Secure AI Attendance System (SaaS)

A high-security, fraud-proof biometric attendance system built for Universities and Corporate environments. 
It uses **Client-Side AI** to verify identity, liveliness, and location without expensive server-side processing.

> **🔴 Live Demo**: [https://smart-attendance-system-f600b.web.app/facedetector.html](https://smart-attendance-system-f600b.web.app/facedetector.html)

---

## 🚀 Key Features

### 1. 🧠 AI Biometric Verification
- **FaceAPI.js**: Matches student faces against a secure encrypted database (Firestore).
- **Strict Thresholds**: Tuned to **40%** (Euclidean Distance ~0.6) to balance security while allowing cross-device verification (Laptop Registration -> Mobile Check-in).

### 2. 👁️ Universal Liveness Detection (v2.5)
- **Problem**: Static photos or videos could spoof older systems.
- **Solution**: Implements **Dynamic Relative Calibration**.
    - Learns the user's specific "Resting Eye Openness" in 1 second.
    - Requires **Two Intentional Blinks** relative to *their* baseline.
    - Works on all eye shapes, lighting conditions, and camera angles (Universal).

### 3. 📍 Intelligent Geofencing
- **Hybrid Location**: Uses **WiFi/Cell Triangulation** (Fast) instead of just GPS.
- **Radius Check**: Users must be within **30km** of the Campus Center (Bangalore).
- **Anti-Spoofing**: Blocks VPNs/Proxies by cross-referencing IP location (optional) and demanding high-confidence browser coordinates.

### 4. 🔒 Device & Network Security
- **Anonymous Auth Guard**: Mobile devices must authenticate via Firebase Anonymous Auth to access the database (prevents unauthorized scraping).
- **Session Locking**: Prevents "Buddy Punching" by locking a Student ID for 5 minutes after 20 failed attempts.
- **100% Client-Side**: No cloud functions required. Operates on the Edge using the user's device power.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3 (Glassmorphism UI), Vanilla JavaScript
- **AI Models**: 
    - `face-api.js` (Face Recognition)
    - `MediaPipe Face Mesh` (Liveness/Blink Detection)
- **Backend (Serverless)**: 
    - **Firebase Authentication** (Anonymous + Email/Pass)
    - **Firebase Firestore** (NoSQL Database)
    - **Firebase Hosting** (SSL Secured)

---

## ⚙️ Setup & Deployment

### 1. Prerequisites
- Node.js installed.
- Firebase CLI (`npm install -g firebase-tools`).

### 2. Installation
```bash
git clone <repo-url>
cd fraud_attendance_detector
npm install
```

### 3. Firebase Configuration
1.  Create a project at [Firebase Console](https://console.firebase.google.com/).
2.  Enable **Firestore** and **Authentication** (Anonymous + Email).
3.  Update `attendance.js` with your config keys.
4.  **Critical**: Apply these Firestore Rules:
    ```javascript
    match /students/{studentId} {
      allow read: if request.auth != null; // Kiosk Access
      allow write: if request.auth != null && request.auth.token.email != null; // Admin Only
    }
    ```

### 4. Deploy
```bash
firebase deploy --only "hosting,firestore:rules"
```

---

## 📱 Mobile Compatibility
- **Supported**: Android (Chrome), iOS (Safari/Chrome).
- **iOS Note**: If "Location Denied" appears, go to `Settings -> Privacy -> Location -> Safari` and select **"While Using App"**.

---

## 👨‍💻 Admin Console
- **URL**: `/login.html`
- **Features**: Register new students, view raw attendance logs, manage security rules.

---
*Built with ❤️ for Secure Campus Attendance*