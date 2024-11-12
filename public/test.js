let vidScaleClient = null;
let audioDevices = null;
let videoDevices = null;
const peers = new Map(); // Map to store peer details

// Variables to store selected device IDs
let selectedAudioDeviceId = null;
let selectedVideoDeviceId = null;

const getAllDevices = async () => {
    vidScaleClient = await VidScale.JsSdk; // Fixed variable declaration
    const availableDevices = await vidScaleClient.listDevices();

    if (availableDevices.success) {
        audioDevices = availableDevices.deviceList.audioDevices;
        videoDevices = availableDevices.deviceList.videoDevices;
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
        audioDevices.forEach((device) => {
            const option = document.createElement("option");
            option.value = device.deviceId;
            option.textContent = device.label || `Audio Device ${device.deviceId}`;
            audioSelect.appendChild(option);
        });
        audioSelect.selectedIndex = 0; // Select the first option by default
        selectedAudioDeviceId = audioDevices[0].deviceId; // Store the first device ID
    } else {
        const noAudioOption = document.createElement("option");
        noAudioOption.value = "";
        noAudioOption.textContent = "No Audio Devices Available";
        audioSelect.appendChild(noAudioOption);
    }

    if (videoDevices.length > 0) {
        videoDevices.forEach((device) => {
            const option = document.createElement("option");
            option.value = device.deviceId;
            option.textContent = device.label || `Video Device ${device.deviceId}`;
            videoSelect.appendChild(option);
        });
        videoSelect.selectedIndex = 0; // Select the first option by default
        selectedVideoDeviceId = videoDevices[0].deviceId; // Store the first device ID
    } else {
        const noVideoOption = document.createElement("option");
        noVideoOption.value = "";
        noVideoOption.textContent = "No Video Devices Available";
        videoSelect.appendChild(noVideoOption);
    }

    // Add event listeners to update selected device IDs
    audioSelect.addEventListener('change', (event) => {
        selectedAudioDeviceId = event.target.value;
        console.log('Selected Audio Device ID:', selectedAudioDeviceId);
    });

    videoSelect.addEventListener('change', (event) => {
        selectedVideoDeviceId = event.target.value;
        console.log('Selected Video Device ID:', selectedVideoDeviceId);
    });
};

// Call to get all devices on page load
getAllDevices();