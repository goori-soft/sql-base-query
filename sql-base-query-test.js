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

// let where = {
//     ID: [44, 45, "Lucas", null],
//     user_login: ['Lucas "o\'Kara"', 30, null]
// }

// let options = {
//     operator: 'and',
//     orderBy: 'id',
//     order: 'asc',
//     limit: 10
// }

// db.select('wp_users', where, options, (resp)=>{
//     console.log(resp);
// });

// let form = {
//     id: 100,
//     order: null,
//     title: 'Exemplo 1',
//     created_at: "2020-12-18T20:46:14.000Z",
// }

// db.update('dynamicForm', form, {id: form.id})
//     .then(result=>{
//         console.log(result);
//     })
//     .catch(err=>{
//         console.log(err);
//     })

// db.delete('dynamicForm', {id: 10})
//     .then((result)=>{
//         console.log(result);
//     })
//     .catch(err=>{
//         console.log(err);
//     });