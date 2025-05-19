let vidScaleClient = null;
let audioDevices = null;
let videoDevices = null;
const peers = new Map(); // Map to store peer details
let selectedAudioDeviceId = null;
let selectedVideoDeviceId = null;
const screenShares = new Map(); // Map to store screen share details

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
  authenticationRequired:urlParams.get("auth")!=="false",
  peerType:urlParams.get("peerType"),
  password:urlParams.get("password")
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
    await vidScaleClient.changeAudioInput({ deviceId: selectedAudioDeviceId });
  });

  videoSelect.addEventListener("change", async (event) => {
    selectedVideoDeviceId = event.target.value;
    console.log("Selected Video Device ID:", selectedVideoDeviceId);
    await vidScaleClient.changeVideoInput({ deviceId: selectedVideoDeviceId });
  });
};

getAllDevices();

document
  .getElementById("joinButton")
  .addEventListener("click", async (event) => {
    event.preventDefault();

    const roomId = document.getElementById("roomId").value;
    const peerName = document.getElementById("peerName").value;

    if (!roomId) {
      alert("Please provide RoomId to join.");
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
      const params = {
        sessionToken,
        roomId,
        peerName,
        produce: true,
        consume: true,
        // share: true,  true if one wants to join call with screen share on by default
        // produceAudio: false,  both should be set false to join the call without audio or video
        // produceVideo: false,
        audioDeviceId: selectedAudioDeviceId,
        videoDeviceId: selectedVideoDeviceId,
        ...inputParams,
      };

      try {
        vidScaleClient = await samvyo.JsSdk.joinRoom(params);
        console.log("Successfully joined the room:", vidScaleClient);

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

        vidScaleClient.on("micStart", ({ peerId, audioTrack, type }) => {
          console.log(`Mic started for peer: ${peerId}`);
          updatePeerAudio(peerId, audioTrack, type);
          if(type==="remote")
          document.getElementById("additional").style.display="none";
        });

        vidScaleClient.on("micEnd", ({ peerId }) => {
          console.log(`Mic ended for peer: ${peerId}`);
          removePeerAudio(peerId);
        });

        vidScaleClient.on("peerMuted", ({ peerId, type }) => {
          console.log(`Peer muted: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer && type === "remote") {
            peer.muteStatusMessage.textContent = "Muted";
            peer.muteStatusMessage.style.display = "block"; // Show the message
          }
        });

        vidScaleClient.on("peerUnMuted", ({ peerId, type }) => {
          console.log(`Peer unmuted: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer && type === "remote") {
            peer.muteStatusMessage.textContent = "Unmuted";
            peer.muteStatusMessage.style.display = "block"; // Show the message
          }
        });

        vidScaleClient.on("videoStart", ({ peerId, videoTrack, type }) => {
          console.log(`Video started for peer: ${peerId}`);
          updatePeerVideo(peerId, videoTrack, type);
          const peer = peers.get(peerId);
          if (peer && type === "remote") {
            peer.camStatusMessage.textContent = "Camera turned on"; // Update status message
            peer.camStatusMessage.style.display = "block"; // Show the message
          }
        });

        vidScaleClient.on("videoEnd", ({ peerId, type }) => {
          console.log(`Video ended for peer: ${peerId}`);
          const peer = peers.get(peerId);
          if (peer) {
            peer.camStatusMessage.textContent = "Camera turned off"; // Update status message
            peer.camStatusMessage.style.display = "block"; // Show the message
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

        vidScaleClient.on("moderatorAuthentication", ({ moderatorName, requesterName,requesterPeerId, text }) => {
          console.log("received moderator authentication message");
          showModAuth({requesterName,requesterPeerId,text})
        });

        vidScaleClient.on("authenticationRequested", ({ moderatorName, requesterName,requesterPeerId, text }) => {
          console.log("Moderator authentication required to join room");
          showAuthNotification({requesterName,requesterPeerId,text})
        });

        vidScaleClient.on("error", ({ code, text }) => {
          console.error("Error code:", code, "Error text:", text);
        });

        vidScaleClient.on("notification", ({ eventType,eventText }) => {
          console.error("Error type:", eventType, "Error text:", eventText);
          alert(`${eventType}: ${eventText}`)
        });

        vidScaleClient.on("recordingStarted", ({peerId,startTime}) => {
          console.log(`Recording has been started in this room at ${startTime}`);
          alert(`Recording has been started on the room at: ${startTime}`);
          // The start time is provided as a unix timestamp value, please use a library like moment to convert it to a readable format like "HH:MM DD-MM-YYYY"
        });

        vidScaleClient.on("recordingEnded", () => {
          console.log(`Recording has been ended on this room at`);
          alert(`Recording has been ended on the room at`);
        });
         vidScaleClient.on("processingCompleted", (details) => {
          console.log(`Processing has been completed`,details);
          alert(`Processing has been completed on the room at`);
          document.getElementById("processVideosButton").disabled = false;
        });
        document.getElementById("leaveButton").disabled = false;
        document.getElementById("recordingStartButton").disabled = false;
        document.getElementById("recordingStopButton").disabled = false;
        document.getElementById("processVideosButton").disabled = false;
        document.getElementById("joinButton").disabled = true;

      } catch (error) {
        console.error("Error joining room:", error);
      }
    } else {
      alert("Failed to fetch session token.");
    }
  });

document.getElementById("leaveButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.leaveRoom();
    console.log("Left the room");
    document.getElementById("leaveButton").disabled = true;
    document.getElementById("recordingStartButton").disabled = true;
        document.getElementById("recordingStopButton").disabled = true;
        document.getElementById("processVideosButton").disabled = true;
    document.getElementById("joinButton").disabled = false;
    removeAllPeers(); //removes the peerList div upon leaving the room
    showThankYouMessage();
  }
});

document.getElementById("recordingStartButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.startRecording({recordingType:"av"});
    console.log("Recording started");
    // document.getElementById("leaveButton").disabled = true;
    document.getElementById("recordingStartButton").disabled = true;
        document.getElementById("recordingStopButton").disabled = false;
    // document.getElementById("joinButton").disabled = false;
    // removeAllPeers(); //removes the peerList div upon leaving the room
    // showThankYouMessage();
  }
});

