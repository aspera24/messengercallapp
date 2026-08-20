const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./config/db.config");


process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION");
    console.error(err);
});

process.on("unhandledRejection", (err) => {
    console.error("UNHANDLED REJECTION");
    console.error(err);
});

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
const authRoutes = require("./routes/authRoutes");
const apiRoutes = require("./routes/apiRoutes")(io, joinedUsersInMeeting);
const pageRoutes = require("./routes/pageRoutes");

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(authRoutes);
app.use(apiRoutes);
app.use(pageRoutes);



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
        SET
            status='ended',
            ended_at=NOW()
        WHERE room_token=?
    `, [roomId], (err) => {

        if (err) {
            console.error("END MEETING -> UPDATE ROOMS");
            console.error(err);
        }

    });

    // Update meeting
    db.query(`
        UPDATE meetings
        SET
            ended_at=NOW(),
            duration_seconds=TIMESTAMPDIFF(
                SECOND,
                started_at,
                NOW()
            )
        WHERE room_token=?
    `, [roomId], (err) => {

        if (err) {
            console.error("END MEETING -> UPDATE MEETINGS");
            console.error(err);
        }

    });

    // Update participants
    db.query(`
        SELECT id
        FROM meetings
        WHERE room_token=?
    `, [roomId], (err, result) => {

        if (err) {
            console.error("END MEETING -> SELECT MEETING");
            console.error(err);
            return;
        }

        if (!result.length) {
            console.warn("END MEETING -> No meeting found:", roomId);
            return;
        }

        db.query(`
            UPDATE meeting_participants
            SET left_at=NOW()
            WHERE
                meeting_id=?
                AND left_at IS NULL
        `, [result[0].id], (err) => {

            if (err) {
                console.error("END MEETING -> UPDATE PARTICIPANTS");
                console.error(err);
            }

        });

    });

    // Expire pending requests
    db.query(`
        UPDATE meeting_requests
        SET
            status='expired',
            responded_at=NOW()
        WHERE
            room_token=?
            AND status='pending'
    `, [roomId], (err) => {

        if (err) {
            console.error("END MEETING -> UPDATE REQUESTS");
            console.error(err);
        }

    });

    io.in(roomId).fetchSockets()
        .then((sockets) => {

            sockets.forEach((s) => {

                s.leave(roomId);

                s.emit("meeting-ended", {
                    roomId,
                    joinedUsers: joined
                });

            });

        })
        .catch((err) => {
            console.error("END MEETING -> FETCH SOCKETS");
            console.error(err);
        });

    Object.keys(joinedUsersInMeeting).forEach(token => {
        delete joinedUsersInMeeting[token];
    });

    Object.keys(pendingRequests).forEach(token => {
        delete pendingRequests[token];
    });

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

                if (err) {
                    console.error("REQUEST USER -> SELECT USER");
                    console.error(err);
                    return;
                }

                if (result.length === 0) {
                    console.warn("REQUEST USER -> User not found:", token);
                    return;
                }

                const employeeId = result[0].id;

                pendingRequests[token] = user.token;

                db.query(
                    `INSERT INTO meeting_requests
                (
                    room_token,
                    from_user_id,
                    to_user_id,
                    status
                )
                VALUES (?, ?, ?, 'pending')`,
                    [
                        roomId,
                        user.id,
                        employeeId
                    ],
                    (err, insertResult) => {

                        if (err) {
                            console.error("REQUEST USER -> INSERT REQUEST");
                            console.error(err);
                            delete pendingRequests[token];
                            return;
                        }

                        const requestId = insertResult.insertId;

                        if (requestTimers[token]) {
                            clearTimeout(requestTimers[token]);
                        }

                        requestTimers[token] = setTimeout(() => {

                            delete requestTimers[token];

                            if (!pendingRequests[token]) {
                                return;
                            }

                            db.query(
                                `UPDATE meeting_requests
                             SET
                                status='expired',
                                responded_at=NOW()
                             WHERE
                                id=?
                                AND status='pending'`,
                                [requestId],
                                (err) => {

                                    if (err) {
                                        console.error("REQUEST USER -> EXPIRE REQUEST");
                                        console.error(err);
                                        return;
                                    }

                                    const requesterToken = pendingRequests[token];

                                    if (!requesterToken) {
                                        return;
                                    }

                                    const employee = onlineUsers[token];

                                    if (employee) {

                                        employee.sockets.forEach(id => {

                                            io.to(id).emit("request-expired");

                                        });

                                    }

                                    const admin = onlineUsers[requesterToken];

                                    if (admin) {

                                        admin.sockets.forEach(id => {

                                            io.to(id).emit("request-expired", {
                                                token
                                            });

                                        });

                                    }

                                    delete pendingRequests[token];

                                    console.log(`${token} request expired.`);

                                    const stillPending = Object.keys(pendingRequests).length;

                                    if (stillPending === 0) {
                                        endMeeting(roomId);
                                    }

                                }
                            );

                        }, 20000);

                        const target = onlineUsers[token];

                        if (target) {

                            target.sockets.forEach(id => {

                                io.to(id).emit("meeting-request", {
                                    roomId,
                                    admin: user.firstname
                                });

                            });

                        }

                    }
                );

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
            ],
            (err) => {

                if (err) {
                    console.error("REQUEST ACCEPTED -> UPDATE REQUEST");
                    console.error(err);
                }

            }
        );

        db.query(
            `SELECT id
        FROM meetings
        WHERE room_token=?`,
            [roomId],
            (err, result) => {

                if (err) {
                    console.error("REQUEST ACCEPTED -> SELECT MEETING");
                    console.error(err);
                    return;
                }

                if (result.length === 0) {
                    console.warn("REQUEST ACCEPTED -> Meeting not found:", roomId);
                    return;
                }

                db.query(
                    `INSERT INTO meeting_participants
                (
                    meeting_id,
                    user_id,
                    joined_at
                )
                VALUES
                (
                    ?, ?, NOW()
                )`,
                    [
                        result[0].id,
                        user.id
                    ],
                    (err) => {

                        if (err) {
                            console.error("REQUEST ACCEPTED -> INSERT PARTICIPANT");
                            console.error(err);
                        }

                    }
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

        const employee = onlineUsers[user.token];

        if (employee) {

            employee.sockets.forEach(id => {

                io.to(id).emit("request-accepted", {
                    token: user.token
                });

            });

        }

        const progress = callAllProgress[roomId];

        if (progress) {

            progress.remaining--;
            progress.accepted++;

            io.to(progress.adminSocket).emit(
                "call-all-progress",
                {
                    remaining: progress.remaining
                }
            );

            if (progress.remaining <= 0) {
                delete callAllProgress[roomId];
            }

        }

    });

    socket.on("meeting-request-declined", () => {

        console.log("DECLINE RECEIVED");

        const user = socket.data.user;

        if (!user) return;

        console.log("USER:", user.token);

        const requesterToken = pendingRequests[user.token];

        console.log("REQUESTER:", requesterToken);

        if (!requesterToken) {
            console.log("NO REQUESTER TOKEN");
            return;
        }

        const roomId = activeMeeting?.roomId;

        if (!roomId) {

            delete pendingRequests[user.token];

            if (requestTimers[user.token]) {
                clearTimeout(requestTimers[user.token]);
                delete requestTimers[user.token];
            }

            return;
        }

        db.query(
            `
        UPDATE meeting_requests
        SET
            status='declined',
            responded_at=NOW()
        WHERE
            room_token=?
            AND to_user_id=?
            AND status='pending'
        `,
            [
                roomId,
                user.id
            ],
            (err) => {

                if (err) {
                    console.error(err);
                }

            }
        );

        const admin = onlineUsers[requesterToken];

        if (admin) {

            admin.sockets.forEach(id => {

                io.to(id).emit("request-declined", {
                    token: user.token
                });

            });

        }

        const employee = onlineUsers[user.token];

        if (employee) {

            employee.sockets.forEach(id => {

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

            progress.remaining = Math.max(0, progress.remaining - 1);

            io.to(progress.adminSocket).emit("call-all-progress", {
                remaining: progress.remaining
            });

            if (progress.remaining === 0) {

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
            adminToken: user.token,
            admin: user.firstname,
            participants: [
                user.token,
                ...participants
            ]
        };

        activeMeeting = {
            roomId,
            adminToken: user.token,
            participants: [
                user.token,
                ...participants
            ],
            timerStarted: false,
            startedAt: null
        };

        db.query(
            `
        INSERT INTO rooms
        (
            room_token,
            admin_id,
            status
        )
        VALUES
        (
            ?, ?,
            'active'
        )
        `,
            [
                roomId,
                user.id
            ],
            (err) => {

                if (err) {

                    console.error("Create room error:", err);

                    delete rooms[roomId];

                    if (activeMeeting?.roomId === roomId) {
                        activeMeeting = null;
                    }

                    return socket.emit("room-create-failed");
                }

                db.query(
                    `
                INSERT INTO meetings
                (
                    room_token,
                    admin_id,
                    started_at
                )
                VALUES
                (
                    ?, ?,
                    NOW()
                )
                `,
                    [
                        roomId,
                        user.id
                    ],
                    (err, result) => {

                        if (err) {

                            console.error("Create meeting error:", err);

                            delete rooms[roomId];

                            if (activeMeeting?.roomId === roomId) {
                                activeMeeting = null;
                            }

                            return socket.emit("room-create-failed");
                        }

                        db.query(
                            `
                        INSERT INTO meeting_participants
                        (
                            meeting_id,
                            user_id,
                            joined_at
                        )
                        VALUES
                        (
                            ?, ?,
                            NOW()
                        )
                        `,
                            [
                                result.insertId,
                                user.id
                            ],
                            (err) => {

                                if (err) {
                                    console.error("Insert participant error:", err);
                                }

                                socket.emit("room-created", {
                                    roomId
                                });

                                socket.emit("meeting-started", {
                                    roomId
                                });

                                startMeetingBroadcast(roomId);

                            }
                        );

                    }
                );

            }
        );

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

    // JOIN ROOM (SAFE)
    socket.on("join-room", async ({ roomId }) => {

        const user = socket.data.user;

        if (!user || !roomId) {
            return;
        }

        // Meeting already ended
        if (!activeMeeting || activeMeeting.roomId !== roomId) {
            return socket.emit("meeting-ended");
        }

        if (!activeMeeting.participants.includes(user.token)) {
            activeMeeting.participants.push(user.token);
        }

        socket.join(roomId);

        joinedUsersInMeeting[user.token] = true;
        peerSocketMap[user.token] = socket.id;
        socket.data.roomId = roomId;

        let roomSockets = [];

        try {

            roomSockets = await io.in(roomId).fetchSockets();

        } catch (err) {

            console.error("fetchSockets error:", err);
            return;

        }

        if (
            !activeMeeting.timerStarted &&
            roomSockets.length >= 2
        ) {

            activeMeeting.timerStarted = true;
            activeMeeting.startedAt = Date.now();

            io.to(roomId).emit("meeting-timer-start", {
                startedAt: activeMeeting.startedAt
            });

        }

        db.query(
            `
        SELECT id
        FROM meetings
        WHERE room_token=?
        `,
            [roomId],
            (err, result) => {

                if (err) {
                    console.error(err);
                    return;
                }

                if (!result.length) {
                    return;
                }

                db.query(
                    `
                UPDATE meeting_participants
                SET joined_at=NOW()
                WHERE
                    meeting_id=?
                    AND user_id=?
                `,
                    [
                        result[0].id,
                        user.id
                    ],
                    (err) => {

                        if (err) {
                            console.error(err);
                        }

                    }
                );

            }
        );

        const clients = [];

        for (const s of roomSockets) {

            if (!s.data.user) continue;

            if (s.data.user.token === user.token) continue;

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

        socket.emit("existing-users", clients);

        socket.emit("room-info", {
            participants: clients.length
        });

        socket.to(roomId).emit("user-joined-room", {
            id: user.token,
            firstname: user.firstname,
            media:
                userMediaState[user.token] || {
                    camera: true,
                    mic: true
                }
        });

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

        if (!token || typeof token !== "string") {
            socket.emit("delete-user-failed");
            return;
        }

        db.query(
            "DELETE FROM users WHERE token=?",
            [token],
            (err, result) => {

                if (err) {
                    console.error("Delete user error:", err);
                    socket.emit("delete-user-failed");
                    return;
                }

                if (result.affectedRows === 0) {
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

        if (!activeMeeting || activeMeeting.roomId !== roomId) {
            return socket.emit("meeting-ended");
        }

        const room = rooms[roomId];

        if (!room) {
            return;
        }

        let totalRequests = 0;

        for (const token in onlineUsers) {

            if (token === room.adminToken) continue;
            if (joinedUsersInMeeting[token]) continue;
            if (pendingRequests[token]) continue;

            const target = onlineUsers[token];

            if (!target) continue;

            totalRequests++;

            pendingRequests[token] = user.token;

            if (requestTimers[token]) {
                clearTimeout(requestTimers[token]);
            }

            db.query(
                `
            INSERT INTO meeting_requests
            (
                room_token,
                from_user_id,
                to_user_id,
                status
            )
            VALUES
            (
                ?, ?, ?, 'pending'
            )
            `,
                [
                    roomId,
                    user.id,
                    target.user.id
                ],
                (err, insertResult) => {

                    if (err) {
                        console.error(err);
                        delete pendingRequests[token];
                        return;
                    }

                    const requestId = insertResult.insertId;

                    requestTimers[token] = setTimeout(() => {

                        delete requestTimers[token];

                        if (!pendingRequests[token]) {
                            return;
                        }

                        db.query(
                            `
        UPDATE meeting_requests
        SET
            status='expired',
            responded_at=NOW()
        WHERE
            id=?
            AND status='pending'
        `,
                            [requestId],
                            (err) => {

                                if (err) {
                                    console.error(err);
                                    return;
                                }

                                const requesterToken = pendingRequests[token];

                                if (!requesterToken) {
                                    return;
                                }

                                // Employee
                                const employee = onlineUsers[token];

                                if (employee) {

                                    employee.sockets.forEach(id => {

                                        io.to(id).emit("request-expired");

                                    });

                                }

                                // Admin
                                const admin = onlineUsers[requesterToken];

                                if (admin) {

                                    admin.sockets.forEach(id => {

                                        io.to(id).emit("request-expired", {
                                            token
                                        });

                                    });

                                }

                                delete pendingRequests[token];

                                const progress = callAllProgress[roomId];

                                if (progress) {

                                    progress.remaining--;

                                    io.to(progress.adminSocket).emit("call-all-progress", {
                                        remaining: progress.remaining
                                    });

                                    if (progress.remaining <= 0) {

                                        io.to(progress.adminSocket).emit("call-all-expired");

                                        delete callAllProgress[roomId];

                                        endMeeting(roomId);

                                    }

                                }

                                console.log(`${token} request expired.`);

                            }
                        );

                    }, 20000);

                    target.sockets.forEach(id => {

                        io.to(id).emit("meeting-request", {
                            roomId,
                            admin: user.firstname
                        });

                    });

                }
            );
        }

        callAllProgress[roomId] = {
            adminSocket: socket.id,
            remaining: totalRequests,
            accepted: 0
        };

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


    socket.on("chat-message", async (data) => {

        try {

            const {
                to,
                message
            } = data;


            // VALIDATION
            if (!to || typeof to !== "string") {
                return;
            }

            if (!message || typeof message !== "string") {
                return;
            }

            const cleanMessage = message.trim();

            if (!cleanMessage) {
                return;
            }

            if (cleanMessage.length > 5000) {
                return;
            }


            // GET AUTHENTICATED SENDER
            const sender = socket.data.user;

            if (!sender) {

                console.log(
                    "Chat rejected: socket has no authenticated user"
                );

                return;
            }


            const senderToken = sender.token;
            const senderId = sender.id;
            const senderType = sender.acc_type;


            console.log("CHAT SENDER:", {
                id: senderId,
                token: senderToken,
                type: senderType
            });


            // FIND RECIPIENT
            const recipient = onlineUsers[to];


            if (!recipient) {

                console.log(
                    "Chat recipient is offline:",
                    to
                );

            }


            // FIND RECIPIENT IN DATABASE
            db.query(
                `
            SELECT
                id,
                firstname,
                lastname,
                username,
                acc_type,
                token
            FROM users
            WHERE token = ?
            AND is_active = 1
            LIMIT 1
            `,
                [to],
                (err, rows) => {

                    if (err) {

                        console.error(
                            "CHAT RECIPIENT DB ERROR:",
                            err
                        );

                        return;
                    }


                    if (!rows.length) {

                        console.log(
                            "Chat recipient not found:",
                            to
                        );

                        return;
                    }


                    const receiver = rows[0];


                    // SAVE MESSAGE
                    db.query(
                        `
                    INSERT INTO messages (
                        sender_type,
                        sender_id,
                        receiver_type,
                        receiver_id,
                        message
                    )
                    VALUES (?, ?, ?, ?, ?)
                    `,
                        [
                            senderType,
                            senderId,
                            receiver.acc_type,
                            receiver.id,
                            cleanMessage
                        ],
                        (err, result) => {

                            if (err) {

                                console.error(
                                    "CHAT MESSAGE INSERT ERROR:",
                                    err
                                );

                                return;
                            }


                            // MESSAGE DATA
                            const messageData = {

                                id: result.insertId,

                                from: senderToken,

                                fromType: senderType,

                                to: receiver.token,

                                toType: receiver.acc_type,

                                message: cleanMessage,

                                createdAt: new Date()

                            };


                            // SEND TO RECIPIENT
                            if (recipient) {

                                recipient.sockets.forEach(
                                    socketId => {

                                        io.to(socketId).emit(
                                            "chat-message",
                                            messageData
                                        );

                                    }
                                );

                            }


                            // CONFIRM TO SENDER
                            socket.emit(
                                "chat-message-sent",
                                messageData
                            );


                            console.log(
                                "CHAT MESSAGE SENT:",
                                messageData
                            );

                        }
                    );

                }
            );


        } catch (error) {

            console.error(
                "chat-message error:",
                error
            );

        }

    });

    socket.on("mark-chat-read", async (data) => {

        try {

            const { from } = data;

            if (!from || typeof from !== "string") {
                return;
            }

            const currentUser = socket.data.user;

            if (!currentUser) {
                return;
            }

            const currentUserId =
                currentUser.id;

            const currentUserType =
                currentUser.acc_type;


            // =========================
            // FIND SENDER
            // =========================

            const [senderRows] =
                await db.promise().query(
                    `
                SELECT
                    id,
                    token,
                    acc_type

                FROM users

                WHERE token = ?

                AND is_active = 1

                LIMIT 1
                `,
                    [from]
                );


            if (!senderRows.length) {
                return;
            }


            const sender =
                senderRows[0];


            // =========================
            // GET UNREAD MESSAGE IDS
            // =========================

            const [unreadMessages] =
                await db.promise().query(
                    `
                SELECT
                    id

                FROM messages

                WHERE sender_id = ?
                AND sender_type = ?

                AND receiver_id = ?
                AND receiver_type = ?

                AND is_read = 0

                AND is_deleted = 0
                `,
                    [
                        sender.id,
                        sender.acc_type,

                        currentUserId,
                        currentUserType
                    ]
                );


            const messageIds =
                unreadMessages.map(
                    row => Number(row.id)
                );


            // Nothing unread
            if (!messageIds.length) {
                return;
            }


            // =========================
            // MARK AS READ
            // =========================

            await db.promise().query(
                `
            UPDATE messages

            SET is_read = 1

            WHERE sender_id = ?
            AND sender_type = ?

            AND receiver_id = ?
            AND receiver_type = ?

            AND is_read = 0

            AND is_deleted = 0
            `,
                [
                    sender.id,
                    sender.acc_type,

                    currentUserId,
                    currentUserType
                ]
            );


            // =========================
            // NOTIFY SENDER
            // =========================

            const senderOnline =
                onlineUsers[sender.token];


            if (senderOnline) {

                senderOnline.sockets.forEach(
                    socketId => {

                        io.to(socketId).emit(
                            "chat-messages-read",
                            {
                                by: currentUser.token,
                                messageIds
                            }
                        );

                    }
                );

            }


            console.log(
                "CHAT MESSAGES READ:",
                {
                    from: sender.token,
                    by: currentUser.token,
                    messageIds
                }
            );


        } catch (error) {

            console.error(
                "mark-chat-read error:",
                error
            );

        }

    });

    socket.on("delete-chat-message", async (data) => {

        try {

            const {
                messageId
            } = data;


            // VALIDATION
            if (
                !messageId ||
                !Number.isInteger(Number(messageId))
            ) {

                return;

            }


            const id = Number(messageId);


            // AUTHENTICATED USER
            const sender = socket.data.user;


            if (!sender) {

                console.log(
                    "Delete rejected: socket has no authenticated user"
                );

                return;

            }


            const senderId = sender.id;
            const senderType = sender.acc_type;


            // FIND MESSAGE
            const [rows] =
                await db.promise().query(
                    `
                        SELECT
                            id,
                            sender_id,
                            sender_type,
                            receiver_id,
                            receiver_type,
                            is_deleted
                        FROM messages
                        WHERE id = ?
                        LIMIT 1
                        `,
                    [id]
                );


            if (!rows.length) {

                console.log(
                    "Message not found:",
                    id
                );

                return;

            }


            const msg = rows[0];


            // SECURITY
            if (
                Number(msg.sender_id) !==
                Number(senderId)
                ||
                msg.sender_type !==
                senderType
            ) {

                console.log(
                    "Unauthorized message delete attempt:",
                    {
                        messageId: id,
                        userId: senderId
                    }
                );

                return;

            }


            // ALREADY DELETED
            if (
                Number(msg.is_deleted) === 1
            ) {

                return;

            }


            // SOFT DELETE
            const [updateResult] =
                await db.promise().query(
                    `
                            UPDATE messages
                            SET is_deleted = 1
                            WHERE id = ?
                            AND sender_id = ?
                            AND sender_type = ?
                            AND is_deleted = 0
                        `,
                    [
                        id,
                        senderId,
                        senderType
                    ]
                );

            if (
                updateResult.affectedRows === 0
            ) {

                console.log(
                    "Message was not deleted:",
                    id
                );

                return;

            }


            // DELETE EVENT DATA
            const deleteData = {

                messageId: id

            };


            // UPDATE SENDER
            socket.emit(
                "chat-message-deleted",
                deleteData
            );


            // FIND RECIPIENT
            const [receiverRows] =
                await db.promise().query(
                    `
                    SELECT
                        token

                    FROM users

                    WHERE id = ?

                    AND acc_type = ?

                    LIMIT 1
                    `,
                    [
                        msg.receiver_id,
                        msg.receiver_type
                    ]
                );


            // UPDATE RECIPIENT
            if (receiverRows.length) {

                const receiverToken =
                    receiverRows[0].token;


                const onlineRecipient =
                    onlineUsers[receiverToken];


                if (onlineRecipient) {

                    onlineRecipient.sockets.forEach(
                        socketId => {

                            io.to(socketId).emit(
                                "chat-message-deleted",
                                deleteData
                            );

                        }
                    );

                }

            }


            console.log(
                "CHAT MESSAGE SOFT-DELETED:",
                id
            );


        } catch (error) {

            console.error(
                "delete-chat-message error:",
                error
            );

        }

    }
    );

    socket.on("edit-chat-message", async (data) => {

        try {

            const {
                messageId,
                message
            } = data;

            // VALIDATION
            if (
                !messageId ||
                !Number.isInteger(Number(messageId))
            ) {
                return;
            }


            if (
                typeof message !== "string"
            ) {
                return;
            }


            const cleanMessage =
                message.trim();


            if (!cleanMessage) {
                return;
            }


            if (cleanMessage.length > 5000) {
                return;
            }

            // AUTHENTICATED USER
            const sender =
                socket.data.user;


            if (!sender) {

                console.log(
                    "Edit rejected: socket has no authenticated user"
                );

                return;
            }


            const senderId =
                sender.id;

            const senderType =
                sender.acc_type;


            const id =
                Number(messageId);

            // FIND MESSAGE
            const [rows] =
                await db.promise().query(
                    `
                SELECT
                    id,
                    sender_id,
                    sender_type,
                    receiver_id,
                    receiver_type,
                    message,
                    is_deleted

                FROM messages

                WHERE id = ?

                LIMIT 1
                `,
                    [id]
                );


            if (!rows.length) {

                console.log(
                    "Edit message not found:",
                    id
                );

                return;
            }


            const msg =
                rows[0];

            // SECURITY
            if (
                Number(msg.sender_id) !==
                Number(senderId)
                ||
                msg.sender_type !==
                senderType
            ) {

                console.log(
                    "Unauthorized message edit attempt:",
                    {
                        messageId: id,
                        userId: senderId
                    }
                );

                return;
            }

            // CANNOT EDIT DELETED MESSAGE
            if (
                Number(msg.is_deleted) === 1
            ) {

                console.log(
                    "Cannot edit deleted message:",
                    id
                );

                return;
            }

            // UPDATE MESSAGE
            const [updateResult] =
                await db.promise().query(
                    `
                UPDATE messages
                SET
                    message = ?,
                    is_edited = 1,
                    created_at = NOW()

                WHERE id = ?

                AND sender_id = ?

                AND sender_type = ?

                AND is_deleted = 0
                `,
                    [
                        cleanMessage,
                        id,
                        senderId,
                        senderType
                    ]
                );


            if (
                updateResult.affectedRows === 0
            ) {

                console.log(
                    "Message was not edited:",
                    id
                );

                return;
            }

            // EDIT EVENT DATA
            const editData = {
                messageId: id,
                message: cleanMessage,
                isEdited: true,
                editedAt: new Date()
            };

            // UPDATE SENDER
            socket.emit(
                "chat-message-edited",
                editData
            );

            // FIND RECIPIENT
            const [receiverRows] =
                await db.promise().query(
                    `
                SELECT
                    token

                FROM users

                WHERE id = ?

                AND acc_type = ?

                LIMIT 1
                `,
                    [
                        msg.receiver_id,
                        msg.receiver_type
                    ]
                );

            // UPDATE RECIPIENT
            if (receiverRows.length) {

                const receiverToken =
                    receiverRows[0].token;


                const onlineRecipient =
                    onlineUsers[receiverToken];


                if (onlineRecipient) {

                    onlineRecipient.sockets.forEach(
                        socketId => {

                            io.to(socketId).emit(
                                "chat-message-edited",
                                editData
                            );

                        }
                    );

                }

            }


            console.log(
                "CHAT MESSAGE EDITED:",
                editData
            );


        } catch (error) {

            console.error(
                "edit-chat-message error:",
                error
            );

        }

    });
});





server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});