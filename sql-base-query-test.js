const Database = require('./index.js');
const db = Database.start();

const values = {
    description: 'Teste',
    order: null,
    mandatory: false
}

const tableName = 'dynamicFields';

db.update(tableName, values)
    .then(()=>{
        console.log(values);
    })