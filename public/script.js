let vidScaleClient = null;
let audioDevices = null;
let videoDevices = null;
const peers = new Map(); // Map to store peer details
let selectedAudioDeviceId = null;
let selectedVideoDeviceId = null;
const screenShares = new Map(); // Map to store screen share details

const captionsByPeer = new Map();
let captionsChat = [];
const MAX_CAPTIONS = 200;

// Transcription mixer state (simple version)
let txAudioContext = null;
let txDestination = null;
let txRecorder = null;
const txSourceNodes = new Map();
const txGainNodes = new Map();

function ensureTxGraph() {
  try {
    if (!txAudioContext) txAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!txDestination) txDestination = txAudioContext.createMediaStreamDestination();
  } catch (e) { console.warn("Failed to init transcription graph", e); }
}

function startTxRecorder() {
  try {
    if (txRecorder) return;
    ensureTxGraph();
    if (!txDestination) return;
    const stream = txDestination.stream;
    if (!stream) return;
    const options = { mimeType: 'audio/webm;codecs=opus' };
    const rec = new MediaRecorder(stream, options);
    rec.ondataavailable = (event) => {
      try {
        if (!event.data || !event.data.size || !vidScaleClient || !vidScaleClient.sendAudioForTranscription) return;
        const reader = new FileReader();
        reader.onload = () => {
          const base64Audio = reader.result.split(',')[1];
          const activeId = vidScaleClient?.data?.inputParams?.peerId || 'unknown';
          try { vidScaleClient.sendAudioForTranscription(base64Audio, activeId); } catch (err) { console.warn('sendAudioForTranscription failed', err); }
        };
        reader.readAsDataURL(event.data);
      } catch (err) { console.warn('tx recorder ondataavailable error', err); }
    };
    rec.onerror = (err) => console.warn('tx recorder error', err);
    rec.start(1000);
    txRecorder = rec;
  } catch (err) { console.warn('Failed to start tx recorder', err); }
}

function stopTxRecorder() {
  try { if (txRecorder && txRecorder.state !== 'inactive') txRecorder.stop(); } catch { }
  txRecorder = null;
}


function addTrackToTxMixer(peerId, audioTrack) {
  try {
    ensureTxGraph();
    if (!txAudioContext || !txDestination || !audioTrack) return;
    if (txSourceNodes.has(peerId)) return;
    const mediaStream = new MediaStream([audioTrack]);
    const source = new MediaStreamAudioSourceNode(txAudioContext, { mediaStream });
    const gain = txAudioContext.createGain();
    gain.gain.value = 0.2;
    source.connect(gain).connect(txDestination);
    txSourceNodes.set(peerId, source);
    txGainNodes.set(peerId, gain);
    startTxRecorder();
  } catch (e) { console.warn('addTrackToTxMixer failed', e); }
}

function removeTrackFromTxMixer(peerId) {
  try {
    const source = txSourceNodes.get(peerId);
    const gain = txGainNodes.get(peerId);
    try { gain && gain.disconnect(); } catch { }
    try { source && source.disconnect(); } catch { }
    txSourceNodes.delete(peerId);
    txGainNodes.delete(peerId);
  } catch { }
}

const urlParams = new URLSearchParams(window.location.search);

