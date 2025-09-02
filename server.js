// Simple Echo WebSocket Server (CloudLink-like)
// Save as server.js
// Run: npm init -y && npm i ws && node server.js

const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 3000;

// Khởi tạo WebSocket server, không cần path
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("[+] Client connected");

  ws.on("message", (msg) => {
    // Khi nhận tin nhắn -> gửi lại cho tất cả client
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg.toString());
      }
    }
  });

  ws.on("close", () => console.log("[-] Client disconnected"));
  ws.on("error", () => console.log("[!] Client error"));
});

console.log(`[WS] Simple server running on ws://localhost:${PORT}`);
