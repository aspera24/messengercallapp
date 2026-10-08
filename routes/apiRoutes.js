module.exports = (io, onlineUsers, joinedUsersInMeeting) => {
    const express = require("express");
    const router = express.Router();
    const db = require("../config/db.config");
    const authMiddleware = require("../middleware/authMiddleware");
    const crypto = require("crypto");
    const multer = require("multer");
    const sharp = require("sharp");
    const ENCRYPTION_KEY = Buffer.from(process.env.CHAT_ENCRYPTION_KEY, 'hex');
    // const IV_LENGTH = 16;

    const uploadProfilePicture = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 10 * 1024 * 1024
        },
        fileFilter: (req, file, cb) => {

            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/webp"
            ];

            if (!allowedTypes.includes(file.mimetype)) {
                return cb(
                    new Error(
                        "Only JPG, PNG and WEBP images are allowed."
                    )
                );
            }

            cb(null, true);

        }
    });

    function decryptMessage(encryptedText, ivHex) {
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    router.get("/messages/:token", async (req, res) => {

        try {

            const otherToken = req.params.token;

            const limit = Math.min(
                Math.max(
                    parseInt(req.query.limit) || 30,
                    1
                ),
                50
            );

            const cursor = req.query.cursor
                ? parseInt(req.query.cursor)
                : null;


            // GET CURRENT USER
            const sessionToken =
                req.cookies?.meetflow_session;

            if (!sessionToken) {
                return res.status(401).json({
                    error: "Unauthorized"
                });
            }


            const [currentRows] =
                await db.promise().query(
                    `
                    SELECT
                        u.id,
                        u.token,
                        u.acc_type
                    FROM sessions s
                    INNER JOIN users u
                        ON s.user_id = u.id
                    WHERE s.token = ?
                    LIMIT 1
                    `,
                    [sessionToken]
                );


            if (!currentRows.length) {
                return res.status(401).json({
                    error: "Unauthorized"
                });
            }


            const currentUser =
                currentRows[0];


            // GET OTHER USER
            const [otherRows] =
                await db.promise().query(
                    `
                    SELECT
                        id,
                        token,
                        acc_type,
                        firstname,
                        lastname
                    FROM users
                    WHERE token = ?
                    AND is_active = 1
                    LIMIT 1
                    `,
                    [otherToken]
                );


            if (!otherRows.length) {
                return res.status(404).json({
                    error: "User not found"
                });
            }


            const otherUser =
                otherRows[0];


            // MESSAGE QUERY
            let sql = `
                SELECT
                id,
                sender_type,
                sender_id,
                receiver_type,
                receiver_id,
                message,
                encryption_iv, 
                is_deleted,
                is_edited,
                is_read,
                created_at,

                CASE
                    WHEN created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                    THEN 1
                    ELSE 0
                END AS canEdit

                FROM messages

                WHERE
                (
                    (
                        sender_type = ?
                        AND sender_id = ?
                        AND receiver_type = ?
                        AND receiver_id = ?
                    )
                    OR
                    (
                        sender_type = ?
                        AND sender_id = ?
                        AND receiver_type = ?
                        AND receiver_id = ?
                    )
                )
            `;


            const params = [
                // CURRENT → OTHER
                currentUser.acc_type,
                currentUser.id,
                otherUser.acc_type,
                otherUser.id,

                // OTHER → CURRENT
                otherUser.acc_type,
                otherUser.id,
                currentUser.acc_type,
                currentUser.id
            ];


            // =========================
            // CURSOR
            // =========================
            if (cursor) {
                sql += `
                AND id < ?
            `;
                params.push(cursor);
            }


            // =========================
            // GET NEWEST FIRST
            // =========================
            sql += `
                ORDER BY id DESC
                LIMIT ?
            `;
            params.push(limit);


            const [rows] =
                await db.promise().query(
                    sql,
                    params
                );


            // =========================
            // OLDEST → NEWEST
            // =========================
            rows.reverse();


            // ===========================================
            // DECRYPTION LOGIC and DATA PARSING
            // ===========================================
            rows.forEach(row => {

                // Checking of message owner
                row.isMine =
                    row.sender_type === currentUser.acc_type &&
                    row.sender_id === currentUser.id;

                // Decryption happens when the message is not deleted and has an encryption_iv
                if (Number(row.is_deleted) === 1) {
                    row.message = "This message was deleted.";
                } else if (row.message && row.encryption_iv) {
                    try {
                        row.message = decryptMessage(row.message, row.encryption_iv);
                    } catch (decryptErr) {
                        console.log("--- DECRYPTION DEBUG LINE ---");
                        console.error(`Error sa ID ${row.id}:`, decryptErr.message);
                        console.log("Message String:", row.message);
                        console.log("IV String:", row.encryption_iv);

                        row.message = row.message;
                    }

                }

                // Remove 'encryption_iv' from the object before sending the response
                // to prevent it from being exposed in the frontend/browser UI network tab.
                delete row.encryption_iv;

            });



            // =========================
            // NEXT CURSOR
            // =========================
            const nextCursor =
                rows.length > 0
                    ? rows[0].id
                    : null;


            // =========================
            // HAS MORE
            // =========================
            let hasMore = false;

            if (nextCursor !== null) {

                const [moreRows] =
                    await db.promise().query(
                        `
                        SELECT id
                        FROM messages
                        WHERE id < ?
                        AND
                        (
                            (
                                sender_type = ?
                                AND sender_id = ?
                                AND receiver_type = ?
                                AND receiver_id = ?
                            )
                            OR
                            (
                                sender_type = ?
                                AND sender_id = ?
                                AND receiver_type = ?
                                AND receiver_id = ?
                            )
                        )
                        LIMIT 1
                        `,
                        [
                            nextCursor,
                            // CURRENT → OTHER
                            currentUser.acc_type,
                            currentUser.id,
                            otherUser.acc_type,
                            otherUser.id,
                            // OTHER → CURRENT
                            otherUser.acc_type,
                            otherUser.id,
                            currentUser.acc_type,
                            currentUser.id
                        ]
                    );

                hasMore =
                    moreRows.length > 0;
            }


            // =========================
            // RESPONSE
            // =========================
            res.json({
                messages: rows,
                nextCursor,
                hasMore
            });


        } catch (error) {
            console.error(
                "GET CHAT MESSAGES ERROR:",
                error
            );

            res.status(500).json({
                error: "Failed to load messages"
            });
        }
    });

    router.get("/unread-count/:token", authMiddleware, async (req, res) => {
        try {
            const currentUserId = Number(req.user.id);
            const senderToken = String(req.params.token || "").trim();

            if (!currentUserId || !senderToken) {
                return res.status(400).json({
                    success: false,
                    count: 0,
                    message: "Invalid user or sender token"
                });
            }

            const [rows] = await db.promise().query(
                `
                SELECT COUNT(*) AS count
                FROM messages AS m
                INNER JOIN users AS sender
                    ON sender.id = m.sender_id
                WHERE m.receiver_id = ?
                AND sender.token = ?
                AND m.is_read = 0
                AND m.is_deleted = 0
                `,
                [
                    currentUserId,
                    senderToken
                ]
            );

            const unreadCount = Number(rows[0]?.count) || 0;

            return res.status(200).json({
                success: true,
                count: unreadCount
            });

        } catch (error) {
            console.error("[UNREAD COUNT ERROR]", error);

            return res.status(500).json({
                success: false,
                count: 0,
                message: "Failed to get unread message count"
            });
        }
    });

    router.get("/users", authMiddleware, (req, res) => {

        const currentUser = req.user;

        if (!currentUser) {
            return res.status(401).json({
                error: "Unauthorized"
            });
        }

        let targetAccType;

        // Admin → fetch employees
        if (currentUser.acc_type === "admin") {
            targetAccType = "employee";
        }

        // Employee → fetch admins
        else if (currentUser.acc_type === "employee") {
            targetAccType = "admin";
        }

        // Unknown account type
        else {
            return res.status(403).json({
                error: "Invalid account type"
            });
        }


        db.query(
            `
        SELECT
            token,
            firstname,
            lastname,
            acc_type
        FROM users
        WHERE acc_type = ?
        AND is_active = 1
        `,
            [targetAccType],
            (err, result) => {

                if (err) {

                    console.error(
                        "GET USERS ERROR:",
                        err
                    );

                    return res.status(500).json({
                        error: "Failed to fetch users"
                    });

                }


                const users = result.map(user => ({
                    ...user,
                    joined: !!joinedUsersInMeeting[user.token],
                    online: Boolean(onlineUsers[user.token])
                }));


                res.json(users);

            }
        );

    });

    router.post("/add-employee", authMiddleware, (req, res) => {

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

    router.get("/missed-calls", authMiddleware, (req, res) => {

        const limit = Math.min(
            parseInt(req.query.limit) || 10,
            20
        );

        const cursor =
            req.query.cursor || null;


        let query = `
        SELECT
            mr.id,
            mr.room_token,
            mr.created_at,
            u.firstname,
            u.lastname
        FROM meeting_requests mr
        INNER JOIN users u
            ON u.id = mr.from_user_id
        WHERE
            mr.to_user_id = ?
            AND mr.status = 'expired'
    `;


        const params = [
            req.user.id
        ];


        /*
         * CURSOR
         */

        if (cursor) {

            const parts =
                cursor.split("|");


            const cursorCreatedAt =
                parts[0];

            const cursorId =
                parts[1];


            if (
                !cursorCreatedAt ||
                !cursorId
            ) {

                return res.status(400).json({
                    error: "Invalid cursor"
                });

            }


            query += `
            AND (
                mr.created_at < ?
                OR (
                    mr.created_at = ?
                    AND mr.id < ?
                )
            )
        `;


            params.push(
                cursorCreatedAt,
                cursorCreatedAt,
                cursorId
            );

        }


        query += `
        ORDER BY
            mr.created_at DESC,
            mr.id DESC

        LIMIT ?
    `;


        /*
         * +1 para mahibaw-an nato
         * kung naa pa bay next page.
         */

        params.push(
            limit + 1
        );


        db.query(
            query,
            params,
            (err, result) => {

                if (err) {

                    console.error(
                        "Missed calls error:",
                        err
                    );

                    return res.status(500).json({
                        error:
                            "Failed to load missed calls"
                    });

                }


                const hasMore =
                    result.length > limit;


                const calls =
                    hasMore
                        ? result.slice(0, limit)
                        : result;


                let nextCursor = null;


                if (
                    hasMore &&
                    calls.length
                ) {

                    const lastCall =
                        calls[
                        calls.length - 1
                        ];


                    nextCursor =
                        `${new Date(
                            lastCall.created_at
                        ).toISOString()}|${lastCall.id}`;

                }


                res.json({

                    calls,

                    hasMore,

                    nextCursor

                });

            }
        );

    });

    router.get("/profile", authMiddleware, (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        db.query(
            `
            SELECT
                id,
                firstname,
                lastname,
                username,
                created_at

            FROM users

            WHERE id = ?
            AND is_active = 1

            LIMIT 1
            `,
            [userId],

            (err, result) => {

                if (err) {

                    console.error(
                        "GET PROFILE ERROR:",
                        err
                    );

                    return res.status(500).json({
                        message: "Failed to load profile."
                    });

                }


                if (!result.length) {

                    return res.status(404).json({
                        message: "User not found."
                    });

                }


                const user = result[0];


                res.json({

                    id: user.id,

                    first_name: user.firstname,

                    last_name: user.lastname,

                    username: user.username,

                    created_at: user.created_at

                });

            }
        );

    });

    router.put("/profile", authMiddleware, (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        let {
            first_name,
            last_name,
            username
        } = req.body;


        // =========================
        // CLEAN INPUT
        // =========================

        first_name =
            typeof first_name === "string"
                ? first_name.trim()
                : "";

        last_name =
            typeof last_name === "string"
                ? last_name.trim()
                : "";

        username =
            typeof username === "string"
                ? username.trim()
                : "";


        // =========================
        // VALIDATION
        // =========================

        if (
            !first_name ||
            !last_name ||
            !username
        ) {

            return res.status(400).json({
                message: "First name, last name and username are required."
            });

        }


        if (first_name.length > 100) {

            return res.status(400).json({
                message: "First name is too long."
            });

        }


        if (last_name.length > 100) {

            return res.status(400).json({
                message: "Last name is too long."
            });

        }


        if (username.length < 3) {

            return res.status(400).json({
                message: "Username must be at least 3 characters."
            });

        }


        if (username.length > 50) {

            return res.status(400).json({
                message: "Username is too long."
            });

        }


        // Only allow normal username characters
        if (!/^[a-zA-Z0-9._-]+$/.test(username)) {

            return res.status(400).json({
                message:
                    "Username can only contain letters, numbers, dots, underscores and hyphens."
            });

        }


        // =========================
        // CHECK USERNAME
        // =========================

        db.query(
            `
            SELECT id

            FROM users

            WHERE username = ?

            AND id != ?

            LIMIT 1
            `,
            [
                username,
                userId
            ],

            (err, existingUser) => {

                if (err) {

                    console.error(
                        "CHECK PROFILE USERNAME ERROR:",
                        err
                    );

                    return res.status(500).json({
                        message: "Failed to validate username."
                    });

                }


                if (existingUser.length > 0) {

                    return res.status(409).json({
                        message: "Username already exists."
                    });

                }


                // =========================
                // UPDATE PROFILE
                // =========================

                db.query(
                    `
                    UPDATE users

                    SET
                        firstname = ?,
                        lastname = ?,
                        username = ?

                    WHERE id = ?
                    `,
                    [
                        first_name,
                        last_name,
                        username,
                        userId
                    ],

                    (err) => {

                        if (err) {

                            console.error(
                                "UPDATE PROFILE ERROR:",
                                err
                            );

                            return res.status(500).json({
                                message: "Failed to update profile."
                            });

                        }


                        res.json({

                            success: true,

                            message:
                                "Profile updated successfully."

                        });

                    }
                );

            }
        );

    });

    router.put("/profile/password", authMiddleware, (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        let {
            current_password,
            new_password
        } = req.body;


        // =========================
        // CLEAN INPUT
        // =========================

        current_password =
            typeof current_password === "string"
                ? current_password
                : "";

        new_password =
            typeof new_password === "string"
                ? new_password
                : "";


        // =========================
        // VALIDATION
        // =========================

        if (
            !current_password ||
            !new_password
        ) {

            return res.status(400).json({
                message:
                    "Current password and new password are required."
            });

        }


        if (new_password.length < 8) {

            return res.status(400).json({
                message:
                    "New password must be at least 8 characters."
            });

        }


        if (new_password.length > 255) {

            return res.status(400).json({
                message:
                    "New password is too long."
            });

        }


        if (
            current_password ===
            new_password
        ) {

            return res.status(400).json({
                message:
                    "New password must be different from your current password."
            });

        }


        // =========================
        // GET CURRENT PASSWORD
        // =========================

        db.query(
            `
                SELECT
                    id,
                    password

                FROM users

                WHERE id = ?

                AND is_active = 1

                LIMIT 1
                `,
            [userId],

            (err, result) => {

                if (err) {

                    console.error(
                        "GET CURRENT PASSWORD ERROR:",
                        err
                    );

                    return res.status(500).json({
                        message:
                            "Failed to verify password."
                    });

                }


                if (!result.length) {

                    return res.status(404).json({
                        message: "User not found."
                    });

                }


                const user =
                    result[0];


                // =========================
                // VERIFY CURRENT PASSWORD
                // =========================

                if (
                    current_password !==
                    user.password
                ) {

                    return res.status(401).json({
                        message:
                            "Current password is incorrect."
                    });

                }


                // =========================
                // UPDATE PASSWORD
                // =========================

                db.query(
                    `
                        UPDATE users

                        SET password = ?

                        WHERE id = ?
                        `,
                    [
                        new_password,
                        userId
                    ],

                    (err) => {

                        if (err) {

                            console.error(
                                "UPDATE PASSWORD ERROR:",
                                err
                            );

                            return res.status(500).json({
                                message:
                                    "Failed to change password."
                            });

                        }


                        res.json({

                            success: true,

                            message:
                                "Password changed successfully."

                        });

                    }
                );

            }
        );

    }
    );

    router.get("/profile/picture", authMiddleware, async (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        try {

            const [rows] =
                await db.promise().query(
                    `
                    SELECT
                        profile_picture,
                        profile_picture_type

                    FROM users

                    WHERE id = ?
                    AND is_active = 1

                    LIMIT 1
                    `,
                    [userId]
                );


            if (!rows.length) {

                return res.status(404).json({
                    message: "User not found."
                });

            }


            const user = rows[0];


            if (!user.profile_picture) {

                return res.status(404).end();

            }


            res.setHeader(
                "Content-Type",
                user.profile_picture_type ||
                "image/jpeg"
            );

            res.setHeader(
                "Cache-Control",
                "private, max-age=300"
            );


            return res.send(
                user.profile_picture
            );


        } catch (error) {

            console.error(
                "GET PROFILE PICTURE ERROR:",
                error
            );


            return res.status(500).json({
                message:
                    "Failed to load profile picture."
            });

        }

    }
    );

    router.get("/profile/picture/full", authMiddleware, async (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        try {

            const [rows] =
                await db.promise().query(
                    `
                    SELECT
                        profile_picture_full,
                        profile_picture_type

                    FROM users

                    WHERE id = ?
                    AND is_active = 1

                    LIMIT 1
                    `,
                    [userId]
                );


            if (!rows.length) {

                return res.status(404).end();

            }


            const user = rows[0];


            if (!user.profile_picture_full) {

                return res.status(404).end();

            }


            res.setHeader(
                "Content-Type",
                user.profile_picture_type ||
                "image/jpeg"
            );

            res.setHeader(
                "Cache-Control",
                "private, max-age=300"
            );


            return res.send(
                user.profile_picture_full
            );


        } catch (error) {

            console.error(
                "GET FULL PROFILE PICTURE ERROR:",
                error
            );


            return res.status(500).json({
                message:
                    "Failed to load full profile picture."
            });

        }

    }
    );

    router.put("/profile/picture", authMiddleware, uploadProfilePicture.single("profilePicture"),
        async (req, res) => {

            const userId = req.user?.id;

            if (!userId) {

                return res.status(401).json({
                    message: "Unauthorized"
                });

            }


            if (!req.file) {

                return res.status(400).json({
                    message:
                        "Please select a profile picture."
                });

            }


            try {

                /*
                 * =========================
                 * CREATE THUMBNAIL
                 * =========================
                 */

                const thumbnail =
                    await sharp(req.file.buffer)
                        .rotate()
                        .resize(160, 160, {
                            fit: "cover",
                            position: "centre"
                        })
                        .jpeg({
                            quality: 60,
                            mozjpeg: true
                        })
                        .toBuffer();


                /*
                 * =========================
                 * CREATE FULL IMAGE
                 * =========================
                 */

                const fullImage =
                    await sharp(req.file.buffer)
                        .rotate()
                        .resize(1200, 1200, {
                            fit: "inside",
                            withoutEnlargement: true
                        })
                        .jpeg({
                            quality: 85,
                            mozjpeg: true
                        })
                        .toBuffer();


                /*
                 * =========================
                 * SAVE TO DATABASE
                 * =========================
                 */

                await db.promise().query(
                    `
                    UPDATE users

                    SET
                        profile_picture = ?,
                        profile_picture_full = ?,
                        profile_picture_type = ?

                    WHERE id = ?

                    AND is_active = 1
                    `,
                    [
                        thumbnail,
                        fullImage,
                        "image/jpeg",
                        userId
                    ]
                );

                io.emit("profile-picture-updated", {
                    token: req.user.token
                });

                return res.json({

                    success: true,

                    message:
                        "Profile picture updated successfully."

                });

            } catch (error) {

                console.error(
                    "UPLOAD PROFILE PICTURE ERROR:",
                    error
                );


                return res.status(500).json({
                    message:
                        "Failed to update profile picture."
                });

            }

        }
    );

    router.delete("/profile/picture", authMiddleware, async (req, res) => {

        const userId = req.user?.id;

        if (!userId) {

            return res.status(401).json({
                message: "Unauthorized"
            });

        }


        try {

            await db.promise().query(
                `
                UPDATE users

                SET
                    profile_picture = NULL,
                    profile_picture_full = NULL,
                    profile_picture_type = NULL

                WHERE id = ?

                AND is_active = 1
                `,
                [userId]
            );


            return res.json({

                success: true,

                message:
                    "Profile picture removed successfully."

            });


        } catch (error) {

            console.error(
                "DELETE PROFILE PICTURE ERROR:",
                error
            );


            return res.status(500).json({
                message:
                    "Failed to remove profile picture."
            });

        }

    }
    );

    router.get("/profile/picture/:token", authMiddleware, async (req, res) => {

        try {

            const token =
                String(req.params.token || "").trim();

            if (!token) {

                return res.status(400).end();

            }


            const [rows] =
                await db.promise().query(
                    `
                    SELECT
                        profile_picture,
                        profile_picture_type

                    FROM users

                    WHERE token = ?
                    AND is_active = 1

                    LIMIT 1
                    `,
                    [token]
                );


            if (!rows.length) {

                return res.status(404).end();

            }


            const user = rows[0];


            if (!user.profile_picture) {

                return res.status(404).end();

            }


            res.setHeader(
                "Content-Type",
                user.profile_picture_type ||
                "image/jpeg"
            );

            res.setHeader(
                "Cache-Control",
                "private, max-age=300"
            );


            return res.send(
                user.profile_picture
            );


        } catch (error) {

            console.error(
                "GET USER PROFILE PICTURE ERROR:",
                error
            );


            return res.status(500).end();

        }

    }
    );


    return router
}