const inputParams = {
  videoResolution: urlParams.get("videoResolution") || "hd",
  produce: urlParams.get("produce") !== "false",
  produceAudio: urlParams.get("produceAudio") !== "false",
  produceVideo: urlParams.get("produceVideo") !== "false",
  forcePCMU: urlParams.get("forcePCMU") === "true",
  forceH264: urlParams.get("forceH264") === "true",
  h264Profile: urlParams.get("h264Profile") === "low" ? "low" : "high",
  forceFPS:
    !isNaN(Number(urlParams.get("forceFPS"))) &&
      Number(urlParams.get("forceFPS")) > 0 &&
      Number(urlParams.get("forceFPS")) <= 60
      ? Number(urlParams.get("forceFPS"))
      : 30,
  enableWebcamLayers: urlParams.get("enableWebcamLayers") !== "false",
  numSimulcastStreams:
    !isNaN(Number(urlParams.get("numSimulcastStreams"))) &&
      Number(urlParams.get("numSimulcastStreams")) > 0 &&
      Number(urlParams.get("numSimulcastStreams")) <= 3
      ? Number(urlParams.get("numSimulcastStreams"))
      : 3,
  videoBitRates: [
    !isNaN(Number(urlParams.get("videoBitRateHigh"))) &&
      Number(urlParams.get("videoBitRateHigh")) > 50 &&
      Number(urlParams.get("videoBitRateHigh")) <= 1000
      ? Number(urlParams.get("videoBitRateHigh"))
      : 500,
    !isNaN(Number(urlParams.get("videoBitRateMedium"))) &&
      Number(urlParams.get("videoBitRateMedium")) > 30 &&
      Number(urlParams.get("videoBitRateMedium")) <= 300
      ? Number(urlParams.get("videoBitRateMedium"))
      : 250,
    !isNaN(Number(urlParams.get("videoBitRateLow"))) &&
      Number(urlParams.get("videoBitRateLow")) > 10 &&
      Number(urlParams.get("videoBitRateLow")) <= 125
      ? Number(urlParams.get("videoBitRateLow"))
      : 100,
  ],
  autoGainControl: urlParams.get("autoGainControl") !== "false",
  echoCancellation: urlParams.get("echoCancellation") !== "false",
  noiseSuppression: urlParams.get("noiseSuppression") !== "false",
  sampleRate:
    !isNaN(Number(urlParams.get("sampleRate"))) &&
      Number(urlParams.get("sampleRate")) >= 8000 &&
      Number(urlParams.get("sampleRate")) <= 64000
      ? Number(urlParams.get("sampleRate"))
      : 44000,
  channelCount:
    !isNaN(Number(urlParams.get("channelCount"))) &&
      Number(urlParams.get("channelCount")) >= 1 &&
      Number(urlParams.get("channelCount")) <= 8
      ? Number(urlParams.get("channelCount"))
      : 1,
  msRegion: "us", // Default region
  backgroundImage: "", // Placeholder for image link
  authenticationRequired: urlParams.get("auth") === "true",
  peerType: urlParams.get("role") === "moderator" ? "moderator" : "participant", // Read from ?role=moderator or ?role=participant
  password: urlParams.get("password"),
};

console.log("input params", inputParams);

const getAllDevices = async () => {
  const vidScaleClient = await samvyo.JsSdk;
  const availableDevices = await vidScaleClient.listDevices();
  if (availableDevices.success) {
    const audioDevices = availableDevices.deviceList.audioDevices;
    const videoDevices = availableDevices.deviceList.videoDevices;
    populateDeviceSelects(audioDevices, videoDevices);
  }
  console.log(availableDevices);
};

const populateDeviceSelects = (audioDevices, videoDevices) => {
  const audioSelect = document.getElementById("audioInput");
  const videoSelect = document.getElementById("videoInput");

  audioSelect.innerHTML = "";
  videoSelect.innerHTML = "";

  if (audioDevices.length > 0) {
    audioDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label;
      audioSelect.appendChild(option);
    });
    audioSelect.selectedIndex = 0;
    selectedAudioDeviceId = audioDevices[0].deviceId;
  } else {
    const noAudioOption = document.createElement("option");
    noAudioOption.value = "";
    noAudioOption.textContent = "No Audio Devices Available";
    audioSelect.appendChild(noAudioOption);
  }

  if (videoDevices.length > 0) {
    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label;
      videoSelect.appendChild(option);
    });

    videoSelect.selectedIndex = 0;
    selectedVideoDeviceId = videoDevices[0].deviceId;
  } else {
    const noVideoOption = document.createElement("option");
    noVideoOption.value = "";
    noVideoOption.textContent = "No Video Devices Available";
    videoSelect.appendChild(noVideoOption);
  }

  audioSelect.addEventListener("change", async (event) => {
    selectedAudioDeviceId = event.target.value;
    console.log("Selected Audio Device ID:", selectedAudioDeviceId);
    // If a call is active, switch the input immediately
    if (vidScaleClient && vidScaleClient.changeAudioInput) {
      await vidScaleClient.changeAudioInput({ deviceId: selectedAudioDeviceId });
    }
  });

  videoSelect.addEventListener("change", async (event) => {
    selectedVideoDeviceId = event.target.value;
    console.log("Selected Video Device ID:", selectedVideoDeviceId);
    // If a call is active, switch the input immediately
    if (vidScaleClient && vidScaleClient.changeVideoInput) {
      await vidScaleClient.changeVideoInput({ deviceId: selectedVideoDeviceId });
    }
  });
};

