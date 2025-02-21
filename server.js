const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const app = express();
const dotEnv = require("dotenv");
const https = require("https");
const fs = require("fs");

dotEnv.config();
app.use(cors());
app.use(express.json());

const accessKey = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
const serverUrl = "https://test-api-v2.videoedge.io";
// const serverUrl = "https://test-api.videoedge.io";
// const serverUrl = "https://10.50.93.54:3400";

app.use(express.static(path.join(__dirname, "public")));

const privateKey = fs.readFileSync(
  path.resolve(__dirname, "server.key"),
  "utf8"
);
const certificate = fs.readFileSync(
  path.resolve(__dirname, "server.crt"),
  "utf8"
);

const httpsServer = https.createServer(
  { key: privateKey, cert: certificate },
  app
);

app.post("/api/create-session-token", async (req, res) => {
  const { roomId } = req.body;
  try {
    const response = await axios.post(
      `${serverUrl}/api/siteSetting/sessionToken`,
      {
        accessKey,
        secretAccessKey,
        roomId,
      }
    );

    // console.log(response);
    if (response.data.success) {
      return res.status(200).send({
        message: "Session token fetched successfully",
        sessionToken: response.data.sessionToken,
      });
    }

    return res.status(400).send({
      message: "Failed to fetch session token",
    });
  } catch (error) {
    console.error("Error creating session token:", error);
    console.log("Error message", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const port = process.env.PORT || 3600;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

httpsServer.listen(port, () => {
  console.log(`Secure server running on port ${port}`);
});
