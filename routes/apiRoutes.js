module.exports = (io, joinedUsersInMeeting) => {
    const express = require("express");
    const router = express.Router();
    const db = require("../config/db.config");
    const authMiddleware = require("../middleware/authMiddleware");
    const crypto = require("crypto");

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
                is_deleted,
                is_edited,
                is_read,
                created_at

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


            // =========================
            // IS MINE
            // =========================

            rows.forEach(row => {

                row.isMine =
                    row.sender_type === currentUser.acc_type &&
                    row.sender_id === currentUser.id;

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

                    joined:
                        !!joinedUsersInMeeting[user.token]

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

    router.put(
        "/profile/password",
        authMiddleware,
        (req, res) => {

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

    return router
}