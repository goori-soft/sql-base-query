# SQL Base Query
Um simples contrutor de queries SQL.

# Conexão
Para se conectar com a base de dados inicie uma instancia com um objeto de configuração.
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
