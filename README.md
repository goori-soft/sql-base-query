# SQL Base Query (BETA)
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
| count | tableName: String, where: Object, options: Object, callback: Function | Counts the number of rows in a given table. Returns an INT value. |
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
    email: {type: 'string'},
    memo: {type: 'text'},
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

# Inputters e Resolvers
Inputters and Resolvers are functions that handle the input or output values ​​of SQL queries when using the insert, update or select (where) methods.

It is possible to define an inputter or resolver for each field in each table by manipulating the data before it is inserted or returned in a query. The following example shows an inputter that converts all input from object format to a string, making the process of storing complex data simpler.

Suppose the following table `clients` in our database:
| Campo | Tipo |
| --- | --- |
| ID | number |
| name | String |
| options | String |
| width | number |
| hight | number |

In this case we want to store in the `options` field an object converted to a string (stringfy). To simplify the writing process and centralize the input data validation method, we can create an inputter for this field.

```javascript
db.setInputter("clients", "options", (value) => {
    if(!value) return null;
    let input = null;
    try{
        input = JSON.stringfy(value);
    }
    catch{
        //nothing to do here!
    }
    return input
});
```
We can now make a direct entry of an object making sure that a validation rule will be applied to it whenever the insert or update methods are called.

```javascript
let values = {
    name: "Maria",
    options: {color: "blue", size: "small"},
    width: 2,
    height: 3
}

db.insert("clients", values);
```
In this case, it would also be ideal to create a resolver so that the extracted value is automatically converted to an object.
```javascript
db.setResolver("clients", "options", (value)=>{
    if(value == "null" || value == "NULL") return null;
    if(!value) return null;
    let resolve = null;
    try{
        resolve = JSON.parse(value);
    }
    catch{
        //nothing to do here!
    }
    return resolve;
});

db.select("clients", {name: "Maria"})
    .then((result)=>{
        console.log(result);
    });
```
In addition, it is possible to create a resolver to return an additional field calculated from other data in the same query line result.
```javascript
db.setResolver("clients", "area", (value, row)=>{
    //value is undefined
    //because area is not a valid column
    return row.width * row.height;
});

db.select("clients", {name: "Maria"})
    .then((result)=>{
        let area = result[0].area;
        console.log(area); //shold be 6 at this point
    })
```
> Note: in this version resolvers and inputters do not work asynchronously, that is, they cannot return a promise. This feature should be applied soon.