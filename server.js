const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./config/db.config");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { parseCookie } = require("cookie");
const authMiddleware = require("./middleware/authMiddleware");

const userMediaState = {};
let activeMeeting = null;
const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    "https://bplc-staff.doitcebutech.com",
    "https://meetflow-j39a.onrender.com",
    "https://www.google.com",
    "http://localhost:3000",
    "chrome-extension://jcfhgikicifmhpalafohbcjfjicamppb"
];

const corsOptions = {
    credentials: true,
    origin(origin, callback) {

        if (!origin) {
            return callback(null, true);
        }

        if (
            origin.startsWith("chrome-extension://") ||
            allowedOrigins.includes(origin)
        ) {
            return callback(null, true);
        }

        callback(new Error("Not allowed"));
    }
};

app.use(cors(corsOptions));

const io = new Server(server, {
    cors: corsOptions
});

const authRoutes = require("./routes/authRoutes");

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(authRoutes);


// MEMORY STORAGE
const onlineUsers = {}; // token -> {socketId, user}
const rooms = {};       // roomId -> admin data
const pendingRequests = {};
const requestTimers = {};
const joinedUsersInMeeting = {};
const port = 3000;
const reconnectTimers = {};
const peerSocketMap = {};
const callAllProgress = {};

io.use((socket, next) => {

    console.log("========== SOCKET AUTH ==========");
    console.log("Origin:", socket.handshake.headers.origin);
    console.log("Cookie:", socket.handshake.headers.cookie);
    console.log("Auth:", socket.handshake.auth);

    let token;

    const cookies = parseCookie(
        socket.handshake.headers.cookie || ""
    );

    token = cookies.meetflow_session;

    if (!token) {
        token = socket.handshake.auth?.token;
    }

    console.log("Resolved Token:", token);

    if (!token) {
        console.log("Unauthorized: No token");
        return next(new Error("Unauthorized"));
    }

    db.query(
        `SELECT
            users.id,
            users.firstname,
            users.lastname,
            users.username,
            users.acc_type,
            users.token
         FROM sessions
         INNER JOIN users
            ON sessions.user_id = users.id
         WHERE sessions.token = ?
         AND sessions.expires_at > NOW()`,
        [token],
        (err, result) => {

            console.log("DB Error:", err);
            console.log("Rows:", result?.length);

            if (err || result.length === 0) {
                console.log("Unauthorized: Invalid session");
                return next(new Error("Unauthorized"));
            }

            console.log("Authenticated:", result[0].username);

            socket.data.user = result[0];

            next();
        }
    );

});


