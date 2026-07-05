const express = require("express");
const router = express.Router();
const db = require("../config/db.config");


// HOME
// router.get("/", (req, res) => {

//     if (req.session?.user) {
//         return res.redirect("/dashboard");
//     }

//     res.redirect("/auth");
// });

router.get("/", (req, res) => {
    res.redirect("/auth");
});


// LOGIN PAGE
// router.get("/auth", (req, res) => {

//     if (req.session?.user) {
//         return res.redirect("/dashboard");
//     }

//     res.sendFile(process.cwd() + "/public/auth.html");
// });

router.get("/auth", (req, res) => {

    console.log("AUTH ROUTE CALLED");

    res.sendFile(process.cwd() + "/public/auth.html");

});

// DASHBOARD PAGE
// router.get("/dashboard", (req, res) => {
//     if (!req.session?.user) {
//         return res.redirect("/auth");
//     }

//     res.sendFile(process.cwd() + "/public/dashboard.html");
// });

router.get("/dashboard", (req, res) => {

    console.log("DASHBOARD ROUTE CALLED");

    res.sendFile(process.cwd() + "/public/dashboard.html");

});


// AUTH CHECK
// router.get("/auth/check", (req, res) => {

//     if (req.session?.user) {
//         return res.json({
//             authenticated: true
//         });
//     }

//     res.status(401).json({
//         authenticated: false
//     });
// });


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

            res.json({
                success: true,
                token: user.token,
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
});


// SESSION
router.get("/session", (req, res) => {

    const auth = req.headers.authorization;

    if (!auth) {
        return res.json({
            logged: false
        });
    }

    const token = auth.replace("Bearer ", "");

    db.query(
        "SELECT id, firstname, lastname, username, acc_type FROM users WHERE token = ?",
        [token],
        (err, result) => {

            if (err || result.length === 0) {
                return res.json({
                    logged: false
                });
            }

            res.json({
                logged: true,
                user: result[0]
            });

        }
    );

});


// LOGOUT
router.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/auth");
    });
});



// WIDGET
// router.get("/widget", (req, res) => {

//     if (!req.session?.user) {
//         return res.sendFile(process.cwd() + "/public/auth.html");
//     }

//     res.sendFile(process.cwd() + "/public/dashboard.html");

// });

router.get("/widget", (req, res) => {
    res.sendFile(process.cwd() + "/public/dashboard.html");
});


module.exports = router;