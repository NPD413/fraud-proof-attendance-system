# 🎯 Fraud-Proof Smart Attendance System

A web-based attendance system that uses **facial recognition**, **liveness detection**, and **location tracking** to ensure secure and fraud-proof attendance marking for educational institutions.

---

## 🌟 Project Overview

Traditional attendance systems are vulnerable to proxy attendance and identity fraud. This system addresses these challenges by implementing multiple layers of verification:

- **Face Recognition**: Compares live camera feed with registered student photos
- **Liveness Detection**: Ensures a real person is present (not a photo or video)
- **Location Tracking**: Records GPS coordinates to verify physical presence
- **Device Fingerprinting**: Tracks unique device identifiers to prevent multiple logins
- **Duplicate Prevention**: Blocks multiple attendance entries per day

---

## ✨ Key Features

### For Students
- ✅ Simple ID-based login
- ✅ Real-time face verification
- ✅ Automatic attendance marking
- ✅ Instant confirmation with timestamp
- ✅ Mobile and desktop compatible

### For Administrators
- ✅ Easy student registration portal
- ✅ Multi-angle photo capture (3 photos per student)
- ✅ Centralized database management
- ✅ Real-time attendance tracking
- ✅ View attendance records with location data

### Security Features
- 🔒 **65% similarity threshold** for face matching
- 🔒 **Pixel-based image comparison** algorithm
- 🔒 **Blink detection** for liveness verification
- 🔒 **Device fingerprinting** using hardware specs
- 🔒 **GPS verification** with accuracy tracking
- 🔒 **One attendance per day** per student

---

## 🚀 Live Demo

**🌐 Student Attendance Portal:**  
👉 https://smart-attendance-system-f600b.web.app

**👨‍💼 Admin Registration Portal:**  
👉 https://smart-attendance-system-f600b.web.app/register.html

**🎥 Camera Test Page:**  
👉 https://smart-attendance-system-f600b.web.app/test-camera.html

---
# Fraud-Proof Smart Attendance System

This project uses **facial recognition**, **liveness detection**, and **location tracking** to create a secure, fraud-proof attendance system for educational institutions. It includes a Firebase-hosted web application that allows students to mark attendance using face verification in real-time.

## Live Demo

You can access the live application here:

**[Fraud-Proof Attendance System](https://smart-attendance-system-f600b.web.app)**

**[Admin Registration Portal](https://smart-attendance-system-f600b.web.app/register.html)**

## Features

- **Face Recognition**: Compares live camera feed with registered student photos using pixel-based similarity algorithm
- **Liveness Detection**: Ensures a real person is present through blink detection (prevents photo/video spoofing)
- **Location Tracking**: Records GPS coordinates to verify physical presence on campus
- **Device Fingerprinting**: Tracks unique device identifiers to prevent multiple logins
- **Duplicate Prevention**: Blocks multiple attendance entries per day per student
- **Real-time Verification**: Instant attendance marking with timestamp
- **Admin Portal**: Easy student registration with multi-angle photo capture

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine.

### Prerequisites

You will need to have the following installed on your system:

- **Node.js** - Download from [nodejs.org](https://nodejs.org/)
- **Firebase CLI** - Install via npm: `npm install -g firebase-tools`
- **Firebase Account** - Create one at [firebase.google.com](https://firebase.google.com)
- **Modern Browser** - Chrome or Edge (for Face Detection API support)

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/YOUR_USERNAME/fraud-attendance-system.git
cd fraud-attendance-system
Login to Firebase:

bash
firebase login
Initialize Firebase (if needed):

bash
firebase init hosting
Select your Firebase project

Set public as the public directory

Configure as a single-page app: No

Set up automatic builds with GitHub: No (optional)

Deploy to Firebase:

bash
firebase deploy

How It Works
Student Attendance Flow:
Student enters ID → System fetches registered photos from Firebase Firestore

Camera opens → Live video stream starts

Face detection → Algorithm locates face in frame

Liveness check → Blink detection to prevent spoofing

Face comparison → Current face compared with stored photos (pixel-based similarity)

Threshold check → If similarity ≥ 65%, proceed; else reject as unauthorized

Location capture → GPS coordinates recorded

Device verification → Device fingerprint generated

Duplicate check → Verify no attendance marked today

Mark attendance → Record saved to Firebase with timestamp ✅

Face Verification Algorithm:
javascript
1. Capture current frame from webcam
2. Extract face region using detected bounding box
3. Resize to 64x64 pixels for comparison
4. Compare with each registered photo:
   - Convert to grayscale
   - Calculate pixel-by-pixel difference
   - Compute similarity percentage
5. If any photo matches ≥ 65%, approve
6. Else, reject as unauthorized person
Model Training
The face verification uses a pixel-based image comparison algorithm:

Input: Live camera frame + 3 registered photos per student

Processing:

Resize images to 64x64 pixels

Convert to grayscale

Calculate Manhattan distance between pixels

Convert to similarity percentage

Threshold: 65% similarity = match

Output: Verified (Green box) or Unauthorized (Red box)

Firebase Database Structure
Students Collection
javascript
{
  "STU001": {
    name: "John Doe",
    email: "john@example.com",
    phone: "1234567890",
    department: "Computer Science",
    photos: [
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,..."
    ],
    registeredAt: Timestamp
  }
}
