require('dotenv').config();
const knex = require('knex');
const path = require('path');

const config = process.env.DATABASE_URL
  ? {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      searchPath: ['knex', 'public'],
    }
  : {
      client: 'sqlite3',
      connection: {
        filename: path.join(__dirname, 'test_database.sqlite')
      },
      useNullAsDefault: true
    };

const db = knex(config);

module.exports = db;
