class GPSVideoRecorder {
    constructor() {
        this.initializeElements();
        this.setupVariables();
        this.setupEventListeners();
        this.initializeApp();
    }

    initializeElements() {
        // Get all DOM elements
        this.videoElement = document.getElementById('videoElement');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.videoWrapper = document.getElementById('videoWrapper');
        this.recordBtn = document.getElementById('recordBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.switchCameraBtn = document.getElementById('switchCameraBtn');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.recordingTime = document.getElementById('recordingTime');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.gpsStatus = document.getElementById('gpsStatus');
        this.coordinates = document.getElementById('coordinates');
        this.altitude = document.getElementById('altitude');
        this.speed = document.getElementById('speed');
        this.recordingsList = document.getElementById('recordingsList');
        this.gestureHint = document.getElementById('gestureHint');
        this.errorToast = document.getElementById('errorToast');
    }

    setupVariables() {
        this.stream = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.isPaused = false;
        this.recordingStartTime = 0;
        this.recordingTimer = null;
        this.currentZoom = 1.0;
        this.maxZoom = 4.0;
        this.minZoom = 1.0;
        this.currentCamera = 'environment';
        this.watchId = null;
        this.recordings = [];
        this.hasDevices = false;
        this.lastGPSUpdate = null;
        this.canvas2dContext = this.overlayCanvas.getContext('2d');
        this.gpsData = {
            latitude: null,
            longitude: null,
            altitude: null,
            speed: null
        };
    }

    setupEventListeners() {
        // Button click handlers
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.switchCameraBtn.addEventListener('click', () => this.switchCamera());
        this.zoomInBtn.addEventListener('click', () => this.adjustZoom(0.1));
        this.zoomOutBtn.addEventListener('click', () => this.adjustZoom(-0.1));

        // Touch event handlers for zoom
        this.videoWrapper.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.videoWrapper.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.videoWrapper.addEventListener('touchend', () => this.handleTouchEnd());

        // Add keyboard shortcuts
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.toggleRecording();
            } else if (e.code === 'KeyS') {
                this.stopRecording();
            }
        });

        // Handle orientation changes
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.updateCanvasSize();
                this.drawGPSOverlay();
            }, 100);
        });

        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isRecording && !this.isPaused) {
                this.pauseRecording();
            }
        });

        // Handle resize
        window.addEventListener('resize', () => {
            this.updateCanvasSize();
        });
    }

    async initializeApp() {
        try {
            await this.checkDevices();
            await this.initializeCamera();
            await this.initializeGPS();
            this.updateCanvasSize();
            this.loadSavedRecordings();
            
            // Show gesture hint after initialization
            setTimeout(() => {
                this.gestureHint.style.display = 'flex';
                setTimeout(() => {
                    this.gestureHint.style.display = 'none';
                }, 5000);
            }, 2000);
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showError('Failed to initialize application. Please check camera and GPS permissions.');
        }
    }

    async initializeGPS() {
        if ('geolocation' in navigator) {
            try {
                // Request a single position first to handle initial permissions
                await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 0
                    });
                });

                // Start watching position
                this.watchId = navigator.geolocation.watchPosition(
                    (position) => this.handleGPSSuccess(position),
                    (error) => this.handleGPSError(error),
                    {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 1000
                    }
                );
            } catch (error) {
                this.handleGPSError(error);
            }
        } else {
            this.showError('GPS not supported on this device');
            this.gpsStatus.classList.add('error');
        }
    }

    handleGPSSuccess(position) {
        this.gpsData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
            speed: position.coords.speed
        };

        // Update UI
        this.coordinates.textContent = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        this.altitude.textContent = position.coords.altitude ? `Alt: ${position.coords.altitude.toFixed(1)}m` : 'Alt: --';
        this.speed.textContent = position.coords.speed ? `Speed: ${(position.coords.speed * 3.6).toFixed(1)}km/h` : 'Speed: --';

        // Update GPS status
        this.gpsStatus.classList.remove('error');
        this.gpsStatus.classList.add('active');
        this.gpsStatus.innerHTML = '<i class="fas fa-satellite-dish"></i><span>GPS Active</span>';

        this.lastGPSUpdate = Date.now();
    }

    handleGPSError(error) {
        console.error('GPS Error:', error);
        this.gpsStatus.classList.remove('active');
        this.gpsStatus.classList.add('error');
        this.gpsStatus.innerHTML = '<i class="fas fa-satellite-dish"></i><span>GPS Error</span>';
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                this.showError('GPS permission denied');
                break;
            case error.POSITION_UNAVAILABLE:
                this.showError('GPS position unavailable');
                break;
            case error.TIMEOUT:
                this.showError('GPS timeout');
                break;
            default:
                this.showError('GPS error occurred');
        }
    }

    async checkDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            this.hasDevices = videoDevices.length > 1;
            this.switchCameraBtn.style.display = this.hasDevices ? 'flex' : 'none';
        } catch (error) {
            console.error('Failed to enumerate devices:', error);
            this.showError('Failed to detect cameras');
        }
    }

    async initializeCamera() {
        const constraints = {
            video: {
                facingMode: { ideal: this.currentCamera },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true
        };

        try {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.stream;
            this.videoElement.classList.toggle('environment', this.currentCamera === 'environment');
            
            // Check zoom capabilities
            const videoTrack = this.stream.getVideoTracks()[0];
            const capabilities = videoTrack.getCapabilities();
            
            if (capabilities.zoom) {
                this.maxZoom = capabilities.zoom.max;
                this.minZoom = capabilities.zoom.min;
                this.currentZoom = this.minZoom;
                this.updateZoomUI();
            }
        } catch (error) {
            console.error('Camera initialization failed:', error);
            this.showError('Failed to access camera');
            throw error;
        }
    }

    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            const seconds = Math.floor((elapsed / 1000) % 60);
            const minutes = Math.floor((elapsed / (1000 * 60)) % 60);
            const hours = Math.floor(elapsed / (1000 * 60 * 60));

            this.recordingTime.textContent = hours > 0 
                ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    handleTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            this.touchStartDistance = this.getTouchDistance(e.touches);
            this.touchStartZoom = this.currentZoom;
            this.gestureHint.style.display = 'none';
        }
    }

    handleTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const currentDistance = this.getTouchDistance(e.touches);
            const scale = currentDistance / this.touchStartDistance;
            const newZoom = Math.min(
                Math.max(this.touchStartZoom * scale, this.minZoom),
                this.maxZoom
            );
            
            if (Math.abs(newZoom - this.currentZoom) > 0.01) {
                this.currentZoom = newZoom;
                this.updateZoomUI();
            }
        }
    }

    handleTouchEnd() {
        this.touchStartDistance = 0;
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    updateZoomUI() {
        this.zoomLevel.textContent = `${this.currentZoom.toFixed(1)}x`;
        
        if (this.stream) {
            const videoTrack = this.stream.getVideoTracks()[0];
            const capabilities = videoTrack.getCapabilities();
            
            if (capabilities.zoom) {
                videoTrack.applyConstraints({
                    advanced: [{ zoom: this.currentZoom }]
                }).catch(error => {
                    console.error('Failed to apply zoom:', error);
                });
            }
        }
    }

    adjustZoom(delta) {
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom + delta));
        if (newZoom !== this.currentZoom) {
            this.currentZoom = newZoom;
            this.updateZoomUI();
        }
    }

    async switchCamera() {
        this.currentCamera = this.currentCamera === 'environment' ? 'user' : 'environment';
        await this.initializeCamera();
    }

    updateCanvasSize() {
        const rect = this.videoWrapper.getBoundingClientRect();
        this.overlayCanvas.width = rect.width;
        this.overlayCanvas.height = rect.height;
    }

    showError(message, duration = 3000) {
        this.errorToast.textContent = message;
        this.errorToast.style.display = 'block';
        
        setTimeout(() => {
            this.errorToast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                this.errorToast.style.display = 'none';
                this.errorToast.style.animation = '';
            }, 300);
        }, duration);
    }

    toggleRecording() {
        if (!this.isRecording) {
            this.startRecording();
        } else if (!this.isPaused) {
            this.pauseRecording();
        } else {
            this.resumeRecording();
        }
    }

    startRecording() {
        if (!this.stream) {
            this.showError('Camera not initialized');
            return;
        }

        try {
            const options = { mimeType: 'video/webm;codecs=vp9,opus' };
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            
            this.mediaRecorder.onstop = () => this.processRecording();
            
            this.mediaRecorder.start(1000);
            this.isRecording = true;
            this.isPaused = false;
            this.recordingStartTime = Date.now();
            this.startRecordingTimer();
            this.updateRecordingUI();
            
            if (navigator.vibrate) {
                navigator.vibrate(200);
            }
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showError('Failed to start recording');
        }
    }

    pauseRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.isPaused = true;
            clearInterval(this.recordingTimer);
            this.updateRecordingUI();
            
            if (navigator.vibrate) {
                navigator.vibrate([100, 50, 100]);
            }
        }
    }

    resumeRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            this.isPaused = false;
            this.startRecordingTimer();
            this.updateRecordingUI();
            
            if (navigator.vibrate) {
                navigator.vibrate(200);
            }
        }
    }

    stopRecording() {
        if (this.mediaRecorder && (this.mediaRecorder.state === 'recording' || this.mediaRecorder.state === 'paused')) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.isPaused = false;
            clearInterval(this.recordingTimer);
            this.updateRecordingUI();
            
            if (navigator.vibrate) {
                navigator.vibrate([100, 50, 100, 50, 100]);
            }
        }
    }

    updateRecordingUI() {
        this.recordBtn.classList.toggle('recording', this.isRecording);
        this.recordingIndicator.classList.toggle('active', this.isRecording);
        this.stopBtn.disabled = !this.isRecording;
        
        if (!this.isRecording) {
            this.recordBtn.innerHTML = '<i class="fas fa-circle"></i>';
            this.recordingTime.textContent = '00:00';
        } else if (this.isPaused) {
            this.recordBtn.innerHTML = '<i class="fas fa-play"></i>';
        } else {
            this.recordBtn.innerHTML = '<i class="fas fa-pause"></i>';
        }
    }

    async processRecording() {
        try {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString();
            
            // Create recording metadata
            const recording = {
                id: `rec_${Date.now()}`,
                url: url,
                timestamp: timestamp,
                filename: `GPS_Recording_${timestamp.replace(/[:.]/g, '-')}.webm`,
                size: blob.size,
                duration: Math.floor((Date.now() - this.recordingStartTime) / 1000),
                gpsData: { ...this.gpsData }
            };

            this.recordings.push(recording);
            this.saveRecordings();
            this.addRecordingToUI(recording);
            
            // Create download if supported
            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: recording.filename,
                        types: [{
                            description: 'WebM Video File',
                            accept: { 'video/webm': ['.webm'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (error) {
                    console.error('Failed to save file:', error);
                    this.triggerDownload(blob, recording.filename);
                }
            } else {
                this.triggerDownload(blob, recording.filename);
            }
        } catch (error) {
            console.error('Failed to process recording:', error);
            this.showError('Failed to save recording');
        }
    }

    triggerDownload(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    addRecordingToUI(recording) {
        const item = document.createElement('div');
        item.className = 'recording-item';
        item.innerHTML = `
            <video src="${recording.url}" controls></video>
            <div class="recording-info">
                <div class="recording-title">
                    ${new Date(recording.timestamp).toLocaleString()}
                </div>
                <div class="recording-metadata">
                    <span>${this.formatDuration(recording.duration)}</span>
                    <span>${this.formatSize(recording.size)}</span>
                </div>
                <div class="recording-gps">
                    <small>
                        ${recording.gpsData.latitude ? 
                        `${recording.gpsData.latitude.toFixed(6)}, ${recording.gpsData.longitude.toFixed(6)}` : 
                        'No GPS data'}
                    </small>
                </div>
            </div>
        `;
        
        this.recordingsList.insertBefore(item, this.recordingsList.firstChild);
    }

    formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    saveRecordings() {
        const recordingsData = this.recordings.map(rec => ({
            id: rec.id,
            timestamp: rec.timestamp,
            filename: rec.filename,
            size: rec.size,
            duration: rec.duration,
            gpsData: rec.gpsData
        }));
        
        try {
            localStorage.setItem('gpsVideoRecordings', JSON.stringify(recordingsData));
        } catch (error) {
            console.error('Failed to save recordings to localStorage:', error);
        }
    }

    loadSavedRecordings() {
        try {
            const savedRecordings = localStorage.getItem('gpsVideoRecordings');
            if (savedRecordings) {
                const recordingsData = JSON.parse(savedRecordings);
                recordingsData.forEach(rec => {
                    const recording = {
                        ...rec,
                        url: null // URLs can't be saved and restored
                    };
                    this.recordings.push(recording);
                });
            }
        } catch (error) {
            console.error('Failed to load recordings from localStorage:', error);
        }
    }

    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.isRecording) {
            this.stopRecording();
        }
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        
        this.recordedChunks = [];
        this.recordings.forEach(recording => {
            if (recording.url) {
                URL.revokeObjectURL(recording.url);
            }
        });
    }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new GPSVideoRecorder();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.cleanup();
    }
});