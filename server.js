const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const db = require("./config/db.config");

const userMediaState = {};

let activeMeeting = null;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

const authRoutes = require("./routes/authRoutes");

app.use(session({
    secret: "meetflow-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(authRoutes);


// MEMORY STORAGE
const onlineUsers = {}; // token -> {socketId, user}
const rooms = {};       // roomId -> admin data
const acceptedUsers = {};

// SOCKET
io.on("connection", (socket) => {

    console.log("Connected:", socket.id);

    // REGISTER (FIXED SAFE)
    socket.on("register", (user) => {


        if (!user?.token) return;

        userMediaState[user.token] = {
            camera: true,
            mic: true
        };

        // prevent duplicate overwrite issues
        onlineUsers[user.token] = {
            socketId: socket.id,
            user
        };

        socket.data.user = user;

        console.log("[REGISTER]", user.token);

        // auto rejoin meetin
        if (
            activeMeeting &&
            activeMeeting.participants.includes(
                user.token
            )
        ) {
            socket.emit("meeting-started", {
                roomId: activeMeeting.roomId
            });
        }
    });

    socket.on("request-user", ({ roomId, token }) => {

        const target =
            onlineUsers[token];

        if (!target) {
            return socket.emit(
                "error",
                "User is offline."
            );
        }

        io.to(target.socketId).emit(
            "meeting-request",
            {
                roomId,
                admin:
                    socket.data.user.firstname
            }
        );
    });

    socket.on("meeting-request-accepted", () => {

        const user = socket.data.user;

        if (!user) return;

        acceptedUsers[user.token] = true;

        // ADD THIS
        if (
            activeMeeting &&
            !activeMeeting.participants.includes(
                user.token
            )
        ) {
            activeMeeting.participants.push(
                user.token
            );
        }

        io.emit("request-accepted", {
            token: user.token
        });
    });

    socket.on("media-status", ({ camera, mic }) => {

        const user = socket.data.user;
        if (!user) return;

        userMediaState[user.token] = {
            camera,
            mic
        };

        io.emit("media-status-changed", {
            userId: user.token,
            camera,
            mic
        });
    });


    // CREATE ROOM
    socket.on("create-room", ({ admin, participants = [] }) => {

        const roomId = "ROOM-" + Math.random().toString(36).substring(2, 8).toUpperCase();

        rooms[roomId] = {
            adminToken: socket.data.user?.token,
            adminSocketId: socket.id,
            participants
        };

        activeMeeting = {
            roomId,
            adminToken:
                socket.data.user?.token,
            participants
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

        socket.emit("meeting-started", {
            roomId
        });

        // auto start meeting immediately
        startMeetingBroadcast(roomId);
    });

    function startMeetingBroadcast(roomId) {

        const room = rooms[roomId];

        if (!room) return;

        if (!Array.isArray(room.participants)) {
            console.log("No participants selected");
            return;
        }

        room.participants.forEach(token => {

            const target = onlineUsers[token];

            if (!target) return;

            io.to(target.socketId).emit(
                "meeting-started",
                { roomId }
            );
        });
    }

    // START MEETING
    socket.on("start-meeting", ({ roomId, adminToken }) => {

        if (!roomId) return;

        activeMeeting = {
            roomId,
            adminToken,
            startedAt: Date.now()
        };

        startMeetingBroadcast(roomId);
    });

    // JOIN ROOM (FIXED ORDER + STABLE)
    socket.on("join-room", async ({ roomId }) => {

        const user = socket.data.user;

        if (!user) return;

        if (
            activeMeeting &&
            !activeMeeting.participants.includes(
                user.token
            )
        ) {
            activeMeeting.participants.push(
                user.token
            );
        }

        socket.join(roomId);

        console.log(`[JOIN] ${user.token} -> ${roomId}`);

        // build clean user list (tokens only)
        const clients = [];

        const roomSockets = await io.in(roomId).fetchSockets();

        for (const s of roomSockets) {

            if (!s.data.user) continue;

            if (s.data.user.token !== user.token) {

                clients.push({
                    id: s.data.user.token,
                    firstname: s.data.user.firstname,
                    media: userMediaState[s.data.user.token] || {
                        camera: true,
                        mic: true
                    }
                });

            }
        }

        // send existing users FIRST
        socket.emit("existing-users", clients);

        // notify others
        socket.to(roomId).emit("user-joined-room", {
            id: user.token,
            firstname: user.firstname,
            media: userMediaState[user.token] || {
                camera: true,
                mic: true
            }
        });
    });

    // WEBRTC SIGNALING (SAFE ROUTING)
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

    socket.on("remove-user", async ({ roomId, userId }) => {

        const room = rooms[roomId];

        if (!room) return;

        // REMOVE USER SA ROOM PARTICIPANTS
        room.participants =
            room.participants.filter(
                p => p !== userId
            );

        // REMOVE SAD SA ACTIVE MEETING
        if (activeMeeting) {

            activeMeeting.participants =
                activeMeeting.participants.filter(
                    p => p !== userId
                );
        }

        const target =
            onlineUsers[userId];

        if (!target) return;

        const targetSocket =
            io.sockets.sockets.get(
                target.socketId
            );

        if (targetSocket) {

            targetSocket.leave(roomId);

            targetSocket.emit(
                "removed-from-meeting"
            );
        }

        io.to(roomId).emit(
            "user-disconnected",
            userId
        );

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






    // DISCONNECT CLEANUP (IMPORTANT FIX)
    socket.on("disconnect", () => {

        const user = socket.data.user;

        if (user) {

            socket.to(activeMeeting?.roomId).emit(
                "user-disconnected",
                user.token
            );

        }

        for (const token in onlineUsers) {

            if (
                onlineUsers[token].socketId ===
                socket.id
            ) {

                delete onlineUsers[token];
                break;
            }
        }
    });
});

app.get("/users", (req, res) => {

    db.query(
        `
            SELECT
                token,
                firstname,
                lastname,
                acc_type
            FROM users
            WHERE acc_type='employee'
            `,
        (err, result) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(result);
        }
    );
});


// ==========================
// START SERVER
// ==========================
server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});