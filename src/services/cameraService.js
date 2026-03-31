// Camera Service - Handle photo capture
class CameraService {
  constructor() {
    this.stream = null;
    this.videoElement = null;
  }

  // Initialize camera stream
  async initialize(videoElement) {
    try {
      console.log('[CAMERA] Initializing camera...');

      this.videoElement = videoElement;

      // Request camera access
      const constraints = {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user' // Front-facing camera
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Attach stream to video element
      this.videoElement.srcObject = this.stream;

      // Wait for video to be ready
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          resolve();
        };
      });

      console.log('[CAMERA] Camera initialized');
      console.log('[CAMERA] Resolution:',
        this.videoElement.videoWidth, 'x', this.videoElement.videoHeight);

      return true;
    } catch (error) {
      console.error('[CAMERA] Initialization error:', error);
      throw new Error(`Camera initialization failed: ${error.message}`);
    }
  }

  // Capture photo from video stream
  async capturePhoto(canvasElement) {
    try {
      console.log('[CAMERA] Capturing photo...');

      if (!this.stream || !this.videoElement) {
        throw new Error('Camera not initialized');
      }

      // Set canvas dimensions to match video
      const width = this.videoElement.videoWidth;
      const height = this.videoElement.videoHeight;

      canvasElement.width = width;
      canvasElement.height = height;

      // Draw current video frame to canvas
      const ctx = canvasElement.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0, width, height);

      // Convert canvas to data URL (JPEG)
      const dataURL = canvasElement.toDataURL('image/jpeg', 0.95);

      console.log('[CAMERA] Photo captured:', width, 'x', height);

      return dataURL;
    } catch (error) {
      console.error('[CAMERA] Capture error:', error);
      throw error;
    }
  }

  // Get available cameras
  async listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');

      console.log('[CAMERA] Available cameras:', cameras.length);
      cameras.forEach((camera, index) => {
        console.log(`[CAMERA]   ${index + 1}. ${camera.label || 'Camera ' + (index + 1)}`);
      });

      return cameras;
    } catch (error) {
      console.error('[CAMERA] List cameras error:', error);
      return [];
    }
  }

  // Switch camera
  async switchCamera(deviceId) {
    try {
      console.log('[CAMERA] Switching to camera:', deviceId);

      // Stop current stream
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
      }

      // Start new stream with specified device
      const constraints = {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;

      console.log('[CAMERA] Camera switched');
      return true;
    } catch (error) {
      console.error('[CAMERA] Switch camera error:', error);
      throw error;
    }
  }

  // Stop camera stream
  stop() {
    if (this.stream) {
      console.log('[CAMERA] Stopping camera...');
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  // Cleanup
  destroy() {
    this.stop();
    this.videoElement = null;
  }
}

module.exports = CameraService;
