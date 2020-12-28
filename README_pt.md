# SQL Base Query
Um simples contrutor de queries SQL.

# Instalação
Para instalar este módulo utilizando o npm
```
npm install @goori-soft/sql-base-query
```

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

# Como utilizar
Este módulo, apos instanciado, possui funções básicas de consulta e modificação de tabelas em uma base de dados MySQL.

Os principais métodos da instância são:
| Método | Parâmetros | Descrição |
| --- | --- | --- |
| create | tableName: String, fields: Object, delta: Boolean, callback: Function | Cria uma nova tabela na base de dados. Caso delta seja true e a tabela já exista, os campos definidos que ainda não existem serão adicionados à tabela. |
| add | tableName: String, fields: Object, callback: Function | Adiciona novos campos a uma tabela já existente. |
| select | tableName: String, where: Object, options: Object, callback: Function | Executa uma query do tipo select na base de dados sobre uma tabela determinada. |
| insert | tableName: String, values: [Object], callback: Function | Executa uma query do tipo insert em uma tabela específica |
| update | tableName: String, values: Object, where: Object, options: Object, callback: Function | Executa uma query do tipo update. |
| delete | tableName: String, where: Object, options: Object, callback: Function | Executa uma query do tipo delete. |

>  Nota: todos esses métodos funcionam de modo assincrono e por isso retornam uma promise.

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

# Montando uma query
É possível, antes de executar uma query, solicitar apenas sua montagem. Para isso utilize os métodos em **mountQuery**.

mountQuery possui métodos de montagem para add, create, drop, select, insert e update.
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
