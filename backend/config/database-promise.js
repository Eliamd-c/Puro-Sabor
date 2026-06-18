const util = require('util');
const db = require('./database');

const dbAsync = {
  run: function(sql, params) {
    return new Promise((resolve, reject) => {
      db.run(sql, params || [], function(err) {
        if (err) reject(err);
        else resolve(this); // 'this' contains lastID and changes
      });
    });
  },
  get: util.promisify(db.get.bind(db)),
  all: util.promisify(db.all.bind(db))
};

module.exports = dbAsync;
