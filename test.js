require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE
});

db.connect(err => {
    if (err) {
        return console.log(err);
    }

    console.log("CONNECTED");

    setInterval(() => {
        db.query("SELECT NOW()", (err, rows) => {
            console.log(err || rows);
        });
    }, 5000);
});