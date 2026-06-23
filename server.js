const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const db = require("./config/db.config");

let activeMeeting = null;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static("public"));
app.use(express.json());

app.use(session({
    secret: "meetflow-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==========================
// MEMORY STORAGE
// ==========================
const onlineUsers = {}; // token -> {socketId, user}
const rooms = {};       // roomId -> admin data

// ==========================
// SOCKET
// ==========================
io.on("connection", (socket) => {

    console.log("Connected:", socket.id);

    // ==========================
    // REGISTER (FIXED SAFE)
    // ==========================
    socket.on("register", (user) => {

        if (!user?.token) return;

        // prevent duplicate overwrite issues
        onlineUsers[user.token] = {
            socketId: socket.id,
            user
        };

        socket.data.user = user;

        console.log("[REGISTER]", user.token);

        // auto rejoin meeting
        if (activeMeeting && user.acc_type === "employee") {
            socket.emit("meeting-started", {
                roomId: activeMeeting.roomId
            });
        }
    });

    // ==========================
    // CHECK ACTIVE MEETING (FIXED SAFE)
    // ==========================
    socket.on("check-active-meeting", () => {

        const user = socket.data.user;
        if (!user) return;

        if (!activeMeeting) return;

        socket.emit("meeting-started", {
            roomId: activeMeeting.roomId
        });
    });

    // ==========================
    // CREATE ROOM
    // ==========================
    socket.on("create-room", ({ admin }) => {

        const roomId = "ROOM-" + Math.random().toString(36).substring(2, 8).toUpperCase();

        rooms[roomId] = {
            adminToken: socket.data.user?.token,
            adminSocketId: socket.id
        };

        activeMeeting = {
            roomId,
            adminToken: socket.data.user?.token,
            startedAt: Date.now()
        };

        console.log("[ROOM CREATED]", roomId);

        // save DB (optional)
        db.query(
            "INSERT INTO rooms (room_token, admin_name) VALUES (?, ?)",
            [roomId, admin],
            () => { }
        );

        // send to admin
        socket.emit("room-created", { roomId });

        // auto start meeting immediately
        startMeetingBroadcast(roomId);
    });

    function startMeetingBroadcast(roomId) {

        for (const token in onlineUsers) {

            const userData = onlineUsers[token];

            if (userData.user.acc_type === "employee") {
                io.to(userData.socketId).emit("meeting-started", { roomId });
            }
        }
    }

    // ==========================
    // START MEETING
    // ==========================
    socket.on("start-meeting", ({ roomId, adminToken }) => {

        if (!roomId) return;

        activeMeeting = {
            roomId,
            adminToken,
            startedAt: Date.now()
        };

        startMeetingBroadcast(roomId);
    });

    // ==========================
    // JOIN ROOM (FIXED ORDER + STABLE)
    // ==========================
    socket.on("join-room", ({ roomId }) => {

        const user = socket.data.user;
        if (!user) return;

        socket.join(roomId);

        console.log(`[JOIN] ${user.token} -> ${roomId}`);

        // build clean user list (tokens only)
        const clients = [];

        for (let [token, data] of Object.entries(onlineUsers)) {
            if (data.socketId) {
                clients.push({
                    id: token,
                    firstname: data.user.firstname
                });
            }
        }

        // send existing users FIRST
        socket.emit("existing-users", clients);

        // notify others
        socket.to(roomId).emit("user-joined-room", {
            id: user.token,
            firstname: user.firstname
        });
    });

    // ==========================
    // WEBRTC SIGNALING (SAFE ROUTING)
    // ==========================
    socket.on("offer", (data) => {
        const target = onlineUsers[data.to];
        if (!target) return;

        io.to(target.socketId).emit("offer", data);
    });

    socket.on("answer", (data) => {
        const target = onlineUsers[data.to];
        if (!target) return;

        io.to(target.socketId).emit("answer", data);
    });

    socket.on("ice-candidate", (data) => {
        const target = onlineUsers[data.to];
        if (!target) return;

        io.to(target.socketId).emit("ice-candidate", data);
    });


    socket.on("end-meeting", ({ roomId, adminToken }) => {

        if (!roomId) return;

        const room = rooms[roomId];

        if (!room) return;

        if (room.adminToken !== adminToken) {
            return socket.emit("error", "Not allowed");
        }

        console.log("[MEETING ENDED]", roomId);

        activeMeeting = null;

        // notify ALL users
        io.emit("meeting-ended", { roomId });

        // optional cleanup
        delete rooms[roomId];
    });

    

    // ==========================
    // DISCONNECT CLEANUP (IMPORTANT FIX)
    // ==========================
    socket.on("disconnect", () => {

        console.log("Disconnected:", socket.id);

        for (const token in onlineUsers) {
            if (onlineUsers[token].socketId === socket.id) {
                delete onlineUsers[token];
                break;
            }
        }
    });
});

// ==========================
// LOGIN
// ==========================
app.post("/login", (req, res) => {

    const { username, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE username=?",
        [username],
        (err, result) => {

            if (err) return res.status(500).send();

            if (result.length === 0)
                return res.json({ success: false });

            const user = result[0];

            if (user.password !== password)
                return res.json({ success: false });

            req.session.user = {
                id: user.id,
                firstname: user.firstname,
                lastname: user.lastname,
                username: user.username,
                acc_type: user.acc_type,
                token: user.token
            };

            res.json({
                success: true,
                user: req.session.user
            });
        }
    );
});

// ==========================
// SESSION
// ==========================
app.get("/session", (req, res) => {

    if (!req.session.user) {
        return res.json({ logged: false });
    }

    res.json({
        logged: true,
        user: req.session.user
    });
});

// ==========================
// START SERVER
// ==========================
server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});