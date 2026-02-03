import { HandGesture, HandData } from '../types';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface Results {
  multiHandLandmarks: Landmark[][];
}

declare global {
  interface Window {
    Hands: any;
  }
}

export class HandDetectionService {
  private hands: any | null = null;
  private videoElement: HTMLVideoElement;
  private onHandUpdate: (data: HandData) => void;
  private lastPosition: { x: number, y: number } | null = null;
  private lastTime: number = 0;
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;

  constructor(videoElement: HTMLVideoElement, onHandUpdate: (data: HandData) => void) {
    this.videoElement = videoElement;
    this.onHandUpdate = onHandUpdate;
  }

  public async initialize() {
    console.log("Initializing Hand Detection...");

    // 1. Start Camera FIRST to trigger permissions prompt immediately
    try {
      await this.startCamera();
      console.log("Camera initialized successfully");
    } catch (err) {
      console.error("Camera failed to start. Permissions might be denied.", err);
      // We continue to try loading MediaPipe, though it won't receive frames.
    }

    // 2. Initialize MediaPipe Hands
    try {
      // Poll for window.Hands to be available (max 10 seconds)
      let attempts = 0;
      while (!window.Hands && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!window.Hands) {
        console.error("MediaPipe Hands script unavailable.");
        return;
      }

      this.hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
        }
      });

      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.hands.onResults(this.onResults);

      // Start processing loop if camera is active
      if (this.videoElement.readyState >= 2 || this.stream) {
        this.isRunning = true;
        this.processLoop();
      }
    } catch (error) {
      console.error("Error initializing MediaPipe Hands:", error);
    }
  }

  private async startCamera() {
    if (!this.videoElement) return;

    try {
      // Ensure video element properties are set for mobile/inline playback
      this.videoElement.setAttribute('autoplay', '');
      this.videoElement.setAttribute('muted', '');
      this.videoElement.setAttribute('playsinline', '');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });

      this.stream = stream;
      this.videoElement.srcObject = stream;
      
      await new Promise<void>((resolve) => {
        if (this.videoElement.readyState >= 2) {
          resolve();
          return;
        }
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play().then(() => resolve()).catch(console.error);
        };
      });
    } catch (err) {
      console.error("Camera access failed or denied:", err);
      throw err;
    }
  }

  private processLoop = async () => {
    if (!this.isRunning) return;

    if (this.hands && this.videoElement && this.videoElement.readyState >= 2) {
      try {
        await this.hands.send({ image: this.videoElement });
      } catch (e) {
        // Suppress transient errors
      }
    }

    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

  private onResults = (results: Results) => {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.onHandUpdate({
        x: 0,
        y: 0,
        gesture: HandGesture.NONE,
        velocity: { x: 0, y: 0 }
      });
      this.lastPosition = null;
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    
    // Mirror X coordinate
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    const centerX = 1 - ((wrist.x + middleMCP.x) / 2); 
    const centerY = (wrist.y + middleMCP.y) / 2;

    const gesture = this.detectGesture(landmarks);
    
    const now = performance.now();
    let velocity = { x: 0, y: 0 };
    
    if (this.lastPosition && this.lastTime > 0) {
      const dt = (now - this.lastTime) / 1000;
      if (dt > 0.01) {
        velocity = {
          x: (centerX - this.lastPosition.x) / dt,
          y: (centerY - this.lastPosition.y) / dt
        };
      }
    }

    this.lastPosition = { x: centerX, y: centerY };
    this.lastTime = now;

    this.onHandUpdate({
      x: centerX,
      y: centerY,
      gesture,
      velocity
    });
  };

  private detectGesture(landmarks: any[]): HandGesture {
    const wrist = landmarks[0];
    
    const isFingerOpen = (tipIdx: number, mcpIdx: number) => {
      const tip = landmarks[tipIdx];
      const mcp = landmarks[mcpIdx];
      const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
      const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
      return distTip > distMcp * 1.3; 
    };

    const indexOpen = isFingerOpen(8, 5);
    const middleOpen = isFingerOpen(12, 9);
    const ringOpen = isFingerOpen(16, 13);
    const pinkyOpen = isFingerOpen(20, 17);
    
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const thumbOpen = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) > 
                      Math.hypot(thumbIP.x - wrist.x, thumbIP.y - wrist.y);

    // Strict Binary Classification:
    // Palm: 3 or more fingers open
    // Fist: 0, 1, or 2 fingers open (Consumes "Pointing" state to improve Fist responsiveness)
    const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen, thumbOpen].filter(Boolean).length;

    if (openCount >= 3) return HandGesture.OPEN_PALM;
    return HandGesture.CLOSED_FIST;
  }

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.hands) {
      this.hands.close();
    }
  }
}