getAllDevices();



document
  .getElementById("initButton")
  .addEventListener("click", async (event) => {
    event.preventDefault();

    const loader = document.getElementById("joiningLoader");
    loader.classList.remove("hidden");
    // Disable join button
    const joinBtn = document.getElementById("initButton");
    joinBtn.textContent = "Joining...";
    joinBtn.disabled = true;

    const roomId = document.getElementById("roomId").value;
    const peerName = document.getElementById("peerName").value;

    if (!roomId) {
      alert("Please provide RoomId to join.");
      return;
    }
    if (!peerName) {
      alert("Enter your name");
      return;
    }

    // Fetch session token
    let sessionToken;

    try {
      const response = await fetch("/api/create-session-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId }),
      });

      console.log("fething session token", response);

      const data = await response.json();
      sessionToken = data.sessionToken;
    } catch (error) {
      console.log("Error while verifying session", error);
    }

    if (sessionToken) {
      const initialParams = {
        sessionToken,
        roomId,
        peerName,
      };


      try {
        vidScaleClient = await samvyo.JsSdk.init(initialParams);
        console.log("Successfully inistialised the room:", vidScaleClient);

        vidScaleClient.on("initSuccess", async () => {

          const peerName = document.getElementById("peerName").value;


          const moderatorCheckbox = document.getElementById("moderatorCheckbox");
          if (moderatorCheckbox && moderatorCheckbox.checked) {
            inputParams.peerType = "moderator";
          }

          const joinParams = {
            peerName,
            produce: true,
            consume: true,
            audioDeviceId: selectedAudioDeviceId,
            videoDeviceId: selectedVideoDeviceId,
            ...inputParams,
          };
          console.log("Auto-joining with params:", joinParams);
          try {
            await vidScaleClient.joinRoom(joinParams);

            removeAllPeers(); // Clear any stale peer tiles from a previous session
            document.getElementById("lobby-page").classList.add("hidden");
            document.getElementById("call-page").classList.remove("hidden");
            document.getElementById("call-page").classList.add("flex");
            resetControls();
            const displayRoomId = document.getElementById('call-room-id-display');
            if (displayRoomId) displayRoomId.textContent = roomId;
            document.getElementById("leaveButton").disabled = false;
            if (inputParams.peerType === "moderator") {
              document.getElementById("closeButton").disabled = false;
              document.getElementById("closeButton").classList.remove("hidden");
            }
          } catch (joinErr) {
            console.error("Error auto-joining room:", joinErr);
          }
        });

        // Set up event listeners
        vidScaleClient.on("newPeer", ({ peerId, peerName, type }) => {
          console.log(`New peer joined: ${peerName} (ID: ${peerId})`);
          addPeer(peerId, peerName, type);
        });

        // vidScaleClient.on("videoStart", ({ peerId, videoTrack, type }) => {
        //   console.log(`Video started for peer: ${peerId}`);
        //   updatePeerVideo(peerId, videoTrack, type);
        // });

        // vidScaleClient.on("videoEnd", ({ peerId, type }) => {
        //   console.log(`Video ended for peer: ${peerId}`);
        //   removePeerVideo(peerId, type);
        // });

        vidScaleClient.on("deviceListUpdated", () => {
          console.log("Device list updated");
          getAllDevices();
        });

        vidScaleClient.on("joinSuccess", () => {
          try {
            const container = document.getElementById("captionsContainer");
            if (container) container.style.display = "block";
          } catch { }
          try { vidScaleClient.setCaptionPreference && vidScaleClient.setCaptionPreference(true); } catch { }
          try { vidScaleClient.startTranscription && vidScaleClient.startTranscription(); } catch (e) { console.warn("startTranscription not available", e); }
        });

        vidScaleClient.on("micStart", ({ peerId, audioTrack, type }) => {
          console.log(`Mic started for peer: ${peerId}`);
          updatePeerAudio(peerId, audioTrack, type);
          if (type === "remote")
            document.getElementById("additional").style.display = "none";
          try { if (audioTrack) addTrackToTxMixer(peerId, audioTrack); } catch { }
        });

        vidScaleClient.on("micEnd", ({ peerId }) => {
          console.log(`Mic ended for peer: ${peerId}`);
          removePeerAudio(peerId);
          try { removeTrackFromTxMixer(peerId); } catch { }
        });

        vidScaleClient.on("peerMuted", ({ peerId, type }) => {
          console.log(`Peer muted: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer && type === "remote") {
            if (peer.muteStatusMessage) peer.muteStatusMessage.classList.remove('hidden');
          }
        });

        vidScaleClient.on("peerUnMuted", ({ peerId, type }) => {
          console.log(`Peer unmuted: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer && type === "remote") {
            if (peer.muteStatusMessage) peer.muteStatusMessage.classList.add('hidden');
          }
        });

        vidScaleClient.on("videoStart", ({ peerId, videoTrack, type }) => {
          console.log(`Video started for peer: ${peerId}`);

          updatePeerVideo(peerId, videoTrack, type);
          const peer = peers.get(peerId);
          if (peer) {
            if (peer.camStatusMessage) peer.camStatusMessage.classList.add('hidden');
          }

          // Only when local camera starts
          if (type === "local") {

            // Hide loader
            document.getElementById("joiningLoader").classList.add("hidden");

            // Switch UI
            document.getElementById("lobby-page").classList.add("hidden");
            document.getElementById("call-page").classList.remove("hidden");
            document.getElementById("call-page").classList.add("flex");

            resetControls();

            document.getElementById("leaveButton").disabled = false;

            const displayRoomId = document.getElementById("call-room-id-display");
            if (displayRoomId) displayRoomId.textContent =
              document.getElementById("roomId").value;

            const joinBtn = document.getElementById("initButton");
            joinBtn.textContent = "Join Room";
            joinBtn.disabled = false;
          }
        });

        vidScaleClient.on("videoEnd", ({ peerId, type }) => {
          console.log(`Video ended for peer: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer) {
            if (peer.camStatusMessage) peer.camStatusMessage.classList.remove('hidden');
          }
          removePeerVideo(peerId, type);
        });

        vidScaleClient.on("peerLeft", ({ peerId }) => {
          console.log(`Peer left: ${peerId}`);
          removePeer(peerId);
        });

        vidScaleClient.on("ssVideoStart", ({ peerId, videoTrack, type }) => {
          console.log("received ss video start");
          addSSVideo(peerId, videoTrack, type);
        });

        vidScaleClient.on("ssVideoStop", ({ peerId, videoTrack, type }) => {
          console.log("received ss video stop");
          removeSSVideo(peerId, videoTrack, type);
        });

        vidScaleClient.on(
          "moderatorAuthentication",
          ({ moderatorName, requesterName, requesterPeerId, text }) => {
            console.log("received moderator authentication message");
            showModAuth({ requesterName, requesterPeerId, text });
          }
        );

        vidScaleClient.on(
          "authenticationRequested",
          ({ moderatorName, requesterName, requesterPeerId, text }) => {
            console.log("Moderator authentication required to join room");
            showAuthNotification({ requesterName, requesterPeerId, text });
          }
        );

        vidScaleClient.on("error", ({ code, text }) => {
          console.error("Error code:", code, "Error text:", text);
        });

        vidScaleClient.on("notification", ({ eventType, eventText }) => {
          console.error("Error type:", eventType, "Error text:", eventText);
          alert(`${eventType}: ${eventText}`);
        });

        vidScaleClient.on("roomClosed", ({ roomId }) => {
          resetControls();
          removeAllPeers();
          showThankYouMessage();
          // Go back to lobby
          document.getElementById("call-page").classList.add("hidden");
          document.getElementById("call-page").classList.remove("flex");
          document.getElementById("lobby-page").classList.remove("hidden");
          document.getElementById("leaveButton").disabled = true;
          document.getElementById("closeButton").disabled = true;
          document.getElementById("closeButton").classList.add("hidden");
          alert("room closed by moderator!");
          clearCaptions();
          try { stopTxRecorder(); } catch { }
          try { txSourceNodes.clear(); txGainNodes.clear(); } catch { }
        });


        vidScaleClient.on("Message", async (message) => {
          try {
            console.log("customMessage", message);
            // Expecting message.type === 'transcription' and message.messageType === 'deepgram:transcript'
            if (message?.type === "transcription" && message?.messageType === "deepgram:transcript") {
              let payload = message?.data;
              if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch { /* ignore */ }
              }
              const text = payload?.transcript || payload?.text;
              const isFinal = !!(payload?.is_final || payload?.isFinal);
              const speakerId = payload?.speaker || message.from;
              if (text && speakerId) {
                upsertCaption(speakerId, text, isFinal);
              }
            }
          } catch (err) {
            console.warn("customMessage captions handler error", err);
          }
        });
        // Init done — auto-join fires via initSuccess above
      } catch (error) {
        console.error("Error joining room:", error);
      }
    } else {
      alert("Failed to fetch session token.");
    }
  });
// joinButton removed — joining handled automatically inside initSuccess
document.getElementById("leaveButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.leaveRoom();
    resetControls();
    const screenShareList = document.getElementById("screenShareList");
    screenShareList.innerHTML = "";
    screenShares.clear();


    // UI Page Toggle back to lobby
    document.getElementById("call-page").classList.add("hidden");
    document.getElementById("call-page").classList.remove("flex");
    document.getElementById("lobby-page").classList.remove("hidden");

    document.getElementById("leaveButton").disabled = true;
    document.getElementById("closeButton").disabled = true;
    document.getElementById("joinButton").disabled = false;
    removeAllPeers(); //removes the peerList div upon leaving the room
    showThankYouMessage();
    clearCaptions();
    try { stopTxRecorder(); } catch { } tu
    try { txSourceNodes.clear(); txGainNodes.clear(); } catch { }
  }
});
document.getElementById("closeButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.closeRoom();
    resetControls();

    // UI Page Toggle back to lobby
    document.getElementById("call-page").classList.add("hidden");
    document.getElementById("call-page").classList.remove("flex");
    document.getElementById("lobby-page").classList.remove("hidden");

    document.getElementById("leaveButton").disabled = true;
    document.getElementById("closeButton").disabled = true;
    document.getElementById("closeButton").classList.add("hidden");
    // document.getElementById("recordingStartButton").disabled = true;
    // document.getElementById("recordingStopButton").disabled = true;
    document.getElementById("joinButton").disabled = false;
    removeAllPeers(); //removes the peerList div upon leaving the room
    showThankYouMessage();
    clearCaptions();
    try { stopTxRecorder(); } catch { }
    try { txSourceNodes.clear(); txGainNodes.clear(); } catch { }
  }
});

// document
//   .getElementById("recordingStartButton")
//   .addEventListener("click", async () => {
//     if (vidScaleClient) {
//       await vidScaleClient.startRecording({
//         recordingType: "av"
//       });
//       console.log("Recording started");
//       document.getElementById("recordingStartButton").disabled = true;
//       document.getElementById("recordingStopButton").disabled = false;
//     }
//   });

// document
//   .getElementById("recordingStopButton")
//   .addEventListener("click", async () => {
//     if (vidScaleClient) {
//       await vidScaleClient.stopRecording();
//       console.log("Recording Ended");
//       document.getElementById("recordingStartButton").disabled = false;
//       document.getElementById("recordingStopButton").disabled = true;
//     }
//   });

// document.getElementById("processVideosButton").addEventListener("click", async () => {
//   if (vidScaleClient) {
//     await vidScaleClient.startProcessing({inputFiles:[{url:"https://cvr-org-823047296136-1.sgp1.digitaloceanspaces.com/videos/file_example_MP4_1920_18MG.mp4",type:"mp4"},{url:"https://cvr-org-823047296136-1.sgp1.digitaloceanspaces.com/videos/sample-30s.mp4",type:"mp4"}]});
//     console.log("Processing Videos Started");
//     document.getElementById("processVideosButton").disabled = true;
//   }
// });

function showModAuth({ requesterName, requesterPeerId, text }) {
  const div = document.getElementById("additional");
  var span = document.createElement("span");
  span.innerHTML = text;
  div.appendChild(span);
  const button1 = document.createElement("button");
  button1.innerHTML = "Allow";
  button1.onclick = () => {
    vidScaleClient.allowRoomJoin(requesterPeerId);
    div.style.display = "none";
  };
  div.appendChild(button1);
  const button2 = document.createElement("button");
  button2.innerHTML = "Deny";
  button2.onclick = () => {
    vidScaleClient.denyRoomJoin(requesterPeerId);
    div.style.display = "none";
  };
  div.appendChild(button2);
}

function showAuthNotification({ requesterName, requesterPeerId, text }) {
  const div = document.getElementById("additional");
  var span = document.createElement("span");
  span.innerHTML = text;
  div.appendChild(span);
}

function addSSVideo(peerId, videoTrack, type) {
  if (typeof screenShares === "undefined") {
    console.error("screenShares is not defined.");
    return;
  }

  if (!screenShares.has(peerId)) {
    const ssCard = document.createElement("div");
    ssCard.className = "ss-card";
    ssCard.id = `ss-${peerId}`;

    const ssVideo = document.createElement("video");

    if (videoTrack) {
      const videoStream = new MediaStream();
      videoStream.addTrack(videoTrack);
      ssVideo.srcObject = videoStream;

      ssVideo
        .play()
        .catch((error) =>
          console.warn(
            `Error playing screen share video for peer ${peerId}:`,
            error
          )
        );

      ssVideo.autoplay = true;
      ssVideo.playsInline = true;

      ssCard.appendChild(ssVideo);

      document.getElementById("screenShareList").appendChild(ssCard);
      screenShares.set(peerId, ssCard); // Store the card in screenShares map
    } else {
      console.error(`Invalid video track for peer ${peerId}`);
    }
  } else {
    console.warn(`Screen share already exists for peer ${peerId}`);
  }
}

function removeSSVideo(peerId, videoTrack, type) {
  const ssCard = document.getElementById(`ss-${peerId}`);
  if (ssCard) {
    ssCard.remove();
  }
  screenShares.delete(peerId);
}

function resetControls() {
  // Mic
  const micBtn = document.getElementById("mute-button");
  if (micBtn) {
    micBtn.querySelector("span").textContent = "mic";
    micBtn.classList.remove("bg-meetRed", "hover:bg-red-600");
    micBtn.classList.add("bg-gray-700", "hover:bg-gray-600");
  }

  // Camera
  const camBtn = document.getElementById("cam-toggle-button");
  if (camBtn) {
    camBtn.querySelector("span").textContent = "videocam";
    camBtn.classList.remove("bg-meetRed", "hover:bg-red-600");
    camBtn.classList.add("bg-gray-700", "hover:bg-gray-600");
  }

  // Screen Share
  const shareBtn = document.getElementById("share-screen-button");
  if (shareBtn) {
    shareBtn.querySelector("span").textContent = "present_to_all";
    shareBtn.classList.remove("bg-meetBlue", "hover:bg-blue-400", "text-gray-900");
    shareBtn.classList.add("bg-gray-700", "hover:bg-gray-600");
  }
}
function addPeer(peerId, peerName, type) {
  if (!peers.has(peerId)) {
    const peerCard = document.createElement("div");
    peerCard.className = "peer-card group relative";
    peerCard.id = `peer-${peerId}`;

    const peerNameElement = document.createElement("div");
    peerNameElement.className = "peer-name-badge";
    peerNameElement.textContent = peerName;

    const peerVideo = document.createElement("video");
    peerVideo.autoplay = true;
    peerVideo.playsInline = true;

    const peerAudio = document.createElement("audio");
    peerAudio.autoplay = true;

    const muteStatusMessage = document.createElement("div");
    muteStatusMessage.className = "mute-indicator hidden"; // Initially hide
    muteStatusMessage.innerHTML = `<span class="material-symbols-outlined">mic_off</span>`;

    const camStatusMessage = document.createElement("div");
    camStatusMessage.className = "absolute inset-0 flex items-center justify-center bg-dark/80 rounded-[0.75rem] z-20 hidden";
    camStatusMessage.innerHTML = `
        <div class="flex flex-col items-center gap-3">
            <div class="w-16 h-16 bg-meetGray rounded-full flex items-center justify-center">
                <span class="material-symbols-outlined text-[40px] text-gray-400">videocam_off</span>
            </div>
            <p class="text-sm font-medium text-gray-400">${peerName}'s camera is off</p>
        </div>
    `;

    peerCard.appendChild(peerVideo);
    peerCard.appendChild(camStatusMessage);
    peerCard.appendChild(peerAudio);
    peerCard.appendChild(peerNameElement);
    if (muteStatusMessage) peerCard.appendChild(muteStatusMessage);

    if (type === "local") {
      const localControls = document.getElementById('local-controls-container');

      // Ensure we only append these once or cleanly recreate them
      let peerMuteButton = document.getElementById('mute-button');
      if (!peerMuteButton) {
        peerMuteButton = document.createElement("button");
        peerMuteButton.className = "bg-gray-700 hover:bg-gray-600 text-white rounded-full w-12 h-12 flex items-center justify-center transition-colors";
        peerMuteButton.innerHTML = `<span class="material-symbols-outlined text-[24px]">mic</span>`;
        peerMuteButton.id = "mute-button";
        peerMuteButton.title = "Toggle Microphone";
        // Insert before leave button
        localControls.insertBefore(peerMuteButton, document.getElementById('leaveButton'));


        const camToggleButton = document.createElement("button");
        camToggleButton.className = "bg-gray-700 hover:bg-gray-600 text-white rounded-full w-12 h-12 flex items-center justify-center transition-colors";
        camToggleButton.innerHTML = `<span class="material-symbols-outlined text-[24px]">videocam</span>`;
        camToggleButton.id = "cam-toggle-button";
        camToggleButton.title = "Toggle Camera";
        localControls.insertBefore(camToggleButton, document.getElementById('leaveButton'));

        const shareScreenButton = document.createElement("button");
        shareScreenButton.className = "bg-gray-700 hover:bg-gray-600 text-white rounded-full w-12 h-12 flex items-center justify-center transition-colors";
        shareScreenButton.innerHTML = `<span class="material-symbols-outlined text-[24px]">present_to_all</span>`;
        shareScreenButton.id = "share-screen-button";
        shareScreenButton.title = "Present Screen";
        localControls.insertBefore(shareScreenButton, document.getElementById('leaveButton'));

        // Event Listeners
        peerMuteButton.addEventListener("click", async () => {
          const icon = peerMuteButton.querySelector('span');
          if (icon.textContent === "mic_off") {
            await vidScaleClient.unmuteMic();
            icon.textContent = "mic";
            peerMuteButton.classList.remove('bg-meetRed', 'hover:bg-red-600');
            peerMuteButton.classList.add('bg-gray-700', 'hover:bg-gray-600');
          } else {
            await vidScaleClient.muteMic();
            icon.textContent = "mic_off";
            peerMuteButton.classList.remove('bg-gray-700', 'hover:bg-gray-600');
            peerMuteButton.classList.add('bg-meetRed', 'hover:bg-red-600');
          }
        });

        shareScreenButton.addEventListener("click", async () => {
          const icon = shareScreenButton.querySelector('span');
          if (icon.textContent === "present_to_all") {
            await vidScaleClient.enableShare();
            icon.textContent = "cancel_presentation";
            shareScreenButton.classList.remove('bg-gray-700', 'hover:bg-gray-600');
            shareScreenButton.classList.add('bg-meetBlue', 'hover:bg-blue-400', 'text-gray-900');
          } else {
            await vidScaleClient.disableShare();
            icon.textContent = "present_to_all";
            shareScreenButton.classList.remove('bg-meetBlue', 'hover:bg-blue-400', 'text-gray-900');
            shareScreenButton.classList.add('bg-gray-700', 'hover:bg-gray-600');
          }
        });

        camToggleButton.addEventListener("click", async () => {
          const icon = camToggleButton.querySelector('span');
          const peer = peers.get(peerId);
          if (icon.textContent === "videocam_off") {
            await vidScaleClient.enableCam({ deviceId: selectedVideoDeviceId });
            icon.textContent = "videocam";
            camToggleButton.classList.remove('bg-meetRed', 'hover:bg-red-600');
            camToggleButton.classList.add('bg-gray-700', 'hover:bg-gray-600');
            if (peer && peer.camStatusMessage) peer.camStatusMessage.classList.add('hidden');
          } else {
            await vidScaleClient.disableCam();
            icon.textContent = "videocam_off";
            camToggleButton.classList.remove('bg-gray-700', 'hover:bg-gray-600');
            camToggleButton.classList.add('bg-meetRed', 'hover:bg-red-600');
            if (peer && peer.camStatusMessage) peer.camStatusMessage.classList.remove('hidden');
          }
        });
      }
    }


    document.getElementById("peerList").appendChild(peerCard);
    peers.set(peerId, {
      peerName,
      videoElement: peerVideo,
      audioElement: peerAudio,
      muted: false,
      cameraOn: true,
      muteStatusMessage,
      camStatusMessage,
    });
  }
}

function updatePeerVideo(peerId, videoTrack, type) {
  const peer = peers.get(peerId);
  if (peer) {
    const videoStream = new MediaStream();
    videoStream.addTrack(videoTrack);
    peer.videoElement.srcObject = videoStream;
    peer.videoElement
      .play()
      .catch((error) =>
        console.warn(`Error playing video for peer ${peerId}:`, error)
      );
  }
}

function removePeerVideo(peerId, type) {
  const peer = peers.get(peerId);
  if (peer) {
    peer.videoElement.srcObject = null;
  }
}

function updatePeerAudio(peerId, audioTrack, type) {
  const peer = peers.get(peerId);
  if (peer && type === "remote") {
    const audioStream = new MediaStream();
    audioStream.addTrack(audioTrack);
    peer.audioElement.srcObject = audioStream;
    peer.audioElement
      .play()
      .catch((error) =>
        console.warn(`Error playing video for peer ${peerId}:`, error)
      );
  }
}

function removePeerAudio(peerId) {
  const peer = peers.get(peerId);
  if (peer) {
    console.log(`Removing audio for peer: ${peerId}`);
    peer.audioElement.srcObject = null;
  }
}

function removePeer(peerId) {
  const peerCard = document.getElementById(`peer-${peerId}`);
  if (peerCard) {
    peerCard.remove();
  }
  peers.delete(peerId);
}

function removeAllPeers() {
  const peerList = document.getElementById("peerList");

  while (peerList.firstChild) {
    peerList.removeChild(peerList.firstChild);
  }

  peers.clear();
}

function showThankYouMessage() {
  const thankYouMessage = document.createElement("div");
  thankYouMessage.textContent = "Thanks for trying our demo";

  document.body.appendChild(thankYouMessage);

  setTimeout(() => {
    thankYouMessage.remove();
  }, 5000);
}

// ===== Closed Captions (Transcription) UI helpers =====
function getParticipantName(peerId) {
  const p = peers.get(peerId);
  return p?.peerName || (peerId === vidScaleClient?.data?.inputParams?.peerId ? "You" : peerId);
}

function renderCaptions() {
  try {
    const feed = document.getElementById("captionsFeed");
    if (!feed) return;
    feed.innerHTML = "";
    captionsChat.forEach((m) => {
      const row = document.createElement("div");
      row.style.whiteSpace = "pre-wrap";
      row.style.opacity = m.pending ? 0.85 : 1;
      row.textContent = `${getParticipantName(m.peerId)}: ${m.text}`;
      feed.appendChild(row);
    });
    // Auto scroll to bottom
    feed.scrollTop = feed.scrollHeight;
  } catch { }
}

function upsertCaption(peerId, text, isFinal) {
  const ts = Date.now();
  captionsByPeer.set(peerId, { text, ts, isFinal: !!isFinal });

  // Update chat feed with pending/final rows
  const lastIdx = [...captionsChat].reverse().findIndex(m => m.peerId === peerId && m.pending === true);
  const idx = lastIdx >= 0 ? captionsChat.length - 1 - lastIdx : -1;
  if (!isFinal) {
    if (idx >= 0) {
      captionsChat[idx] = { ...captionsChat[idx], text, ts };
    } else {
      captionsChat.push({ id: `${peerId}-${ts}`, peerId, text, ts, pending: true });
    }
  } else {
    if (idx >= 0) {
      captionsChat[idx] = { ...captionsChat[idx], text, ts, pending: false };
    } else {
      captionsChat.push({ id: `${peerId}-${ts}`, peerId, text, ts, pending: false });
    }
  }
  if (captionsChat.length > MAX_CAPTIONS) {
    captionsChat = captionsChat.slice(captionsChat.length - MAX_CAPTIONS);
  }
  renderCaptions();
}

function clearCaptions() {
  try {
    captionsByPeer.clear();
    captionsChat = [];
    const feed = document.getElementById("captionsFeed");
    if (feed) feed.innerHTML = "";
    const container = document.getElementById("captionsContainer");
    if (container) container.style.display = "none";
  } catch { }
}
//settings Toggle
const settingsBtn = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsDropdown");
const settingsCloseBtn = document.getElementById("closeSettingsBtn");

if (settingsBtn && settingsPanel) {
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle("hidden");
  });
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // prevents outside click conflict
      settingsPanel.classList.add("hidden");
    });
  }

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsPanel.classList.add("hidden");
    }
  });
}