function endMeeting(roomId) {

    if (!roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    const joined = Object.keys(joinedUsersInMeeting);

    // Update room
    db.query(`
        UPDATE rooms
        SET status='ended',
            ended_at=NOW()
        WHERE room_token=?
    `, [roomId]);

    // Update meeting
    db.query(`
        UPDATE meetings
        SET ended_at=NOW(),
            duration_seconds=TIMESTAMPDIFF(
                SECOND,
                started_at,
                NOW()
            )
        WHERE room_token=?
    `, [roomId]);

    // Update participants
    db.query(`
        SELECT id
        FROM meetings
        WHERE room_token=?
    `, [roomId], (err, result) => {

        if (err || !result.length) return;

        db.query(`
            UPDATE meeting_participants
            SET left_at=NOW()
            WHERE meeting_id=?
            AND left_at IS NULL
        `, [result[0].id]);

    });

    // Delete pending requests
    db.query(`
        UPDATE meeting_requests
        SET
            status='expired',
            responded_at=NOW()
        WHERE
            room_token=?
            AND status='pending'
    `, [roomId]);

    io.in(roomId).fetchSockets().then(sockets => {

        sockets.forEach(s => {

            s.leave(roomId);

            s.emit("meeting-ended", {
                roomId,
                joinedUsers: joined
            });

        });

    });

    Object.keys(joinedUsersInMeeting).forEach(t => delete joinedUsersInMeeting[t]);
    Object.keys(pendingRequests).forEach(t => delete pendingRequests[t]);

    Object.keys(requestTimers).forEach(token => {

        clearTimeout(requestTimers[token]);

        delete requestTimers[token];

    });

    delete rooms[roomId];
    delete callAllProgress[roomId];

    activeMeeting = null;
}


io.on("connection", (socket) => {

    const user = socket.data.user;

    if (reconnectTimers[user.token]) {

        clearTimeout(reconnectTimers[user.token]);
        delete reconnectTimers[user.token];
    }

    if (user?.token) {

        if (!userMediaState[user.token]) {
            userMediaState[user.token] = {
                camera: true,
                mic: true
            };
        }

        if (!onlineUsers[user.token]) {

            onlineUsers[user.token] = {
                sockets: new Set(),
                user
            };

        }

        onlineUsers[user.token].sockets.add(socket.id);
        socket.join(user.token);

        db.query(
            `
                SELECT
                    mr.room_token,
                    u.firstname
                FROM meeting_requests mr
                JOIN users u
                    ON mr.from_user_id = u.id
                JOIN rooms r
                    ON r.room_token = mr.room_token
                WHERE
                    mr.to_user_id = ?
                    AND mr.status = 'pending'
                    AND r.status = 'active'
                LIMIT 1
                `,
            [user.id],
            (err, result) => {

                if (err) {
                    console.error(err);
                    return;
                }

                if (result.length) {

                    socket.emit("meeting-request", {
                        roomId: result[0].room_token,
                        admin: result[0].firstname
                    });

                }

            }
        );

        if (
            activeMeeting &&
            activeMeeting.participants.includes(user.token)
        ) {


            peerSocketMap[user.token] = socket.id;

            socket.emit("meeting-started", {
                roomId: activeMeeting.roomId
            });

        }


    }

    socket.on("check-active-meeting", () => {

        const user = socket.data.user;

        if (!user) return;

        if (
            activeMeeting &&
            activeMeeting.participants.includes(user.token)
        ) {

            socket.emit("meeting-started", {
                roomId: activeMeeting.roomId
            });

        }

    });


    socket.on("request-user", ({ roomId, token }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") {
            return;
        }

        db.query(
            `SELECT id
         FROM users
         WHERE token=?`,
            [token],
            (err, result) => {

                if (err || result.length === 0) {
                    return;
                }

                const employeeId = result[0].id;

                pendingRequests[token] = user.token;


                db.query(
                    `INSERT INTO meeting_requests
                (room_token, from_user_id, to_user_id, status)
                VALUES (?, ?, ?, 'pending')`,
                    [
                        roomId,
                        user.id,
                        employeeId
                    ]
                );

                const target = onlineUsers[token];

                if (target) {

                    target.sockets.forEach(id => {

                        io.to(token).emit("meeting-request", {
                            roomId,
                            admin: user.firstname
                        });

                    });

                    if (requestTimers[token]) {
                        clearTimeout(requestTimers[token]);
                    }

                    requestTimers[token] = setTimeout(() => {

                        delete requestTimers[token];

                        if (!pendingRequests[token]) {
                            return;
                        }

                        db.query(`
                            UPDATE meeting_requests
                            SET
                                status='expired',
                                responded_at=NOW()
                            WHERE
                                room_token=?
                                AND to_user_id=?
                                AND status='pending'
                        `,
                            [roomId, employeeId]);

                        const requesterToken = pendingRequests[token];

                        delete pendingRequests[token];

                        const admin = onlineUsers[requesterToken];

                        if (admin) {

                            admin.sockets.forEach(id => {

                                io.to(id).emit("request-expired", {
                                    token
                                });

                            });

                        }

                        console.log(`${token} request expired.`);

                        const stillPending = Object.keys(pendingRequests).length;

                        if (stillPending === 0) {
                            endMeeting(roomId);
                        }

                    }, 20000);

                }

            }
        );

    });

    socket.on("meeting-request-accepted", () => {

        const user = socket.data.user;

        if (!user) return;

        // Meeting might already be ended
        if (!activeMeeting) {
            return socket.emit("meeting-ended");
        }

        const roomId = activeMeeting.roomId;

        db.query(
            `UPDATE meeting_requests
            SET
                status='accepted',
                responded_at=NOW()
            WHERE
                room_token=?
                AND to_user_id=?
                AND status='pending'`,
            [
                roomId,
                user.id
            ]
        );

        db.query(
            `SELECT id
            FROM meetings
            WHERE room_token=?`,
            [roomId],
            (err, result) => {

                if (err || result.length === 0) return;

                db.query(
                    `INSERT INTO meeting_participants
                    (meeting_id, user_id, joined_at)
                    VALUES (?, ?, NOW())`,
                    [
                        result[0].id,
                        user.id
                    ]
                );

            }
        );

        delete pendingRequests[user.token];

        if (requestTimers[user.token]) {
            clearTimeout(requestTimers[user.token]);
            delete requestTimers[user.token];
        }

        if (!activeMeeting.participants.includes(user.token)) {

            activeMeeting.participants.push(user.token);

            const room = rooms[roomId];

            if (
                room &&
                !room.participants.includes(user.token)
            ) {
                room.participants.push(user.token);
            }

        }

        io.emit("request-accepted", {
            token: user.token
        });

        const progress = callAllProgress[roomId];

        if (progress) {

            progress.remaining--;
            progress.accepted++;

            io.to(progress.adminSocket).emit("call-all-progress", {
                remaining: progress.remaining
            });

            if (progress.remaining <= 0) {
                delete callAllProgress[roomId];
            }

        }

    });

    socket.on("meeting-request-declined", () => {

        console.log("DECLINE RECEIVED");

        const user = socket.data.user;

        console.log("USER:", user.token);

        const requesterToken = pendingRequests[user.token];

        console.log("REQUESTER:", requesterToken);

        if (!requesterToken) {
            console.log("NO REQUESTER TOKEN");
            return;
        }

        const roomId = activeMeeting.roomId;

        db.query(
            `UPDATE meeting_requests
            SET
                status='declined',
                responded_at=NOW()
            WHERE
                room_token=?
                AND to_user_id=?
                AND status='pending'`,
            [
                roomId,
                user.id
            ]
        );

        const admin = onlineUsers[requesterToken];

        if (admin) {

            admin.sockets.forEach(id => {
                io.to(id).emit("request-declined", {
                    token: user.token
                });
            });

        }

        delete pendingRequests[user.token];

        if (requestTimers[user.token]) {
            clearTimeout(requestTimers[user.token]);
            delete requestTimers[user.token];
        }

        const progress = callAllProgress[roomId];

        if (progress) {

            progress.remaining--;

            io.to(progress.adminSocket).emit("call-all-progress", {
                remaining: progress.remaining
            });

            if (progress.remaining <= 0) {

                // nobody accepted
                if (progress.accepted === 0) {

                    console.log("Nobody accepted. Ending meeting.");

                    endMeeting(roomId);

                }

                delete callAllProgress[roomId];
            }

        }

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
    socket.on("create-room", ({ participants = [] }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") {
            return;
        }

        const roomId =
            "ROOM-" +
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

        rooms[roomId] = {
            adminToken: socket.data.user.token,
            admin: socket.data.user.firstname,
            participants: [
                socket.data.user.token,
                ...participants
            ]
        };

        activeMeeting = {
            roomId,
            adminToken: socket.data.user.token,
            participants: [
                socket.data.user.token,
                ...participants
            ],
            timerStarted: false,
            startedAt: null
        };

        db.query(
            `INSERT INTO rooms
            (
                room_token,
                admin_id,
                status
            )
            VALUES
            (
                ?,?,
                'active'
            )`,
            [
                roomId,
                socket.data.user.id
            ]
        );

        db.query(
            `INSERT INTO meetings
            (
                room_token,
                admin_id,
                started_at
            )
            VALUES
            (
                ?,?,
                NOW()
            )`,
            [
                roomId,
                socket.data.user.id
            ],
            (err, result) => {

                if (err) return;

                db.query(
                    `INSERT INTO meeting_participants
                    (
                        meeting_id,
                        user_id,
                        joined_at
                    )
                    VALUES
                    (
                        ?,?,
                        NOW()
                    )`,
                    [
                        result.insertId,
                        socket.data.user.id
                    ]
                );

            }
        );

        socket.emit("room-created", {
            roomId
        });

        socket.emit("meeting-started", {
            roomId
        });

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

            target.sockets.forEach(id => {
                io.to(id).emit("meeting-started", {
                    roomId
                });
            });
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
            !activeMeeting.participants.includes(user.token)
        ) {
            activeMeeting.participants.push(user.token);
        }

        socket.join(roomId);

        joinedUsersInMeeting[user.token] = true;
        peerSocketMap[user.token] = socket.id;
        socket.data.roomId = roomId;

        const roomSockets = await io.in(roomId).fetchSockets();

        if (!activeMeeting.timerStarted &&
            roomSockets.length >= 2) {

            activeMeeting.timerStarted = true;
            activeMeeting.startedAt = Date.now();

            io.to(roomId).emit("meeting-timer-start", {
                startedAt: activeMeeting.startedAt
            });
        }

        db.query(
            `SELECT id
            FROM meetings
            WHERE room_token=?`,
            [roomId],
            (err, result) => {

                if (err || result.length === 0) return;

                db.query(
                    `UPDATE meeting_participants
                    SET joined_at=NOW()
                    WHERE
                        meeting_id=?
                        AND user_id=?`,
                    [
                        result[0].id,
                        user.id
                    ]
                );

            }
        );

        const clients = [];



        for (const s of roomSockets) {

            if (!s.data.user) continue;

            if (s.data.user.token !== user.token) {

                clients.push({
                    id: s.data.user.token,
                    firstname: s.data.user.firstname,
                    media:
                        userMediaState[s.data.user.token] || {
                            camera: true,
                            mic: true
                        }
                });

            }

        }

        socket.emit("existing-users", clients);
        socket.emit("room-info", { participants: clients.length });

        socket.to(roomId).emit(
            "user-joined-room",
            {
                id: user.token,
                firstname: user.firstname,
                media:
                    userMediaState[user.token] || {
                        camera: true,
                        mic: true
                    }
            }
        );

    });

    // WEBRTC SIGNALING (SAFE ROUTING)
    socket.on("offer", (data) => {

        const socketId = peerSocketMap[data.to];

        if (!socketId) return;

        io.to(socketId).emit("offer", data);

    });

    socket.on("answer", (data) => {

        const socketId = peerSocketMap[data.to];

        if (!socketId) return;

        io.to(socketId).emit("answer", data);

    });

    socket.on("ice-candidate", (data) => {

        const socketId = peerSocketMap[data.to];

        if (!socketId) return;

        io.to(socketId).emit("ice-candidate", data);

    });

    socket.on("remove-user", async ({ roomId, userId }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") {
            return;
        }

        const room = rooms[roomId];

        if (!room) return;

        // REMOVE USER IN ROOM PARTICIPANTS
        room.participants = room.participants.filter(
            p => p !== userId
        );

        // REMOVE ALSO IN ACTIVE MEETING
        if (activeMeeting) {

            activeMeeting.participants =
                activeMeeting.participants.filter(
                    p => p !== userId
                );
        }

        const target = onlineUsers[userId];

        if (target) {

            target.sockets.forEach(id => {
                const targetSocket = io.sockets.sockets.get(id);

                if (!targetSocket) return;

                targetSocket.leave(roomId);
                targetSocket.emit("removed-from-meeting");
            });

            delete joinedUsersInMeeting[userId];

            db.query(
                `SELECT id
                FROM meetings
                WHERE room_token=?`,
                [roomId],
                (err, result) => {

                    if (err || result.length === 0) return;

                    db.query(
                        `UPDATE meeting_participants
                        SET left_at=NOW()
                        WHERE meeting_id=? AND user_id=?`,
                        [
                            result[0].id,
                            target.user.id
                        ]
                    );

                }
            );

        }

        io.to(roomId).emit("user-disconnected", userId);

        const remainingEmployees =
            activeMeeting.participants.filter(
                token => token !== room.adminToken
            ).length;

        if (remainingEmployees === 0) {
            endMeeting(roomId);
        }
    });

    socket.on("end-meeting", ({ roomId, adminToken }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") return;

        const room = rooms[roomId];

        if (!room) return;

        if (room.adminToken !== adminToken) {

            return socket.emit("error", "Not allowed");

        }

        endMeeting(roomId);

    });


    socket.on("delete-user", ({ token }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") {
            return;
        }

        db.query(
            "DELETE FROM users WHERE token=?",
            [token],
            (err) => {

                if (err) {
                    socket.emit("delete-user-failed");
                    return;
                }

                io.emit("user-deleted", token);

            }
        );

    });



    socket.on("request-all-users", ({ roomId }) => {

        const user = socket.data.user;

        if (!user || user.acc_type !== "admin") {
            return;
        }

        const room = rooms[roomId];

        if (!room) return;

        let totalRequests = 0;

        for (const token in onlineUsers) {

            if (token === room.adminToken)
                continue;

            if (joinedUsersInMeeting[token])
                continue;

            if (pendingRequests[token])
                continue;

            const target = onlineUsers[token];

            if (!target)
                continue;

            totalRequests++;

            pendingRequests[token] = socket.data.user.token;

            db.query(
                `INSERT INTO meeting_requests
            (room_token, from_user_id, to_user_id, status)
            VALUES (?, ?, ?, 'pending')`,
                [
                    roomId,
                    socket.data.user.id,
                    target.user.id
                ]
            );

            target.sockets.forEach(id => {

                setTimeout(() => {

                    io.to(token).emit("meeting-request", {
                        roomId,
                        admin: user.firstname
                    });

                }, 50);

            });

        }

        callAllProgress[roomId] = {
            adminSocket: socket.id,
            remaining: totalRequests,
            accepted: 0
        };

        setTimeout(() => {

            const progress = callAllProgress[roomId];

            if (!progress) return;

            io.to(progress.adminSocket).emit("call-all-progress", {
                remaining: 0
            });

            if (progress.accepted === 0) {

                io.to(progress.adminSocket).emit("call-all-expired");

                console.log("Call All expired.");

                endMeeting(roomId);

            }

            delete callAllProgress[roomId];

        }, 20000);

        socket.emit("call-all-started", {
            total: totalRequests
        });

    });


    socket.on("admin-logout", () => {

        const user = socket.data.user;

        if (
            user &&
            user.acc_type === "admin" &&
            activeMeeting &&
            activeMeeting.adminToken === user.token
        ) {

            endMeeting(activeMeeting.roomId);

        }

    });


    socket.on("disconnect", () => {

        const user = socket.data.user;

        if (user &&
            user.acc_type === "admin" &&
            activeMeeting &&
            activeMeeting.adminToken === user.token) {

            const roomId = activeMeeting.roomId;

            reconnectTimers[user.token] = setTimeout(() => {

                socket.to(roomId).emit(
                    "user-disconnected",
                    user.token
                );

                endMeeting(roomId);

            }, 20000);

            db.query(
                `SELECT id
                FROM meetings
                WHERE room_token=?`,
                [activeMeeting?.roomId],
                (err, result) => {

                    if (err || result.length === 0) return;

                    db.query(
                        `UPDATE meeting_participants
                        SET left_at=NOW()
                        WHERE
                            meeting_id=?
                            AND user_id=?`,
                        [
                            result[0].id,
                            user.id
                        ]
                    );

                }
            );

            const requesterToken =
                pendingRequests[user.token];

            if (requesterToken) {

                db.query(
                    `UPDATE meeting_requests
                    SET
                        status='cancelled',
                        responded_at=NOW()
                    WHERE
                        room_token=?
                        AND to_user_id=?
                        AND status='pending'`,
                    [
                        activeMeeting?.roomId,
                        user.id
                    ]
                );

                const admin =
                    onlineUsers[requesterToken];

                if (admin) {

                    admin.sockets.forEach(id => {
                        io.to(id).emit("request-declined", {
                            token: user.token
                        });
                    });

                }

                delete pendingRequests[user.token];

            }

        }

        if (peerSocketMap[user.token] === socket.id) {

            setTimeout(() => {

                if (peerSocketMap[user.token] === socket.id) {
                    delete peerSocketMap[user.token];
                }

            }, 20000);

        }

        const online = onlineUsers[user.token];

        if (online) {

            online.sockets.delete(socket.id);

            if (online.sockets.size === 0) {
                delete onlineUsers[user.token];
            }

        }

    });

});




