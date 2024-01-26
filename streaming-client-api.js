"use strict";
import DID_API from "./api.json" assert { type: "json" };
import CONFIG from "./config.json" assert { type: "json" };
const { createClient, LiveTranscriptionEvents } = deepgram;

if (DID_API.key == "🤫")
  alert("Please put your API key inside ./api.json and restart.");

let OPENAI_API_KEY = CONFIG.OPENAI_API_KEY;
let DEEPGRAM_API_KEY = CONFIG.DEEPGRAM_API_KEY;
const system_prompt = CONFIG.SYSTEM_PROMPT;

let messages = [{ role: "system", content: system_prompt }];

async function fetchOpenAIResponse(userMessage) {
  messages.push({ role: "user", content: userMessage });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo-1106",
      messages: messages,
      temperature: 0.7,
      max_tokens: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed with status ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

const RTCPeerConnection = (
  window.RTCPeerConnection ||
  window.webkitRTCPeerConnection ||
  window.mozRTCPeerConnection
).bind(window);

let peerConnection;
let streamId;
let sessionId;
let sessionClientAnswer;

let statsIntervalId;
let videoIsPlaying;
let lastBytesReceived;

let isRecording = false;
let mediaRecorder;

let audioContext;
let processor;
let source;
let dg_client;
let dg_client_live;

const createNewDeepgram = () => {
  return createClient(DEEPGRAM_API_KEY);
};

const createNewDeepgramLive = (dg) => {
  return dg.listen.live({
    language: "en-US",
    smart_format: true,
    model: "nova",
    interim_results: true,
    endpointing: 100,
    no_delay: true,
    utterance_end_ms: 1000,
  });
};

const initDeepgram = (dg) => {
  dg_client_live = createNewDeepgramLive(dg);
  addDeepgramTranscriptListener(dg_client_live);
  addDeepgramOpenListener(dg_client_live);
  addDeepgramCloseListener(dg_client_live);
  // addDeepgramErrorListener(dg_client_live);
};

const talkVideo = document.getElementById("talk-video");
talkVideo.setAttribute("playsinline", "");
const peerStatusLabel = document.getElementById("peer-status-label");
const iceStatusLabel = document.getElementById("ice-status-label");
const iceGatheringStatusLabel = document.getElementById(
  "ice-gathering-status-label"
);
const signalingStatusLabel = document.getElementById("signaling-status-label");
const streamingStatusLabel = document.getElementById("streaming-status-label");

const connectButton = document.getElementById("connect-button");
connectButton.onclick = async () => {
  if (
    peerConnection &&
    peerConnection.connectionState === "connected" &&
    isRecording
  ) {
    return;
  }

  stopRecording();
  stopAllStreams();
  closePC();

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(async (stream) => {
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        return alert(
          "iOS / Safari Browser not supported. Please use Chrome or Firefox on Desktop or use Android."
        );
      }

      dg_client = createNewDeepgram();
      initDeepgram(dg_client);

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });

      mediaRecorder.start(250);

      mediaRecorder.addEventListener("dataavailable", async (event) => {
        if (event.data.size > 0) dgPacketResponse(event.data, dg_client_live);
      });
    })
    .catch((err) => {
      console.log("error on media recorder: ", err);
      alert("Can't find Media device or Permission denied!");
    });

  const sessionResponse = await fetch(`${DID_API.url}/talks/streams`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${DID_API.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_url: "https://i.postimg.cc/P5mmSy0v/lady.jpg",
    }),
  });

  const {
    id: newStreamId,
    offer,
    ice_servers: iceServers,
    session_id: newSessionId,
  } = await sessionResponse.json();
  streamId = newStreamId;
  sessionId = newSessionId;

  try {
    sessionClientAnswer = await createPeerConnection(offer, iceServers);
  } catch (e) {
    console.log("error during streaming setup", e);
    stopRecording();
    stopAllStreams();
    closePC();
    return;
  }

  const sdpResponse = await fetch(
    `${DID_API.url}/talks/streams/${streamId}/sdp`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${DID_API.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answer: sessionClientAnswer,
        session_id: sessionId,
      }),
    }
  );
};

const talkButton = document.getElementById("talk-button");
talkButton.onclick = async () => {
  const userInput = document.getElementById("user-input-field").value;
  processTalk(userInput);
};

