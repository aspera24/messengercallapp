const db = require("../config/db.config");

module.exports = (req, res, next) => {

    console.log("COOKIE:", req.cookies);

    const token = req.cookies.meetflow_session;

    console.log("TOKEN:", token);

    if (!token) {
        console.log("NO COOKIE");
        return next();
    }

    db.query(
        `SELECT id
         FROM sessions
         WHERE token = ?
         AND expires_at > NOW()`,
        [token],
        (err, result) => {

            console.log("DB ERROR:", err);
            console.log("DB RESULT:", result);

            if (err || result.length === 0) {
                res.clearCookie("meetflow_session");
                return res.redirect("/auth");
            }

            console.log("REDIRECT TO DASHBOARD");

            return res.redirect("/dashboard");

        }
    );

};