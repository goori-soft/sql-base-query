# SQL Base Query
A simple SQL database query constructor.

# Installation
To install this module using npm
```
npm install @goori-soft/sql-base-query
```

# Connection
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
# How to use it
This module, after being instantiated, has basic functions for querying and modifying tables in a MySQL database.

The main methods of the instance are:
| Method | Parameters | Description |
| --- | --- | --- |
| create | tableName: String, fields: Object, delta: Boolean, callback: Function | Create a new table in the database. If delta is true and the table already exists, defined fields that do not yet exist will be added to the table. |
| add | tableName: String, fields: Object, callback: Function | Adds new fields to an existing table. |
| select | tableName: String, where: Object, options: Object, callback: Function | Executes a select query in the database on a given table. |
| insert | tableName: String, values: [Object], callback: Function | Executes an insert query on a given table. |
| update | tableName: String, values: Object, where: Object, options: Object, callback: Function | Executes an update query on a given table. |
| delete | tableName: String, where: Object, options: Object, callback: Function | Executes a delete query on a given table. |
> Note: all of these methods work asynchronously and therefore return a promise.

```javascript
const fields = {
    id: {type: 'number', primary: true},
    name: {type: 'string', size: 100},
    email: {type: 'string'}
    memo: {type: 'text'}
    age: {type: 'number'}
}

db.create('example', fields, true)
    .then(()=>{
        console.log('Table example has been created!');
    })
    .catch(err=>{
        console.log(err);
    })
```

# Setting up a query
It is possible, before executing a query, to request only its assembly. To do this, use the methods in ** mountQuery **.

mountQuery has mount methods for add, create, drop, select, insert and update queries.
```javascript
const tableName = 'example';

const insert = [
    {name: 'Johnny', age: 45},
    {age: 20},
    {email: 'me@email.com', name: "O'Brian"}
];

db.mountQuery.insert(tableName, insert)
    .then(query => {
        console.log(query);
    })
    .catch(err => {
        console.log(err);
    })
```