async function processTalk(msg) {
  if (
    peerConnection?.signalingState === "stable" ||
    peerConnection?.iceConnectionState === "connected"
  ) {
    //
    // Get the user input from the text input field get ChatGPT Response
    const responseFromOpenAI = await fetchOpenAIResponse(msg);
    messages.push({ role: "assistant", content: responseFromOpenAI });
    //
    // Print the openAIResponse to the console
    console.log("Chatting history:", messages);
    //
    const talkResponse = await fetch(
      `${DID_API.url}/talks/streams/${streamId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${DID_API.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          script: {
            type: "text",
            subtitles: "false",
            provider: {
              type: "microsoft",
              voice_id: "en-US-ChristopherNeural",
            },
            ssml: false,
            input: responseFromOpenAI, //send the openAIResponse to D-id
          },
          config: {
            fluent: true,
            pad_audio: 0,
            driver_expressions: {
              expressions: [
                { expression: "neutral", start_frame: 0, intensity: 0 },
              ],
              transition_frames: 0,
            },
            align_driver: true,
            align_expand_factor: 0,
            auto_match: true,
            motion_factor: 0,
            normalization_factor: 0,
            sharpen: true,
            stitch: true,
            result_format: "mp4",
          },
          driver_url: "bank://lively/",
          config: {
            stitch: true,
          },
          session_id: sessionId,
        }),
      }
    );
  }
}

// NOTHING BELOW THIS LINE IS CHANGED FROM ORIGNAL D-id File Example
//

const destroyButton = document.getElementById("destroy-button");
destroyButton.onclick = async () => {
  await fetch(`${DID_API.url}/talks/streams/${streamId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${DID_API.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  stopRecording();
  stopAllStreams();
  closePC();
};

function onIceGatheringStateChange() {
  iceGatheringStatusLabel.innerText = peerConnection.iceGatheringState;
  iceGatheringStatusLabel.className =
    "iceGatheringState-" + peerConnection.iceGatheringState;
}
function onIceCandidate(event) {
  console.log("onIceCandidate", event);
  if (event.candidate) {
    const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

    fetch(`${DID_API.url}/talks/streams/${streamId}/ice`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${DID_API.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        candidate,
        sdpMid,
        sdpMLineIndex,
        session_id: sessionId,
      }),
    });
  }
}
function onIceConnectionStateChange() {
  iceStatusLabel.innerText = peerConnection.iceConnectionState;
  iceStatusLabel.className =
    "iceConnectionState-" + peerConnection.iceConnectionState;
  if (
    peerConnection.iceConnectionState === "failed" ||
    peerConnection.iceConnectionState === "closed"
  ) {
    stopAllStreams();
    closePC();
  }
}
function onConnectionStateChange() {
  // not supported in firefox
  peerStatusLabel.innerText = peerConnection.connectionState;
  peerStatusLabel.className =
    "peerConnectionState-" + peerConnection.connectionState;
}
function onSignalingStateChange() {
  signalingStatusLabel.innerText = peerConnection.signalingState;
  signalingStatusLabel.className =
    "signalingState-" + peerConnection.signalingState;
}

function onVideoStatusChange(videoIsPlaying, stream) {
  let status;
  if (videoIsPlaying) {
    status = "streaming";
    const remoteStream = stream;
    setVideoElement(remoteStream);
  } else {
    status = "empty";
    playIdleVideo();
  }
  streamingStatusLabel.innerText = status;
  streamingStatusLabel.className = "streamingState-" + status;
}

function onTrack(event) {
  /**
   * The following code is designed to provide information about wether currently there is data
   * that's being streamed - It does so by periodically looking for changes in total stream data size
   *
   * This information in our case is used in order to show idle video while no talk is streaming.
   * To create this idle video use the POST https://api.d-id.com/talks endpoint with a silent audio file or a text script with only ssml breaks
   * https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html#break-tag
   * for seamless results use `config.fluent: true` and provide the same configuration as the streaming video
   */

  if (!event.track) return;

  statsIntervalId = setInterval(async () => {
    const stats = await peerConnection.getStats(event.track);
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.mediaType === "video") {
        const videoStatusChanged =
          videoIsPlaying !== report.bytesReceived > lastBytesReceived;

        if (videoStatusChanged) {
          videoIsPlaying = report.bytesReceived > lastBytesReceived;
          onVideoStatusChange(videoIsPlaying, event.streams[0]);
        }
        lastBytesReceived = report.bytesReceived;
      }
    });
  }, 500);
}

async function createPeerConnection(offer, iceServers) {
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({ iceServers });
    peerConnection.addEventListener(
      "icegatheringstatechange",
      onIceGatheringStateChange,
      true
    );
    peerConnection.addEventListener("icecandidate", onIceCandidate, true);
    peerConnection.addEventListener(
      "iceconnectionstatechange",
      onIceConnectionStateChange,
      true
    );
    peerConnection.addEventListener(
      "connectionstatechange",
      onConnectionStateChange,
      true
    );
    peerConnection.addEventListener(
      "signalingstatechange",
      onSignalingStateChange,
      true
    );
    peerConnection.addEventListener("track", onTrack, true);
  }

  await peerConnection.setRemoteDescription(offer);
  console.log("set remote sdp OK");

  const sessionClientAnswer = await peerConnection.createAnswer();
  console.log("create local sdp OK");

  await peerConnection.setLocalDescription(sessionClientAnswer);
  console.log("set local sdp OK");

  return sessionClientAnswer;
}

