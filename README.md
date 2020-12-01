# SQL Base Query
A simple SQL database query constructor.

# Conexão
To connect to the database, start an instance with a configuration object.
```javascript
const Database = require('@goori-soft/sql-base-query');
const db = new Database({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
```
