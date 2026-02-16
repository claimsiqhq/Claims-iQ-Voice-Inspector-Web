import { Platform } from "react-native";
import { callEdgeFunction } from "./api";

export type VoiceState = "idle" | "connecting" | "listening" | "processing" | "speaking" | "error";

export interface TranscriptEntry {
  speaker: "user" | "agent";
  text: string;
  timestamp: number;
}

export interface VoiceSessionCallbacks {
  onVoiceStateChange: (state: VoiceState) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onToolCall: (name: string, args: any) => Promise<any>;
  onError: (error: string) => void;
  onPhotoRequested?: (label: string, photoType: string) => void;
}

// Dynamically get RTCPeerConnection for both web and native
function getRTC(): {
  RTCPeerConnection: any;
  mediaDevices: any;
} {
  if (Platform.OS === "web") {
    return {
      RTCPeerConnection: (globalThis as any).RTCPeerConnection,
      mediaDevices: navigator.mediaDevices,
    };
  }
  // react-native-webrtc
  const webrtc = require("react-native-webrtc");
  return {
    RTCPeerConnection: webrtc.RTCPeerConnection,
    mediaDevices: webrtc.mediaDevices,
  };
}

export class VoiceSession {
  private pc: any = null;
  private dc: any = null;
  private audioEl: any = null;
  private callbacks: VoiceSessionCallbacks;
  private _active = false;

  constructor(callbacks: VoiceSessionCallbacks) {
    this.callbacks = callbacks;
  }

  get active() {
    return this._active;
  }

  async start(claimId: number, sessionId: number): Promise<void> {
    this.callbacks.onVoiceStateChange("connecting");

    try {
      const { RTCPeerConnection, mediaDevices } = getRTC();

      // 1. Get ephemeral key from Supabase Edge Function
      const result = await callEdgeFunction("realtime-session", { claimId, sessionId });
      const clientSecret = result.clientSecret;
      if (!clientSecret) throw new Error("No client secret returned. Is OPENAI_API_KEY set in Supabase secrets?");

      // 2. Create peer connection
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // 3. Audio output
      if (Platform.OS === "web") {
        this.audioEl = new Audio();
        this.audioEl.autoplay = true;
        this.pc.ontrack = (event: any) => {
          if (this.audioEl) this.audioEl.srcObject = event.streams[0];
        };
      } else {
        const { RTCView } = require("react-native-webrtc");
        this.pc.ontrack = (event: any) => {
          // Audio plays automatically on native via react-native-webrtc
        };
      }

      // 4. Audio input (microphone)
      const stream = await mediaDevices.getUserMedia({ audio: true });
      const audioTrack = stream.getTracks ? stream.getTracks()[0] : stream.getAudioTracks()[0];
      this.pc.addTrack(audioTrack, stream);

      // 5. Data channel for events
      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.onopen = () => {
        this._active = true;
        this.callbacks.onVoiceStateChange("listening");
      };
      this.dc.onclose = () => {
        this._active = false;
        this.callbacks.onVoiceStateChange("idle");
      };
      this.dc.onmessage = (event: any) => {
        const data = typeof event.data === "string" ? event.data : event.data;
        this.handleEvent(JSON.parse(data));
      };

      // 6. SDP offer/answer
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
      });
      await this.pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) throw new Error("Failed to establish WebRTC connection with OpenAI");

      const sdpAnswer = await sdpRes.text();
      await this.pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
    } catch (err: any) {
      this.callbacks.onVoiceStateChange("error");
      this.callbacks.onError(err.message || "Voice connection failed");
      this.stop();
    }
  }

  stop() {
    this._active = false;
    if (this.dc) {
      try { this.dc.close(); } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        const senders = this.pc.getSenders ? this.pc.getSenders() : [];
        senders.forEach((s: any) => {
          if (s.track) s.track.stop();
        });
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    this.callbacks.onVoiceStateChange("idle");
  }

  private async handleEvent(event: any) {
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.callbacks.onVoiceStateChange("listening");
        break;

      case "input_audio_buffer.speech_stopped":
        this.callbacks.onVoiceStateChange("processing");
        break;

      case "response.audio.delta":
        this.callbacks.onVoiceStateChange("speaking");
        break;

      case "response.audio.done":
        this.callbacks.onVoiceStateChange("listening");
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          this.callbacks.onTranscript({
            speaker: "user",
            text: event.transcript,
            timestamp: Date.now(),
          });
        }
        break;

      case "response.audio_transcript.done":
        if (event.transcript) {
          this.callbacks.onTranscript({
            speaker: "agent",
            text: event.transcript,
            timestamp: Date.now(),
          });
        }
        break;

      case "response.function_call_arguments.done": {
        const { name, arguments: argsStr, call_id } = event;
        try {
          const args = JSON.parse(argsStr);

          // Photo trigger handled specially
          if (name === "trigger_photo_capture" && this.callbacks.onPhotoRequested) {
            this.callbacks.onPhotoRequested(args.label, args.photoType);
          }

          const result = await this.callbacks.onToolCall(name, args);

          if (this.dc && this.dc.readyState === "open") {
            this.dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id,
                  output: JSON.stringify(result),
                },
              })
            );
            this.dc.send(JSON.stringify({ type: "response.create" }));
          }
        } catch (err: any) {
          if (this.dc && this.dc.readyState === "open") {
            this.dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id,
                  output: JSON.stringify({ error: err.message }),
                },
              })
            );
            this.dc.send(JSON.stringify({ type: "response.create" }));
          }
        }
        break;
      }

      case "error":
        this.callbacks.onError(event.error?.message || "Voice error");
        break;
    }
  }
}