document.getElementById("recordingStopButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.stopRecording();
    console.log("Recording Ended");
    // document.getElementById("leaveButton").disabled = true;
    document.getElementById("recordingStartButton").disabled = false;
        document.getElementById("recordingStopButton").disabled = true;
    // document.getElementById("joinButton").disabled = false;
    // removeAllPeers(); //removes the peerList div upon leaving the room
    // showThankYouMessage();
  }
});

document.getElementById("processVideosButton").addEventListener("click", async () => {
  if (vidScaleClient) {
    await vidScaleClient.startProcessing({inputFiles:[{url:"https://cvr-org-823047296136-1.sgp1.digitaloceanspaces.com/videos/room12345-13-5-2025-16-43-47/room12345-record-13-5-2025-16-44-30.mp4",type:"mp4"}],cloud:"do",region:"sgp1",bucket:"cvr-org-823047296136-1"});
    console.log("Processing Videos Started");
    // document.getElementById("leaveButton").disabled = true;
    document.getElementById("processVideosButton").disabled = true;
    // document.getElementById("joinButton").disabled = false;
    // removeAllPeers(); //removes the peerList div upon leaving the room
    // showThankYouMessage();
  }
});

function showModAuth({requesterName,requesterPeerId,text}){
  const div = document.getElementById("additional");
  var span = document.createElement("span");
  span.innerHTML=text;
  div.appendChild(span);
  const button1 = document.createElement("button");
  button1.innerHTML="Allow"
  button1.onclick = ()=>{
    vidScaleClient.allowRoomJoin(requesterPeerId);
    div.style.display="none";
  };
  div.appendChild(button1);
  const button2 = document.createElement("button");
  button2.innerHTML="Deny"
  button2.onclick = ()=>{
    vidScaleClient.denyRoomJoin(requesterPeerId);
    div.style.display="none";
  }
  div.appendChild(button2);
  
}

