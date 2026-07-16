const express = require("express");
const router = express.Router();
const db = require("../config/db.config");
const crypto = require("crypto");
const authMiddleware = require("../middleware/authMiddleware");
const guestMiddleware = require("../middleware/guestMiddleware");

router.get("/", guestMiddleware, (req, res) => {
    res.redirect("/auth");
});

router.get("/auth", guestMiddleware, (req, res) => {
    console.log("AUTH ROUTE CALLED");
    res.sendFile(process.cwd() + "/public/auth.html");
});


router.get("/dashboard", authMiddleware, (req, res) => {
    console.log("LOGGED USER:", req.user);
    res.sendFile(
        process.cwd() + "/public/dashboard.html"
    );
}
);


router.get("/me", authMiddleware, (req, res) => {

    res.json({
        success: true,
        user: req.user
    });

});


// LOGIN
router.post("/login", (req, res) => {

    console.log("LOGIN REQUEST RECEIVED");
    console.log(req.body);

    const { username, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE username = ?",
        [username],
        (err, result) => {

            if (err) {
                return res.status(500).json({
                    success: false
                });
            }

            if (!result.length) {
                return res.json({
                    success: false,
                    message: "Invalid username"
                });
            }

            const user = result[0];

            if (user.password !== password) {
                return res.json({
                    success: false,
                    message: "Invalid password"
                });
            }


            // req.session.user = {
            //     id: user.id,
            //     firstname: user.firstname,
            //     lastname: user.lastname,
            //     username: user.username,
            //     acc_type: user.acc_type,
            //     token: user.token
            // };



            // req.session.save((err) => {

            //     if (err) {
            //         return res.status(500).json({
            //             success: false
            //         });
            //     }

            //     res.json({
            //         success: true,
            //         token: user.token,
            //         user: req.session.user
            //     });

            // });

            const sessionToken = crypto.randomUUID();

            const expiresAt = new Date(
                Date.now() + (24 * 60 * 60 * 1000)
            );

            db.query(
                `INSERT INTO sessions
                (user_id, token, expires_at)
                VALUES (?, ?, ?)`,
                [
                    user.id,
                    sessionToken,
                    expiresAt
                ],
                (err) => {

                    if (err) {
                        console.error(err);

                        return res.status(500).json({
                            success: false,
                            err: JSON.stringify(err),
                        });
                    }

                    res.cookie(
                        "meetflow_session",
                        sessionToken,
                        {
                            httpOnly: true,
                            secure: true,
                            sameSite: "None",
                            maxAge: 24 * 60 * 60 * 1000
                        }
                    );

                    res.json({
                        success: true,
                        user: {
                            id: user.id,
                            firstname: user.firstname,
                            lastname: user.lastname,
                            username: user.username,
                            acc_type: user.acc_type
                        }
                    });

                }
            );

        }
    );
});


// LOGOUT
router.get("/logout", authMiddleware, (req, res) => {

    const token = req.cookies.meetflow_session;

    db.query(
        "DELETE FROM sessions WHERE token = ?",
        [token],
        (err) => {

            if (err) {
                return res.status(500).send("Logout failed.");
            }

            res.clearCookie("meetflow_session");

            res.redirect("/auth");

        }
    );

});



// WIDGET
router.get("/widget", (req, res) => {
    res.sendFile(process.cwd() + "/public/dashboard.html");
});


module.exports = router;