require("dotenv").config();
const mysql = require("mysql2");

// const db = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "meetflow",
//   timezone: "+08:00"
// });

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  timezone: "+08:00",
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,

  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

db.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'");
});

setInterval(() => {

    db.getConnection((err, conn) => {

        if (err) {
            console.error("GET CONNECTION FAILED");
            console.error(err);
            return;
        }

        console.log("Connected Thread:", conn.threadId);

        conn.ping((err) => {

            if (err) {
                console.error("PING FAILED");
                console.error(err);
            } else {
                console.log("PING OK");
            }

            conn.release();

        });

    });

}, 10000);

db.on("error", (err) => {
    console.error("=== MYSQL CONNECTION ERROR ===");
    console.error("Code:", err.code);
    console.error("Fatal:", err.fatal);
    console.error("Message:", err.message);

    if (
        err.code === "PROTOCOL_CONNECTION_LOST" ||
        err.code === "ECONNRESET"
    ) {
        console.error("❌ Database connection lost!");
    }
});

module.exports = db;