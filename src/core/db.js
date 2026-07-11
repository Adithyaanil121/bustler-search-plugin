const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const knex = require('knex');

const config = process.env.DATABASE_URL
  ? {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      searchPath: ['knex', 'public'],
    }
  : {
      client: 'sqlite3',
      connection: {
        filename: path.join(__dirname, '../../data/cache/test_database.sqlite')
      },
      useNullAsDefault: true
    };

const db = knex(config);

module.exports = db;
