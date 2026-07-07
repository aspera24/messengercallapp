const db = require("../config/db.config");

module.exports = (req, res, next) => {

    console.log("Cookies:", req.cookies);
    console.log("Token:", req.cookies.meetflow_session);

    const token = req.cookies.meetflow_session;

    if (!token) {
        return res.redirect("/auth");
    }

    db.query(
        `
        SELECT
            users.id,
            users.firstname,
            users.lastname,
            users.username,
            users.acc_type,
            users.token
        FROM sessions
        INNER JOIN users
            ON sessions.user_id = users.id
        WHERE
            sessions.token = ?
            AND sessions.expires_at > NOW()
        `,
        [token],
        (err, result) => {

            if (err || result.length === 0) {

                res.clearCookie("meetflow_session");

                return res.redirect("/auth");

            }

            req.user = result[0];

            next();

        }
    );

};