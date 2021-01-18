# SQL Base Query (BETA)
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
| count | tableName: String, where: Object, options: Object, callback: Function | Conta o número de registro em uma determinada tabela. Retorna um INT |
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

# Inputters e Resolvers
Inputters e Resolvers são funções que tratam os valores de entrada ou saída das consultas SQL quando nos utilizamos dos métods insert, update ou select (where).

É possível definir um inputter ou resolver para cada campo de cada tabela manipulando os dados antes que sejam inseridos ou retornados em uma consulta. O exemplo a seguir mostra um inputter que converte toda entrada de formato objeto para uma string, tornando mais simples o processo de armazenamento de um dado complexo.

Suponhamos uma seguinte tabela `clients` em nossa base de dados:
| Campo | Tipo |
| --- | --- |
| ID | number |
| name | String |
| options | String |
| width | number |
| hight | number |

Neste caso queremos armazenar no campo `options` um objeto convertido em uma string (stringfy). Para simplificar o processo de escrita e centralizar o método de validação de dado de entrada podemos criar um inputter para este campo.

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
Agora podemos fazer uma entrada direta de um objeto tendo a certeza de que uma regra de validação será aplicada a ele sempre que os métodos insert ou update forem chamados.
```javascript
let values = {
    name: "Maria",
    options: {color: "blue", size: "small"},
    width: 2,
    height: 3
}

db.insert("clients", values);
```
Neste caso seria ideal também criar um resolver para que o valor extraido seja automaticamente convertido para um objeto.
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
Alem disso é possível criar um resolver para retornar um campo adicional calculado a partir de outrs dados da mesma linha de consulta.
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
> Nota: nesta versão resolvers e inputters não funcionam de modo assincrono, ou seja, não podem retornar uma promisse. Esta funcionalidade deve ser aplicada em breve.