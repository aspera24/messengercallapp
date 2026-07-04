const express = require("express");
const router = express.Router();
const db = require("../config/db.config");


// HOME
router.get("/", (req, res) => {

    if (req.session?.user) {
        return res.redirect("/dashboard");
    }

    res.redirect("/auth");
});


// LOGIN PAGE
router.get("/auth", (req, res) => {

    if (req.session?.user) {
        return res.redirect("/dashboard");
    }

    res.sendFile(process.cwd() + "/public/auth.html");
});


// DASHBOARD PAGE
router.get("/dashboard", (req, res) => {

    if (!req.session?.user) {
        return res.redirect("/auth");
    }

    res.sendFile(process.cwd() + "/public/dashboard.html");
});


// AUTH CHECK
router.get("/auth/check", (req, res) => {

    if (req.session?.user) {
        return res.json({
            authenticated: true
        });
    }

    res.status(401).json({
        authenticated: false
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


// SESSION
router.get("/session", (req, res) => {

    if (!req.session?.user) {
        return res.json({
            logged: false
        });
    }

    res.json({
        logged: true,
        user: req.session.user
    });
});


// LOGOUT
router.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/auth");
    });
});



// WIDGET
router.get("/widget", (req, res) => {

    if (!req.session?.user) {
        return res.sendFile(process.cwd() + "/public/auth.html");
    }

    res.sendFile(process.cwd() + "/public/dashboard.html");

});

module.exports = router;