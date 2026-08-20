const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const db = require("../config/db.config");

router.get("/profile-info", authMiddleware, (req, res) => {
    res.sendFile(process.cwd() + "/public/profile.html");
});


module.exports = router;