app.get("/users", authMiddleware, (req, res) => {

    db.query(
        `
            SELECT
                token,
                firstname,
                lastname,
                acc_type
            FROM users
            WHERE acc_type='employee'
            AND is_active=1
            `,
        (err, result) => {

            if (err) {
                return res.status(500).json(err);
            }

            const users = result.map(user => ({
                ...user,
                joined: !!joinedUsersInMeeting[user.token]
            }));

            res.json(users);
        }
    );
});

const crypto = require("crypto");

app.post("/add-employee", authMiddleware, (req, res) => {

    const {
        firstname,
        lastname,
        username,
        password
    } = req.body;

    if (!firstname || !lastname || !username || !password) {
        return res.status(400).json({
            message: "All fields are required."
        });
    }

    db.query(
        "SELECT id FROM users WHERE username = ?",
        [username],
        (err, exists) => {

            if (err) {
                return res.status(500).json(err);
            }

            if (exists.length > 0) {
                return res.status(400).json({
                    message: "Username already exists."
                });
            }

            const token = crypto.randomUUID();

            db.query(
                `
                INSERT INTO users (
                    firstname,
                    lastname,
                    acc_type,
                    username,
                    password,
                    token,
                    is_active,
                    created_by,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `,
                [
                    firstname,
                    lastname,
                    "employee",
                    username,
                    password,
                    token,
                    1,
                    req.user.id
                ],
                (err) => {

                    if (err) {
                        return res.status(500).json(err);
                    }

                    res.json({
                        success: true
                    });

                }
            );

        }
    );

});



server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});