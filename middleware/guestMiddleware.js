
const db = require("../config/db.config");

module.exports = (req, res, next) => {

    const token = req.cookies?.meetflow_session;

    if (!token) {
        return next();
    }

    db.query(
        `
        SELECT id
        FROM sessions
        WHERE token = ?
        AND expires_at > NOW()
        `,
        [token],
        (err, result) => {

            // Database unavailable: do not destroy the session
            if (err) {
                console.error(
                    "GUEST AUTH DATABASE ERROR:",
                    err.code,
                    err.message
                );

                return res.status(503).send(
                    "Authentication service temporarily unavailable. Please try again."
                );
            }

            // No valid session: allow the login page to load
            if (!result || result.length === 0) {
                res.clearCookie("meetflow_session", {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/"
                });

                return next();
            }

            return res.redirect("/dashboard");
        }
    );

};
