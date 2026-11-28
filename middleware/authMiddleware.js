
const db = require("../config/db.config");

module.exports = (req, res, next) => {

    const token = req.cookies?.meetflow_session;

    // No session cookie = unauthenticated
    if (!token) {
        return unauthorized();
    }

    function unauthorized() {
        if (
            req.path === "/me" ||
            req.xhr ||
            req.headers.accept?.includes("application/json")
        ) {
            return res.status(401).json({
                success: false,
                code: "INVALID_SESSION",
                message: "Unauthorized"
            });
        }

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

            // DATABASE ERROR: preserve the existing cookie
            if (err) {
                console.error("AUTH DATABASE ERROR:", err.code, err.message);

                return res.status(503).json({
                    success: false,
                    code: "DATABASE_UNAVAILABLE",
                    message: "Authentication service temporarily unavailable."
                });
            }

            // Valid query but no matching session
            if (!result || result.length === 0) {
                res.clearCookie("meetflow_session", {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/"
                });

                return unauthorized();
            }

            req.user = result[0];

            return next();
        }
    );
};
