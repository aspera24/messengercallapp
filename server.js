const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = {};
const rooms = {}; // 🔥 NEW

io.on("connection", socket => {

    console.log("Connected:", socket.id);

    // REGISTER
    socket.on("register", userId => {
        users[userId] = socket.id;
    });

    // 🔥 CREATE / JOIN ROOM
    socket.on("join-room", ({ roomId, userId }) => {

        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }

        // add user to room
        rooms[roomId].push(userId);

        socket.join(roomId);

        console.log(`${userId} joined room ${roomId}`);

        // notify others in room
        socket.to(roomId).emit("user-joined", {
            userId
        });

    });

    // 📞 GROUP CALL (ROOM BASED)
    socket.on("room-call", ({ roomId, from, offer }) => {

        socket.to(roomId).emit("incoming-call", {
            from,
            offer
        });

    });

    // 📩 ANSWER
    socket.on("answer-call", data => {
        const targetSocket = users[data.to];
        if (targetSocket) {
            io.to(targetSocket).emit("call-answered", data.answer);
        }
    });

    // 📡 ICE
    socket.on("ice-candidate", data => {
        const targetSocket = users[data.to];
        if (targetSocket) {
            io.to(targetSocket).emit("ice-candidate", data.candidate);
        }
    });

    // ❌ DISCONNECT
    socket.on("disconnect", () => {
        for (const userId in users) {
            if (users[userId] === socket.id) {
                delete users[userId];
            }
        }
    });

    socket.on("call-user", ({ from, to, offer }) => {
        const targetSocket = users[to];
        if (targetSocket) {
            io.to(targetSocket).emit("incoming-call", {
                from,
                offer
            });
        }
    });

});

server.listen(3000, () => console.log("Server running"));