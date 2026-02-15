import { API_BASE, getAuthHeaders, apiRequest } from "./api";

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
}

export class VoiceSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private callbacks: VoiceSessionCallbacks;
  private _active = false;

  constructor(callbacks: VoiceSessionCallbacks) {
    this.callbacks = callbacks;
  }

  get active() { return this._active; }

  async start(claimId: number, sessionId: number): Promise<void> {
    this.callbacks.onVoiceStateChange("connecting");

    try {
      // 1. Get ephemeral key from our server
      const headers = await getAuthHeaders();
      const tokenRes = await fetch(`${API_BASE}/api/realtime/session`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, sessionId }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to create voice session");
      }

      const { clientSecret } = await tokenRes.json();
      if (!clientSecret) throw new Error("No client secret returned");

      // 2. Create peer connection
      this.pc = new RTCPeerConnection();

      // 3. Audio output
      this.audioEl = new Audio();
      this.audioEl.autoplay = true;
      this.pc.ontrack = (event) => {
        if (this.audioEl) this.audioEl.srcObject = event.streams[0];
      };

      // 4. Audio input (microphone)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.pc.addTrack(stream.getTracks()[0]);

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
      this.dc.onmessage = (event) => {
        this.handleEvent(JSON.parse(event.data));
      };

      // 6. SDP offer/answer
      const offer = await this.pc.createOffer();
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

      if (!sdpRes.ok) throw new Error("Failed to establish WebRTC connection");

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
    if (this.dc) { try { this.dc.close(); } catch {} this.dc = null; }
    if (this.pc) {
      this.pc.getSenders().forEach((s) => { if (s.track) s.track.stop(); });
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    if (this.audioEl) { this.audioEl.srcObject = null; this.audioEl = null; }
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
          this.callbacks.onTranscript({ speaker: "user", text: event.transcript, timestamp: Date.now() });
        }
        break;

      case "response.audio_transcript.done":
        if (event.transcript) {
          this.callbacks.onTranscript({ speaker: "agent", text: event.transcript, timestamp: Date.now() });
        }
        break;

      case "response.function_call_arguments.done": {
        const { name, arguments: argsStr, call_id } = event;
        try {
          const args = JSON.parse(argsStr);
          const result = await this.callbacks.onToolCall(name, args);
          // Send result back to OpenAI
          if (this.dc && this.dc.readyState === "open") {
            this.dc.send(JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id,
                output: JSON.stringify(result),
              },
            }));
            this.dc.send(JSON.stringify({ type: "response.create" }));
          }
        } catch (err: any) {
          if (this.dc && this.dc.readyState === "open") {
            this.dc.send(JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id,
                output: JSON.stringify({ error: err.message }),
              },
            }));
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