function setVideoElement(stream) {
  if (!stream) return;
  talkVideo.srcObject = stream;
  talkVideo.loop = false;

  // safari hotfix
  if (talkVideo.paused) {
    talkVideo
      .play()
      .then((_) => {})
      .catch((e) => {});
  }
}

function playIdleVideo() {
  talkVideo.srcObject = undefined;
  talkVideo.src = "idle.mp4";
  talkVideo.loop = true;
}

function stopRecording() {
  if (isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    socket.close();
  }
  if (dg_client_live) dg_client_live.removeAllListeners();
}

function stopAllStreams() {
  if (talkVideo.srcObject) {
    console.log("stopping video streams");
    talkVideo.srcObject.getTracks().forEach((track) => track.stop());
    talkVideo.srcObject = null;
  }
}

function closePC(pc = peerConnection) {
  if (!pc) return;
  console.log("stopping peer connection");
  pc.close();
  pc.removeEventListener(
    "icegatheringstatechange",
    onIceGatheringStateChange,
    true
  );
  pc.removeEventListener("icecandidate", onIceCandidate, true);
  pc.removeEventListener(
    "iceconnectionstatechange",
    onIceConnectionStateChange,
    true
  );
  pc.removeEventListener(
    "connectionstatechange",
    onConnectionStateChange,
    true
  );
  pc.removeEventListener("signalingstatechange", onSignalingStateChange, true);
  pc.removeEventListener("track", onTrack, true);
  clearInterval(statsIntervalId);
  iceGatheringStatusLabel.innerText = "";
  signalingStatusLabel.innerText = "";
  iceStatusLabel.innerText = "";
  peerStatusLabel.innerText = "";
  console.log("stopped peer connection");
  if (pc === peerConnection) {
    peerConnection = null;
  }
}

const maxRetryCount = 3;
const maxDelaySec = 4;
// Default of 1 moved to 5
async function fetchWithRetries(url, options, retries = 3) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= maxRetryCount) {
      const delay =
        Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) * 1000;

      await new Promise((resolve) => setTimeout(resolve, delay));

      console.log(
        `Request failed, retrying ${retries}/${maxRetryCount}. Error ${err}`
      );
      return fetchWithRetries(url, options, retries + 1);
    } else {
      throw new Error(`Max retries exceeded. error: ${err}`);
    }
  }
}

let speechChunk = "";
const addDeepgramTranscriptListener = (dg) => {
  dg.on(LiveTranscriptionEvents.Transcript, async (dgOutput) => {
    let dgJSON = dgOutput;
    let words = [];
    if (dgJSON.channel) {
      let utterance;
      try {
        utterance = dgJSON.channel.alternatives[0].transcript;
        words = words.concat(dgJSON.channel.alternatives[0].words);
      } catch (error) {
        console.log(
          "WARNING: parsing dgJSON failed. Response from dgLive is:",
          error
        );
        console.log(dgJSON);
      }
      if (utterance) {
        if (!speechChunk) {
          speechChunk = "";
        }
        if (dgJSON.speech_final) {
          speechChunk += utterance + " ";
          console.log(`DEBUG SPEECH_FINAL ${speechChunk}`);
          processTalk(speechChunk);
          speechChunk = "";
          words = [];
        } else if (dgJSON.is_final) {
          speechChunk += utterance + " ";
          console.log(`DEBUG IS_FINAL: ${speechChunk}`);
        } else {
          console.log(`DEBUG INTERIM_RESULT: `, utterance);
        }
      }
    } else {
      if (speechChunk != "") {
        console.log(`DEBUG UTTERANCE_END_MS Triggered: ${speechChunk}`);
        speechChunk = "";
      } else {
        console.log(`DEBUG UTTERANCE_END_MS Not Triggered: ${speechChunk}`);
      }
    }
  });
};

const addDeepgramOpenListener = (dg) => {
  dg.on(LiveTranscriptionEvents.Open, (msg) => {
    console.log(`Deepgram Live Websocket connection open!`);
    setInterval(() => {
      dg.keepAlive();
    }, 3000);
  });
};

const addDeepgramCloseListener = (dg) => {
  dg.on(LiveTranscriptionEvents.Close, async (msg) => {
    console.log(`Deepgram Live CONNNECTION CLOSED`);
    dg_client_live = null;
  });
};

const dgPacketResponse = (data, dg) => {
  if (dg && dg.getReadyState() === 1) {
    dg.send(data);
  }
};
