
require("dotenv").config();

const mysql = require("mysql2");

const db = mysql.createPool({

    host: process.env.MYSQLHOST,
    port: Number(process.env.MYSQLPORT),
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,

    timezone: "+08:00",

    waitForConnections: true,
    connectionLimit: 20,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,

    connectTimeout: 20000,

    enableKeepAlive: true,
    keepAliveInitialDelay: 0

});

// Set MySQL timezone for each new connection
db.on("connection", (connection) => {

    connection.query("SET time_zone = '+08:00'", (err) => {
        if (err) {
            console.error("MYSQL TIMEZONE ERROR:", err.message);
        }
    });

});

// Database connection errors
db.on("error", (err) => {

    console.error("=== MYSQL CONNECTION ERROR ===");
    console.error("Code:", err.code);
    console.error("Fatal:", err.fatal);
    console.error("Message:", err.message);

});

module.exports = db;