function showAuthNotification({requesterName,requesterPeerId,text}){
  const div = document.getElementById("additional");
  var span = document.createElement("span");
  span.innerHTML=text;
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

function addPeer(peerId, peerName, type) {
  if (!peers.has(peerId)) {
    const peerCard = document.createElement("div");
    peerCard.className = "peer-card";
    peerCard.id = `peer-${peerId}`;

    const peerNameElement = document.createElement("div");
    peerNameElement.textContent = peerName;

    const peerVideo = document.createElement("video");
    peerVideo.autoplay = true;
    peerVideo.playsInline = true;

    const peerAudio = document.createElement("audio");
    peerAudio.autoplay = true;
    // peerAudio.playsInline = true;

    const muteStatusMessage =
      type === "remote" ? document.createElement("div") : null;
    if (muteStatusMessage) {
      muteStatusMessage.className = "mute-status";
      muteStatusMessage.style.display = "none";
    }

    const camStatusMessage =
      type === "remote" ? document.createElement("div") : null;
    if (camStatusMessage) {
      camStatusMessage.className = "cam-status";
      camStatusMessage.style.display = "none";
    }

    peerCard.appendChild(peerNameElement);
    peerCard.appendChild(peerVideo);
    peerCard.appendChild(peerAudio);
    if (muteStatusMessage) peerCard.appendChild(muteStatusMessage);
    if (camStatusMessage) peerCard.appendChild(camStatusMessage);

    const peerMedia = document.createElement("div");
    peerMedia.className = "peer-media";

    if (type === "local") {
      const peerMuteButton = document.createElement("button");
      // peerMuteButton.textContent = "Turn on mic";
      peerMuteButton.textContent = "mute mic";
      peerMuteButton.id = "mute-button";

      const camToggleButton = document.createElement("button");
      // camToggleButton.textContent = "Switch Camera On";
      camToggleButton.textContent = "camera off";
      camToggleButton.id = "cam-toggle-button";

      const shareScreenButton = document.createElement("button");
      shareScreenButton.textContent = "share screen";
      shareScreenButton.id = "share-screen-button";

      peerMedia.appendChild(peerMuteButton);
      peerMedia.appendChild(camToggleButton);
      peerMedia.appendChild(shareScreenButton);
      peerCard.appendChild(peerMedia);

      peerMuteButton.addEventListener("click", async () => {
        if (peerMuteButton.textContent === "unmute mic") {
          await vidScaleClient.unmuteMic();
          peerMuteButton.textContent = "mute";
        } else {
          await vidScaleClient.muteMic();
          peerMuteButton.textContent = "unmute mic";
        }
        // if (peerMuteButton.textContent === "Mute") {
        //   await vidScaleClient.enableMic();
        //   peerMuteButton.textContent = "Turn on MIc";
        // } else {
        //   await vidScaleClient.disableMic();
        //   peerMuteButton.textContent = "Disable Mic";
        // }
      });

      shareScreenButton.addEventListener("click", async () => {
        console.log("share screen button clicked");
        if (shareScreenButton.textContent === "share screen") {
          await vidScaleClient.enableShare();
          shareScreenButton.textContent = "stop screen share";
        } else {
          console.log("Disable screen share clicked");
          await vidScaleClient.disableShare();
          shareScreenButton.textContent = "share screen";
        }
      });

      camToggleButton.addEventListener("click", async () => {
        if (camToggleButton.textContent === "camera off") {
          await vidScaleClient.disableCam();
          camToggleButton.textContent = "camera On";
        } else {
          await vidScaleClient.enableCam({ deviceId: selectedVideoDeviceId });
          camToggleButton.textContent = "camera off";
        }
        // if (camToggleButton.textContent === "Switch Camera Off") {
        //   await vidScaleClient.disableCam();
        //   camToggleButton.textContent = "Switch Camera On";
        // } else {
        //   await vidScaleClient.enableCam({ deviceId: selectedVideoDeviceId });
        //   camToggleButton.textContent = "Switch Camera Off";
        // }
      });
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
