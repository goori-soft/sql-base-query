const Database = require('./index.js');
const db = Database.start();

// db.create('myTable', {
//     id: {
//         name: 'myTableID',
//         notNull: true,
//         type: Database.types.INT,
//         size: 2,
//         primary: true,
//         autoIncrment: true
//     },
//     name: {
//         type: Database.types.TEXT,
//         size: 30,
//         default: 'John O\'Conner'
//     },
// });

// db.getSchema('wp_posts').then(result=>{
//     result.fields.my_field2 = {
//         type: Database.types.STRING,
//         size: 100
//     }

//     db.create('user_copy', result.fields, true).then(()=>{
//         console.log('Tudo certo por aqui!');
//     }).catch(err=>{
//         console.log(err);
//     });
// }).catch(err=>{
//     console.log('ops');
// });

db.select('wp_users', {id: 1}, false, (resp)=>{
    console.log(resp);
});