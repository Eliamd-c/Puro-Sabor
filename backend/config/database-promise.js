const util = require('util');
const db = require('./database');

const dbAsync = {
  run: util.promisify(db.run.bind(db)),
  get: util.promisify(db.get.bind(db)),
  all: util.promisify(db.all.bind(db))
};

module.exports = dbAsync;
