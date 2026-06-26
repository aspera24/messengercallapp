const mysql = require("mysql2");

// const db = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "meetflow",
//   timezone: "+08:00"
// });

const db = mysql.createPool({
  host: "mysql.railway.internal",
  user: "root",
  password: "vpOHwWMKoHKAvjDOJNkemhOvrfowTdgT",
  database: "railway",
  timezone: "+08:00"
});

db.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'");
});

module.exports = db;