const mysql = require('mysql');
const debug = require('@goori-soft/logger');
const defaultConfig = require('./lib/config.js');
const types = require('./lib/types');
const clone = require('./lib/clone');

debug.setConfig({
    debugForFile: true,
    filename: 'sql-query-log.log',
});

/**
 * Retorna o tamanho definido para este campo.
 * Caso seja um campo no qual o tamanho não é definido a função retorna null
 * @param {*} fieldType 
 */
function getSizeFromField(fieldType){
    if(typeof(fieldType) == 'object'){
        if(!fieldType['Type']) return null;
        fieldType = fieldType['Type'];
    }

    let parts = fieldType.split("(");
    if(parts.length <= 1){
        return null;
    }

    let size = parts[1].split(")")[0];
    if(size.indexOf(",") === -1){
        size = parseInt(size);
    }
    return size;
}

/**
 * Retorna o tipo de campo declarado na query SQL
 * @param {Object | String} fieldType 
 */
function getTrueTypeFromField(fieldType){
    if(typeof(fieldType) == 'object'){
        if(!fieldType['Type']) return 'VARCHAR';
        fieldType = fieldType['Type'];
    }

    let type = fieldType.split("(")[0].toUpperCase();
    if(type.indexOf(' ') != -1){
        type = type.split(' ')[0];
    }
    let types = Database.types;
    if(!types.numbers.includes(type) && !types.strings.includes(type) && !types.floats.includes(type) && !types.dates.includes(type)){
        return 'VARCHAR';
    }

    return type;
}

/**
 * Retorna o tipo de dado que deve ser levado em conta no momento de formar uma query.
 * Deste modo a função só retorna três valores possíveis: string, number ou date
 * @param {*} fieldType 
 */
function getTypeFromField(fieldType){
    if(typeof(fieldType) == 'object'){
        if(!fieldType['Type']) return 'string';
        fieldType = fieldType['Type'];
    }

    //tenta capturar somente a parte textual do tipo, sem o comprimento
    let type = fieldType.split("(")[0];
    if(typeof(type) != 'string') return 'string';
    type = type.toLowerCase();

    //todos os tipos que não são numericos no momento de formar uma query
    let s = ['char', 'varchar', 'tinytext', 'text',
            'blob', 'mediumtext', 'mediumblob', 'longtext',
            'longblob', 'decimal', 'date', 'datetime', 'timestamp','time'];
    
    //O tipo pode ser uma string ou date
    if(s.indexOf(type) != -1){
        s = ['date', 'datetime', 'timestamp','time'];
        if(s.indexOf(type) != -1){
            return 'date';    
        }
        return 'string';
    }

    return 'number';
}


function addSlash(value){
    if(value == null) return value;
    let regex = /(?<![\\])"/gm
    return value.toString().split(regex).join('\\"');
}

/**
 * A marior parte das funções em Database funciona de modo async
 * Neste caso as funções retornam uma Promisse além de suportar
 * como último parametro uma função de callback que é executada somente em caso de sucesso 
 */
class Database {
    
    /**
     * Variável de configuração
     * Não exclua nenhuma chave deste objeto,
     * os valores podem ser alterados, mas é mais recomendável alterar diretamente as
     * variáveis de ambiente em .env ou diretamente no servidor
     */
    config = {
        host: 'localhost',
        port: '3306',
        database: 'my_database',
        user: 'root',
        password: 'root',

        test: false,
        reconnect: false,
        reconnectTime: 0,
        maxCacheMemory: 20* 1000 * 1024, //20MB,

        unsafe: false,

        //inputterInWhereStatement: true,
    };

    status = 0; //indica que a base de dados está desconectada
    con = null;

    tables = [];
    schema = {};

    inputters = {};
    resolvers = {};

    //Armazena a promisse que esta a tentar uma conexão;
    currentConnectionAttempt = new Promise(()=>{});

    /**
     * O construtor atribui os valores de configuração e testa a conexão com a base de dados.
     * @param {Object} config 
     */
    constructor(config){
        this.setConfig(config);
        
        const _ = this;

        debug.log('Creating database instance...');
        this.setConnection();

        //caso DATABASE_TEST seja igual ou maior que 1 a conexão será estabelecida assim que a classe for instanciada
        if(this.config.test > 0){
            debug.debug('Testing database connection...');
            this.connect().then(() => {
                debug.debug('The connection with database is working fine!');
            }).catch((err)=>{
                debug.err('The database connection has been failed in the test. Try to change connection values and to restart the server.');
            });
        }
    }


    /**
     * Adiciona novas colunas em uma tabela
     * @param {String} tableName 
     * @param {Object} fields 
     * @param {Function} callback 
     */
    add = (tableName, fields, callback)=>{
        return new Promise((resolve, reject)=>{
            this.mountQuery.add(tableName, fields)
                .then(query=>{
                    this.query(query, callback).then(result=>{
                        resolve(result);
                        return;
                    }).catch(err=>{
                        debug.err(err);
                        reject(err);
                    });
                })
                .catch(err=>{
                    debug.warn(err);
                    if(typeof(callback) == 'function'){
                        callback(null);
                    }
                    resolve(null);
                    return;
                });
        });
    }

    cache = (config)=>{
        let defaultConfig = {
            maxTotalSize: this.config.maxCacheMemory
        }

        defaultConfig = Object.assign(defaultConfig, config);

        return cacheControllerConstructor(this, defaultConfig);
    }

    /**
     * Efetua a conexão com a base de dados;
     * por padrão esta conexão não é persistente, isso significa que a base de dados será
     * automaticamente desconectada depois de um período de tempo relativamente curto (alguns minutos).
     * Por esta razão este comando é chamado internamente sempre que a base de dados tenta executar uma nova consulta
     * Este comando retorna uma Promisse e por isso não pode ser utilizado de modo sincrono diretamente.
     * 
     * IMPORTANTE: no momento de realizar uma consulta ou uma conexão verifique se o código suporta uma chamada async
     */
    connect = (callback) => {
        //Não podemos simplesmente fazer uma tentativa de conexão com a base de dados conectada;
        if(this.status != Database.DISCONNECTED){
            debug.log('Waiting for an existing connection to the database...');

            this.currentConnectionAttempt.then(result =>{
                callback(result);
            });

            return this.currentConnectionAttempt;
        }

        debug.log('Starting a new connection to the database...');
        this.currentConnectionAttempt = new Promise((resolve, reject) => {
            //Indica que estamos tentando uma conexão, isso vai previnir qualquer outra tentativa de conexão
            this.status = Database.TRYING;
            
            this.con.connect( err =>{
                if(err){
                    //********** OPS! ALGO DEU ERRADO ***************/
                    let msg = 'Could not connect to the database';
                    
                    //Imprimi uma mensagem de erro na tela
                    //debug.debug('Actual state: ' +  this.con.state, {color: 'red'});
                    debug.error(msg, {color: 'red'});
                    this.status = Database.DISCONNECTED;

                    //Executa o reject;
                    reject(msg);
                }
                else{
                    //********** CONEXÃO BEM SUCEDIDA ***************/

                    //altera o status da conexão para indicar que a o objeto está conectado;
                    this.status = Database.CONNECTED;

                    debug.debug('Connection successfully established');

                    //Executa o callback caso seja uma função;
                    if(typeof(callback) == 'function'){
                        callback();
                    }

                    //Executa o resolver
                    resolve();
                }
            });
        });

        //Vamos retornar a promisse que criamos;
        return this.currentConnectionAttempt;
    }

    /**
     * Cria uma nova tabela na base de dados, se delta for verdadeiro e a tabela já existir os campos inexistentes serão criados
     * Campos já existentes serão ignorados
     * @param {String} tableName 
     * @param {Object} fields 
     * @param {Boolean} delta 
     * 
     * fields = {
     *    name: {
     *      ?name: 'name',
     *      ?type: string | text | varchar | char | boolean | float | int | etc..,
     *      ?length: 255,
     *      ?default: null,
     *      ?notNull: false,
     *      ?primary: true,
     *      ?flags: '',
     *      ?line: 'varchar(255) NOT NULL'
     *    }
     * }
     */
    create = (tableName, fields, delta, callback)=>{
        let tab = '    ';
        return new Promise((resolve, reject)=>{
            tableName = tableName.trim();

            this.tableExists(tableName).then((exists)=>{
                let query = '';
                if(exists){
                    //tabela já existe, vamos incluir os novos campos
                    if(delta){
                        
                        let msg = 'Table '+tableName+' already exists. The fields will be added in delta mode.';
                        debug.warn(msg);

                        this.add(tableName, fields, callback).then(result=>{
                            resolve(result);
                        }).catch(err=>{
                            reject(err);
                        });

                        return;
                    }
                    else{
                        let msg = 'It was not possible to create a table '+tableName.toUpperCase()+' because it already exists.';
                        debug.err(msg);
                        reject(msg);
                        return;
                    }
                }
                else{
                    
                    this.mountQuery.create(tableName, fields)
                        .then(query=>{
                            this.query(query, callback).then(result=>{
                                resolve(result);
                            }).catch(err=>{
                                reject(err);
                            });
                        })
                        .catch(err=>{
                            reject(err);
                        });

                    return;

                }
            }).catch((err)=>{
                debug.err(err);
                reject(err);
            })
        });
    }

    /**
     * Remove um ou mais registros de uma tabela de acordo com os parâmetros passados em where
     * @param {String} tableName 
     * @param {Object} where 
     * @param {Int} limit
     * @param {Function} callback 
     */
    delete = (tableName, where, options, callback)=>{
        return new Promise((resolve, reject)=>{
            this.mountQuery.delete(tableName, where, options)
                .then(query=>{

                    this.query(query, callback).then(result=>{
                        return resolve(result);
                    }).catch( err => {
                        return reject(err);
                    });

                    return;

                }).catch(err => {
                    return reject(err);
                });
        });
    }

    /**
     * Drops a table
     * @param {String} tableName 
     * @param {Function} callback 
     */
    drop = (tableName, callback)=>{
        return new Promise((resolve, reject)=>{
            this.mountQuery.drop(tableName)
                .then(query=>{
                    this.query(query, callback).then( result =>{
                        return resolve(result);
                    }).catch( err =>{
                        return reject(err);
                    });
                })
                .catch(err=>{
                    reject(err);
                })
        });
    }

    /**
     * Insert injeta um novo registro em uma tabela
     * Se value for um objeto um único registro será injetado,
     * se value for um array de objetos insert tentará inserir vários registros em uma única chamada
     */
    insert = (tableName, values, callback) =>{
        return new Promise((resolve, reject)=>{               
            this.mountQuery.insert(tableName, values)
                .then(query=>{
                    //Vamos fazer uma chamada para query e repassar o callbak
                    //Por isso não temos de nos preocupar em resolver este callback
                    //query dará um jeito nisso por nós;
                    this.query(query, callback).then( result =>{
                        return resolve(result);
                    }).catch( err =>{
                        return reject(err);
                    });
                })
                .catch(err=>{
                    return reject(err);
                });
            return;
        });
    }

    /**
     * Verifica se Database está conectado a base de dados
     * retorna 1 em caso positivo ou 0 em caso negativo
     */
    isConnected = () => {
        if(this.con == null) return 0;
        return this.status;
    }

    /**
     * Captura o schema de uma tabela específica
     * retorna um objeto com o seguinte modelo:
     * {
     *      table: 'user',
     *      fields: {
     *          id: {
     *              name: 'id',
     *              type: 'number',
     *              notNull: true,
     *              default: '',
     *              flags: 'AUTO_INCREMENT'
     *              line: 'int(6) NOT NULL AUTO_INCREMENT'
     *          }
     *      },
     *      keys: ['id']
     * }
     */
    getSchema = (tableName, callback)=>{
        return new Promise((resolve, reject) =>{
            let query = 'SHOW COLUMNS FROM `' + tableName + '`';

            /**
             * Se o schema já foi carregado antes vamos buscá-lo na memória de Database;
             * Caso haja uma alteração na estrutura da tabela quando o schema já estiver na memória;
             * tente Database.sync() ou Database.resetSchema()
             */
            if(typeof(this.schema[tableName]) != 'undefined'){
                if(typeof(callback) == 'function') callback(this.schema[tableName]);
                resolve(this.schema[tableName]);
                return;
            }

            this.query(query, (result)=>{
                let schema = {
                    table: tableName,
                    fields: {},
                    keys: []
                };
    
                for(let i in result){
                    let f = result[i];
                    let fieldName = f.Field;
                    let notNull = false;
                    let lineComp = '';
    
                    if(f.Null == 'NO'){
                        notNull = true;
                        lineComp = 'NOT NULL';
                    }
    
                    let field = {
                        name: fieldName,
                        type: getTypeFromField(f.Type),
                        notNull: notNull,
                        default: f.Default,
                        flags: f.Extra,
                        size: getSizeFromField(f.Type),
                        line: f.Type + ' ' + lineComp + ' ' + f.Extra,
                        autoIncrement: f.Extra.toLowerCase().indexOf('auto_increment') > -1 ? true : false,
                    }
    
                    schema.fields[fieldName] = field;
    
                    if(f.Key == 'PRI'){
                        schema.keys.push(fieldName);
                    }
                }

                this.schema[tableName] = schema;

                if(typeof(callback) == 'function') callback(schema);
                
                resolve(schema);
                return;

            }).catch((err)=>{
                let msg = '. An internal failure prevented the table schema from loading: ' + tableName;
                reject(err + msg);
                return;
            });
        });
    }

    /**
     * Carrega um array com todas as tabelas disponíveis
     * por padrão tabelas que iniciam com _ (underscore) não são listadas
     * para visualizar estas tabelas hidden deve ser igual a true,
     * 
     * Se as tabelas já foram carregadas anteriormente apenas deve retornar o array que está na memória
     * Para forçar uma nova consulta a base de dados utiliza force = true
     */
    getTables = (hidden, force, callback)=>{ 
        return new Promise((resolve, reject)=>{
            
            //Verificando se podemos retornar o que está na memória
            if(this.tables.length > 0 && !force){
                //As tabelas já foram carregadas anteriormente e force é falso
                //logo vamos retornar o array que encontramos aqui;
                let tables = this.tables;

                //se hidden for true vamos retornar o array completo
                if(!hidden) {
                    //se visible for falso vamos retornar somente as tabelas visíveis
                    tables = this.tables.filter((tb)=>{
                        //Indintificando uma tabela escondida
                        if(tb.indexOf('_') === 0) return false;

                        //A tabela é comum
                        return true;
                    });
                }

                if(typeof(callback) == 'function') callback(tables);
                resolve(tables);

                return;
            }

            //Vamos ter de fazer uma consulta na base de dados para carregar as informações na memória
            let query = 'SHOW TABLES';
            this.query(query, (result, fields)=>{
                let fieldName = fields[0].name;
                let tables = [];
                for(let i in result){
                    let tableName = result[i][fieldName];
                    tables.push(tableName);
                }

                //Vamos colocar o resultado da nossa pesquisa na memória;
                //Aqui vamos colocar também as tabelas ocultas
                this.tables = tables;

                //se hidden for true vamos retornar o array completo
                if(!hidden){
                   //se visible for falso vamos retornar somente as tabelas visíveis
                    tables = this.tables.filter((tb)=>{
                        //Indintificando uma tabela escondida
                        if(tb.indexOf('_') === 0) return false;

                        //A tabela é comum
                        return true;
                    }); 
                }

                if(typeof(callback) == 'function') callback(tables);
                resolve(tables);

                return;

            }).catch((err)=>{
                debug.err(err);
                reject(err);
            });
        });
    }

    /**
     * Monta um order by statement para complementar uma query em um schema.
     * NOTA: A string já vem com os Key words 'ORDER BY' no início e 'ASC' ou 'DESC' no final
     * @param {String} field 
     * @param {Object} schema 
     * @param {Object} options 
     */
    mountOrderStatement = (field, schema, options)=>{
        options = options || {};
        let orderSt = '';
        field = field.toLowerCase();

        let fieldNames = [];
        for(let i in schema.fields){
            fieldNames.push(i.toLowerCase());
        }

        if(fieldNames.includes(field)){
        //if(typeof(schema.fields[field]) != 'undefined'){
            if(typeof(options.order) == 'string') options.order = options.order.toUpperCase();
            let asc = options.order != 'DESC' ? 'ASC' : 'DESC';
            orderSt = ' ORDER BY `' + field + '` ' + asc;
        }

        return orderSt;
    }

    /**
     * Retorna um objeto com uma série de strings a serem utilizadas na montagem de uma query
     * @param {Object} options 
     * @param {Table Schema} schema 
     */
    mountOptions = (options, schema)=>{
        const st = {
            limit: '',
            offset: '',
            orderBy: '',
        }
    
        options = options || {};
        if(typeof(options) != 'object'){
            options = {
                limit: options
            };
        }

        if(typeof(options.order) == 'string') options.order.toUpperCase();

        if((typeof(options.limit) == 'number' || !isNaN(options.limit)) && options.limit > 0){
            st.limit = ' LIMIT ' + parseInt(options.limit) + ' ';
        }

        if((typeof(options.offset) == 'number' || !isNaN(options.offset)) && options.offset > 0){
            st.offset = ' OFFSET ' + parseInt(options.offset) + ' ';
        }

        if(typeof(options.orderBy) == 'string'){
            st.orderBy = this.mountOrderStatement(options.orderBy, schema, options);
        }

        return st;

    }

    /**
     * Objeto que agrupa uma serie de construtores de query (insert, update, select, etc);
     */
    mountQuery = {
        add: (tableName, fields)=>{
            fields = clone(fields);

            return new Promise((resolve, reject)=>{
                this.getSchema(tableName).then(schema=>{
                    //remove todos os campos que já estejam declarados
                    for(let i in schema.fields){
                        let name = i;
                        if(typeof(fields[i]) != 'undefined'){
                            if(typeof(fields[i].name) == 'string'){
                                name = fields[i].name;
                            }
                            if(name == i){
                                delete fields[i];
                            }
                        }
                    }

                    let definitions = [];
                    let columnNames = [];

                    for(let i in fields){
                        let name = typeof(fields[i].name) == 'string' ? fields[i].name : i;
                        fields[i].name = name;
                        let st = Database.stDefinition(fields[i]);
                        if(st != null && !columnNames.includes(name)){
                            columnNames.push(name);
                            definitions.push('ADD COLUMN ' + st);
                        }
                    }

                    if(definitions.length > 0){
                        let query = 'ALTER TABLE `' + tableName + '` ' + '\n' + definitions.join(', ' + '\n');
                        return resolve(query);
                    }
                    else{
                        let msg = 'No valid columns were found to be add in ' + tableName.toUpperCase();
                        return reject(msg);
                    }

                })
                .catch(err=>{
                    reject(err);
                })
            });
        },

        create: (tableName, fields)=>{
            fields = clone(fields);
            
            return new Promise((resolve, reject)=>{
                let tab = '    ';

                //validateName;
                if(!Database.validadeName(tableName)){
                    let err = 'It\'s not possible to construct a query because table name is not a valid value';
                    debug.debug(err);
                    reject(err);
                    return;
                }

                tableName = tableName.trim();

                //verifica se fields é um objeto
                if(typeof(fields) != 'object' || fields == null){
                    let err = 'It\'s not possible to construct a query because FIELDS is a empty object';
                    debug.debug(err);
                    reject(err);
                    return;
                }

                //tabela não exists, vamos criar uma tabela nova
                let query = 'CREATE TABLE IF NOT EXISTS `'+tableName+'` (';
                let createDefinitionArray = [];
                let fieldsCount = 0;
                let columnNames = [];

                for(let i in fields){

                    if(!fields[i].name) fields[i].name = i;

                    let def = Database.stDefinition(fields[i]);
                    if(def){
                        let name = fields[i].name;
                        if(!columnNames.includes(name)){
                            columnNames.push(name);
                            createDefinitionArray.push(def);
                            fieldsCount++;
                        }
                    }
                }

                if(fieldsCount <= 0){
                    let err = 'It\'s not possible to create a query because no valid fields were found for this table';
                    debug.debug(err);
                    reject(err);
                    return;
                }

                query += '\n' + tab + createDefinitionArray.join(',' + '\n' + tab) + '\n';
                query += ')';

                return resolve(query);
            });
        },

        delete: (tableName, where, options)=>{
            return new Promise((resolve, reject)=>{
                this.getSchema(tableName).then((schema)=>{
                    let st = this.mountOptions(options, schema)

                    /**
                     * Monta uma string (statement where) na qual a palavra WHERE já vem inserida no início
                     * NOTA: qualquer indice de where que não esteja no schema será ignorado
                     */
                    let whereSt = this.mountWhereStatement(where, schema, options);

                    let query = 'DELETE FROM `' + tableName +  '` ' + whereSt + st.limit;
                    
                    return resolve(query);
                })
                .catch(err=>{
                    reject(err);
                });
            });
        },
        
        drop: (tableName)=>{
            return Promise.resolve('DROP TABLE `' + tableName + '`');
        },

        insert: (tableName, values)=>{
            values = clone(values);

            return new Promise((resolve, reject)=>{
                //Reservada para guardar as mensagens de erro que por ventura podemos encontrar na montagem da query;
                const errors = [];
                
                //reservado para os grupos de valores
                //Podemos inserir mais de um registro, basta inserir um array com os objetos de registro em values;
                let valuesGroup = [];
                if(values instanceof Array){
                    valuesGroup = values;
                }
                else if(typeof(values) == 'object'){
                    valuesGroup.push(values);
                }
                else{
                    let msg = 'The insert command failed because the values ​​parameter must be an object or an array of objects';
                    reject(msg);
                    return;
                }
    
                /**
                 * getSchema deve retornar o schema da tabela desejada
                 * Em geral este schema já estará carregado na memória,
                 * por isso esta promisse não dever ter um tempo de retorno longo
                 */
                this.getSchema(tableName).then((schema)=>{   
                    /**
                     * Vamos fazer uma primeira varredura em Values Group.
                     * Nesta varredura vamos 
                     */
                    let requiredFields = {};
    
                    valuesGroup = valuesGroup.map((valuesObject) => {
                        //Caso os valores não tenham sido assinados dentro de um objeto ou array
                        //Vamos ignorar este valores e retornar null, depois vamos filtrar o array para remover os nulls
                        if(typeof(valuesObject) != 'object' && typeof(valuesObject) != 'array') {
                            errors.push('One of the entered values ​​is not a valid object');
                            return null;
                        }
    
                        //Caso o valor seja totalmente null
                        if(valuesObject === null){
                            errors.push('One of entered values ​​is null');
                            return null;
                        }
    
                        //Reservado para o valor de retorno deste callback
                        let returnValues = {};
                        
                        //Vamos processar os inputters para esta tabela e estes valores de inserção;
                        valuesObject = this.processInputters(tableName, valuesObject);

                        //Vamos fazer uma varredura nos valores de uma inserção;
                        for(let i in valuesObject){
                            //vamos verificar se o campo existe
                            if(typeof(schema.fields[i]) != 'undefined'){
                                //vamos assinar este campo para sabermos que ele está sendo utilizado
                                requiredFields[i] = schema.fields[i];
    
                                //vamos normalizar o valor deste campo, incluindo aspas se necessário;
                                let q = '';
                                if(schema.fields[i].type == 'string' && valuesObject[i] != null){
                                    q = '"'; //caso o tipo seja string vamos inserir aspas para garantir que o valor seja normalizado
                                }
                                else if(valuesObject[i] == null){
                                    q = '';
                                    valuesObject[i] = 'NULL';
                                }
                                else if(schema.fields[i].type == 'date' && typeof(valuesObject[i]) == 'string' && valuesObject[i].toUpperCase() != 'NULL' && valuesObject[i].toUpperCase() != 'DEFAULT' && isNaN(valuesObject[i])){
                                    q = '"'; //o tipo de valor é uma data e o valor é uma string válida
                                    valuesObject[i] = Database.toDateTime(valuesObject[i]);
                                }
    
                                returnValues[i] = q + addSlash(valuesObject[i]) + q;
                            }
                        }
    
                        return returnValues;
                    })
                    //Vamos aplicar um filtro para simplesmente remover os valores nulos
                    .filter((valuesObject)=>{
                        if(!valuesObject || valuesObject == null) return false;
                        
                        let count = 0;
                        for(let i in valuesObject){
                            count++;
                        }
                        if(count == 0){
                            errors.push('One of the objects does not have any valid fields.');
                            return false;
                        }
                        return true;
                    })
                    //vamos fazer uma nova varredura para inserir DEFAULT nos campos faltantes
                    .map((valuesObject)=>{
                        for(let i in requiredFields){
                            if(typeof(valuesObject[i]) == 'undefined'){
                                if(requiredFields[i].default == null){
                                    if(requiredFields[i].notNull){
                                        //Se um campo não tem valor padrão e ao mesmo tempo não pode ser nullo este registro não deve ser inserido;
                                        errors.push('A record was skipped. The field `' + i + '` has no default value and cannot be null.');
                                        return null;
                                    }
                                    else{
                                        valuesObject[i] = 'NULL'
                                    }
                                }
                                else{
                                    valuesObject[i] = 'DEFAULT'
                                }
                            }
                        }
                        return valuesObject;
                    });
    
                    //Teoricamente o objeto valuesGroup deve estar totalmente normalizado aqui.
                    let fields = [];
                    for(let i in requiredFields){
                        let q = "`";
                        fields.push(q + requiredFields[i].name + q);
                    }
    
                    let valuesString = valuesGroup.map((valuesObject)=>{
                        //Algum registro ainda pode ter sido ignorado no último filtro e retornado o valor nullo
                        if(valuesObject){
                            let returnString = [];
                            for(let i in requiredFields){
                                returnString.push(valuesObject[i]);
                            }
                            return "(" + returnString.join(", ") + ")";
                        }   
                        return null;
                    })
                    .filter(v => {
                        if(v) return true;
                        return false;
                    });
    
                    //Se valuesString não possuir nenhum item, significa dizer que houve erros no momento de montar todas as querys
                    if(valuesString.length <= 0){
                        reject('One or more errors may have prevented the assembly of the insertion query. ' + errors.join(' '));
                        return;
                    }
    
                    let query = 'INSERT INTO `'+tableName+'` ('+ fields.join(", ") +') VALUES ' + valuesString.join(", ");

                    return resolve(query);
                })
                .catch(err=>{
                    reject(err);
                });
            });
        },
        
        select: (tableName, where, options)=>{
            return new Promise((resolve, reject)=>{
                this.getSchema(tableName).then(schema => {

                    let st = this.mountOptions(options, schema);
    
                    /**
                     * Monta uma string (statement where) já com a palavra WHERE inserida no início
                     * NOTA: qualquer indice de where que não esteja presente no schema será ignorado
                     */
                    let whereSt = this.mountWhereStatement(where, schema, options);
    
                    let query = 'SELECT * FROM `' + tableName + '` ' + whereSt + st.orderBy + st.limit + st.offset;
                    return resolve(query);
                })
                .catch(err=>{
                    return reject(err);
                });
            });
        },

        update: (tableName, values, where, options)=>{
            values = clone(values);

            return new Promise((resolve, reject)=>{
            
                //Se os valores não forem um objeto válido o update deve falhar 
                if(typeof(values) != 'object' || values == null){
                    let msg = 'To use UPDATE the values ​​must be an object with an index value, which is not the case.';
                    return reject(msg);
                }

                /**
                 * getSchema deve retornar o schema da tabela desejada
                 * Em geral este schema já estará carregado na memória,
                 * por isso esta promisse não dever ter um tempo de retorno longo
                 */
                this.getSchema(tableName).then((schema)=>{
                    let st = this.mountOptions(options, schema);
                    /**
                     * Vamos fazer uma varredura nos valores e verificar se seus indices estão no schema da tabela
                     * indices que não estiverem no schema serão simplesmente ignorados
                     */

                    //Vamos processar os inputters para esta tabela e estes valores de inserção;
                    values = this.processInputters(tableName, values);
                    
                    let updateValues = [];
                    for(let i in values){
    
                        //verificando se este campo existe no schema;
                        if(typeof(schema.fields[i]) != 'undefined'){
    
                            //verificando se será necessário incluir aspas no valor
                            let q = '';
                            if(schema.fields[i].type == 'string' && values[i] != null){
                                q = '"'; //caso o tipo seja string vamos inserir aspas para garantir que o valor seja normalizado
                            }
                            else if(values[i] == null){
                                q = '';
                                values[i] = 'NULL';
                            }
                            else if(schema.fields[i].type == 'date' && typeof(values[i]) == 'string' && values[i].toUpperCase() != 'NULL' && values[i].toUpperCase() != 'DEFAULT' && isNaN(values[i])){
                                q = '"'; //o tipo de valor é uma data e o valor é uma string válida
                                values[i] = Database.toDateTime(values[i]);
                            }
                            
                            //cria uma linha de update
                            let st = '`' + i +'` = ' + q + addSlash(values[i]) + q;
                            updateValues.push(st);
                        }
                    }
    
                    if(updateValues.length <= 0){
                        let msg = 'UPDATE failed because the VALUES parameter does not contain valid fields.';
                        debug.err(msg);
                        return reject(msg);
                    }
    
                    let updateSt = ` SET ${updateValues.join(', ')}`;
                    
                    /**
                     * Monta uma string (statement where) baseado nos parametros passados anteriormente;
                     * Este método já inclui a palavra WHERE no início da string
                     */
                    let whereSt = this.mountWhereStatement(where, schema, options);
    
                    let query = 'UPDATE `' + tableName + '` ' + updateSt + whereSt + st.limit;
                    
                    return resolve(query);
                })
                .catch(err=>{
                    rejetc(err);
                });
            });
        }
    }

    /**
     * Monta um where statement para complementar uma query baseado em um schema. Qualquer valor de where que não esteja em schema será ignorado,
     * exceto se where for uma string, neste caso o retorno será igual a entrada do parâmentro where.
     * NOTA: a string já vem com o keyword WHERE no inicio.
     * 
     * @param {Object | String} where 
     * @param {Object} schema 
     */
    mountWhereStatement = (where, schema, options)=>{
        let tableName = schema.table;

        options = options || {};
        let whereValues = [];
        if(typeof(where) == 'object'){
            for(let i in where){
                //verificando se este campo existe no schema;
                if(typeof(schema.fields[i]) != 'undefined'){

                    let q = '';
                    if(where[i] == null){
                        let st = '`' + i +'` IS NULL ';
                        whereValues.push(st);
                    }
                    else if(schema.fields[i].type == 'string'){
                        q = '"';
                        let st = '';

                        if(Array.isArray(where[i])){
                            where[i] = where[i]
                                .filter(value=>{
                                    if(value == null) return true;
                                    if(typeof(value) == 'object' || typeof(where[i]) == 'symbol' || typeof(where[i]) == 'undefined') return false;
                                    return true;
                                })
                                .map(value=>{
                                    if(value == null) return 'NULL';
                                    return q + addSlash(value) + q;
                                })
                                .join(", ");

                            if(where[i].trim() != ''){
                                st = '`' + i +'` IN (' + where[i] + ')';
                                whereValues.push(st);
                            }
                        }
                        else if(typeof(where[i]) != 'object' && typeof(where[i]) != 'symbol' && typeof(where[i]) != 'undefined'){
                            st = '`' + i +'` = ' + q + addSlash(where[i]) + q;
                            whereValues.push(st);
                        }
                    }
                    else if(schema.fields[i].type == 'date'){
                        q = '"';
                        let st = '';
                        if(!isNaN(where[i])){
                            st = '`' + i +'` = ' + where[i];
                            whereValues.push(st);
                        }
                        if(where[i].toUpperCase() == 'NULL'){
                            st = '`' + i +'` IS NULL ';
                            whereValues.push(st);
                        }
                        else if(where[i].toUpperCase() != 'DEFAULT'){
                            st = '`' + i +'` = ' + q + addSlash(Database.toDateTime(where[i])) + q;
                            whereValues.push(st);
                        }
                    }
                    else if(schema.fields[i].type == 'number'){
                        let st = '';
                        if(!isNaN(where[i])){
                            st = '`' + i +'` = ' + where[i];
                            whereValues.push(st);
                        }
                        else if(Array.isArray(where[i])){
                            where[i] = where[i]
                                .filter(value=>{
                                    if(isNaN(value)) return false;
                                    return true;
                                })
                                .map(value=>{
                                    if(value == null) return "NULL";
                                    return value;
                                })
                                .join(", ");
                            
                            if(where[i].trim() != ''){
                                st = '`' + i +'` IN (' + where[i] + ')';
                                whereValues.push(st);
                            }
                        }
                    }
                }
            }
        }
        else if(typeof(where) == 'string'){
            whereValues.push(where);
        }

        let whereSt = '';
        if(typeof(options.operator) == 'string'){ 
            options.operator = options.operator.toUpperCase();
        }

        let whereOperator = options.operator == 'OR' ? 'OR' : 'AND';
        if(whereValues.length > 0){
            whereSt = ` WHERE ${whereValues.join(' ' + whereOperator+ ' ')} `;
        }

        return whereSt;
    }

    /**
     * Processa um objeto de valores sobre os inputters definidos
     * @param {String} tableName 
     * @param {Object} values 
     */
    processInputters = (tableName, values) => {
        tableName = tableName.toLocaleLowerCase();
        let originalValues = values;
        values = clone(values);
        if(!this.inputters[tableName]) return values;

        let inputters = this.inputters[tableName];

        for(let i in values){
            let fieldName = i.toLocaleLowerCase();
            if(typeof(inputters[fieldName]) == 'function'){
                values[i] = inputters[fieldName](values[i], clone(originalValues));
            }
        }

        return values;
    }

    processResolvers = (tableName, values) => {
        //reduzir o nome dos campos para minusculo
        let fieldNamesNorm = {};
        for(let i in values){
            let fieldName = i.toLocaleLowerCase();
            fieldNamesNorm[fieldName] = i;
        }

        tableName = tableName.toLowerCase();
        let originalValues = clone(values);
        values = clone(values);
        if(!this.resolvers[tableName]) return values;

        let resolvers = this.resolvers[tableName];

        for(let i in resolvers){
            let fieldName = fieldNamesNorm[i];
            if(!fieldName) fieldName = i;
            let func = resolvers[i];
            if(typeof(func) == 'function'){
                values[fieldName] = func(originalValues[fieldName], clone(originalValues));
            }
        }

        return values;
    }

    /**
     * Executa uma query SQL, essa função também faz uma conexão automática com a base de dados
     * caso a conexão tenha sido perdida pelo tempo de espera.
     * 
     * @query String
     * 
     * db.query('SELECT * FROM my_table');
     */
    query = (query, callback) =>{
        return new Promise((resolve, reject) => {
            ///Verifica se a base de dados está conectada, caso contrário tenta uma conexão
            if(!this.isConnected()){
                debug.blank();
                debug.warn('Trying to run a query, but the system is disconnected from the database. Starting a forced connection...', {color: 'yellow'});
                this.connect(()=>{

                    //Note que esta é uma chamada recursiva e estamos repassando o callback
                    //por isso ele será resolvido nesta nova chamada e não deve ser resolvido novamente aqui dentro.
                    this.query(query, callback).then((result)=>{
                        //Executa o resolver caso a query tenha sido realizada com sucesso;
                        //repassando os paramentros recebidos desta nova query

                        resolve(result);

                        //Neste caso não precisamos executar o callbak pois ele já será executado pela nova chamada;
                        //Do contrário fariamos uma chamada dupla de callback, uma aqui e outra no sucesso da query;
                    }).catch((err)=>{
                        //Executamos o reject caso a query tenha falahdo
                        reject(err);
                    });
                }).catch(err=>{
                    reject(err);
                });
            }
            else{
                //Aqui vamos tentar executar a query
                this.con.query(query, (err, result, fields)=>{
                    if(!err){
                        if(typeof(callback) == 'function'){
                            callback(result, fields);
                        }

                        resolve(result);
                    }
                    else{
                        //Algum erro ocorreu vamos ver o que é;
                        reject(err);
                    }
                });
            }
        });
    }

    /**
     * Limpa o schema da memória forçando o carregamento de um novo schema quando necessário
     */
    resetSchema = ()=>{
        this.schema = {};
        return true;
    }

    /**
     * Realiza uma busca em uma determinada tabela
     * @param {String} tableName 
     * @param {String | Object | Any} term 
     * @param {Function} callback 
     */
    search = (tableName, term, options, callback)=>{
        /*******************************/



        /*******************************/
    }

    /**
     * Captura um ou mais registros de uma tabela obedecendo os parametros passados em where
     * Alias: where();
     * @param {String} tableName 
     * @param {Object} where 
     * @param {Object} options
     * @param {Function} callback 
     */
    select = (tableName, where, options, callback)=>{
        return this.where(tableName, where, options, callback);
    }

    /**
     * Grava os valores de configuração dentro de Database;
     * Note que somente os valores listados em Database.config serão setados
     * Valores fora desta lista serão ignorados
     */
    setConfig = (config)=>{
        for(var i in this.config){
            if(typeof(config[i]) != 'undefined'){
                this.config[i] = config[i];
            }
        }

        return this.config;
    }

    /**
     * setConnection cria o arquivo de coneção baseado no arquivo de configuração
     * também inicia a função connect caso as variáveis de configuração permitam
     */
    setConnection = () => {
        this.status = Database.DISCONNECTED; //indica que não há conexão ativa;
        this.con = mysql.createConnection(this.config);

        const obj = this;

        this.con.on('error', function onError(err){
            let red = {color: 'red'};
            if(err.code == 'PROTOCOL_CONNECTION_LOST'){
                debug.log('Conexão com a base de dados foi perdida.', red);
                debug.log('Tentando nova conexão...', red);

                //criando uma nova instância de conexão
                //Este comando já é capaz de setar o estado atual para desconectado
                obj.setConnection();
                
                //Se houver um pedido de reconnect vamos efetuar automaticamente a conexão.
                //Este pedido não é estritamente necessário pois uma conexão é efetuada sempre que a query é chamada
                if(obj.config.reconnect){
                    debug.log('Recriando objeto de conexão em ' + obj.config.reconnectTime + ' segundos...');
                    setTimeout(() => {
                        
                        if(obj.status != Database.DISCONNECTED){
                            obj.connect();
                            return;
                        }

                    }, obj.config.reconnectTime * 1000);
                }
            }
            else{
                debug.err(err.code);
            }
        });
    }

    /**
     * Cria um inputter para um determinado campo de uma tabela. O inputter é uma função evocada antes que uma atualização aconteça na tabela.
     * Nota: O inputter pode alterar o valor de um campo antes que ele seja adicionado. o inputter recebe dois parametros de entrada (value, row).
     * @param {String} tableName 
     * @param {String} fieldName 
     * @param {Function} inputter 
     */
    setInputter = (tableName, fieldName, inputter)=>{
        tableName = tableName.toLocaleLowerCase();
        fieldName = fieldName.toLocaleLowerCase();

        if(typeof(inputter) == 'function'){
            if(!this.inputters[tableName]){
                this.inputters[tableName] = {};
            }

            this.inputters[tableName][fieldName] = inputter;
        }

        return this;
    }

    /**
     * Cria um resolver para um determinado campo de uma tabela. Este resolver é responsável por processar a saída
     * Nota: A função resolver recebe dois parametros de entrada (value, row), o valor do campo e todos os valores da linha que foram carregados
     * 
     * @param {String} tableName 
     * @param {String} fieldName 
     * @param {Function} resolver 
     */
    setResolver = (tableName, fieldName, resolver)=>{
        tableName = tableName.toLocaleLowerCase();
        fieldName = fieldName.toLocaleLowerCase();
 
        if(typeof(resolver) == 'function'){
            if(!this.resolvers[tableName]){
                this.resolvers[tableName] = {};
            }

            this.resolvers[tableName][fieldName] = resolver;
        }
 
        return this;
    }

    /**
     * Captura todo o schema da base de dados, mesmo que ele já tenha sido carregado anteriormente
     * Se você deseja apenas limpar a memória do schema utilize Database.resetSchema();
     * 
     * Se hidden for igual a true sync carregará também tableas ocultas (que iniciam com _);
     */
    sync = (hidden)=>{
        return new Promise((resolve, reject)=>{

            //Vamos forçar um novo carregamento das tabelas que estão no sistema
            //Esse novo carregamento deve armazenar o nome das tabelas na memória do objeto
            this.getTables(hidden, true).then((tables)=>{
                
                //Counter vai receber o número total de promisses resolvidas que vamos montar para os schemas das tabelas
                //Quando counter atingir o número de tabelas saberemos que todas os schemas foram carregados
                var counter = 0;

                for(let i in tables){
                    let tableName = tables[i];
                    this.getSchema(tableName).then(()=>{
                        //Sempre que uma promisse for terminada vamos indicar isso no counter
                        counter++;
                        if(counter == tables.length){
                            resolve(this.schema);
                        }
                    }).catch(()=>{
                        //Sempre que uma promisse for terminada vamos indicar isso no counter
                        counter++;
                        debug.err('Sync has failed on loading schema from ' + tableName);
                        if(counter == tables.length){
                            resolve(this.schema);
                        }
                    });
                }
            }).catch(err => {
                debug.err(err);
                debug.err('Sync has failed for some reason...');
                reject(err);
            });
        });
    }

    /**
     * Verifica se uma determinada tabela existe.
     * Retorna uma promise. O resultado desta promisse é um valor booleano true | false
     * @param {String} tableName 
     */
    tableExists = (tableName)=>{
        return new Promise((resolve, reject)=>{
            this.getTables(true, false, (tables)=>{
                let e = tables.includes(tableName);
                resolve(e);
            }).catch(err=>{
                debug.err(err);
                reject(err);
            })
        });
    }

    /**
     * Faz uma atualização em algum ou alguns registros de uma tabela específica de acordo com os parametros passados em where 
     * @param {String} tableName 
     * @param {Object} values 
     * @param {Object} where 
     * @param {Function} callback 
     */
    update = (tableName, values, where, options, callback)=>{
        return new Promise((resolve, reject)=>{
            
            this.mountQuery.update(tableName, values, where, options)
                .then(query=>{
                
                    //Vamos fazer uma chamada para query e repassar o callbak
                    //Por isso não temos de nos preocupar em resolver este callback
                    //query dará um jeito nisso por nós;
                    this.query(query, callback).then( result =>{
                        return resolve(result);
                    }).catch(err=>{
                        debug.err(err);
                        return reject(err);
                    });

                    return;
                }).catch(err=>{
                    debug.err(err);
                    reject(err);
                });
        });
    }

    /**
     * Captura um ou mais registros de uma tabela obedecendo os parametros passados em where
     * @param {String} tableName 
     * @param {Object} where 
     * @param {Int} limit
     * @param {Function} callback 
     */
    where = (tableName, where, options, callback)=>{
        return new Promise((resolve, reject)=>{
            this.mountQuery.select(tableName, where, options)
                .then(query=>{
                    this.query(query, callback).then( result=>{

                        //cada linha retornada deve ser processada pelos resolvers
                        let finalResult = [];
                        for(let index in result){
                            let row = result[index];
                            row = this.processResolvers(tableName, row);
                            finalResult.push(row);
                        }
                        return resolve(finalResult);
                        //resolve(result);
                    }).catch(err=>{
                        debug.err(err);
                        reject(err);
                    });
                }).catch((err)=>{
                    debug.err(err);
                    reject(err);
                });
        });
    }

    /*** SEÇÃO ESTÁTICA ***/
    /**
     * Todas as funções a partir desta seção são estáticas e devem ser evocadas diretamente
     */

    static CONNECTED = 1;
    static DISCONNECTED = 0;
    static TRYING = 2;
    static states = {
        'disconnected': 0,
        'connected': 1,
        'trying': 2,

        0: 'disconnected',
        1: 'connected',
        2: 'trying'
    }
    
    /**
     * Cria uma nova instância de Database
     * se o parametro config for omitido os valores de configuração serão extraídos 
     * das cinfigurações de ambiente ou diretamente do arquivo .env (caso ambiente seja de desenvolvimento)
     * @param {} config 
     */
    static start = (config)=>{
        if(typeof(config) == 'undefined'){
            config = defaultConfig;
            debug.log('Taking standard connection values ​​from database...');
        }

        return new Database(config);
    }

    /**
     * Cria uma linha de Statement Definition para uma query Create, Alter, etc
     * Se encontrar algum erro ou inconsistência no objeto field a função retorna null
     * @param {Object} field 
     */
    static stDefinition = (field)=>{
        let defaultDef = {
            type: 'VARCHAR',
            size: null,
            notNull: false,
            autoIncrement: false,
            primary: false,
            st: '',
        }

        if(field == null || typeof(field) != 'object'){
            return null;
        }

        if(field.name == null || typeof(field.name) != 'string' || !Database.validadeName(defaultDef.name)){
            return null;
        }

        for(let index in field){
            defaultDef[index] = field[index];
        }

        if(typeof(defaultDef.line) == 'string'){
            defaultDef.type = getTrueTypeFromField(defaultDef.line);
        }

        defaultDef.stType = Database.stType(defaultDef.type, defaultDef.size);
        defaultDef.st = '';
        
        if(defaultDef.autoIncrement && Database.types.numbers.includes(defaultDef.type.toUpperCase())){
            defaultDef.st += ' AUTO_INCREMENT';
            defaultDef.primary = true;
        }
        
        if(defaultDef.default){
            let q1 = "";
            let q2 = "";
            if(Database.types.strings.includes(defaultDef.type.toUpperCase())){
                q1 = q2 = "'";
            }
            else if(Database.types.numbers.includes(defaultDef.type.toUpperCase()) || Database.types.floats.includes(defaultDef.type.toUpperCase())){
                if(isNaN(defaultDef.default)){
                    q1 = '(';
                    q2 = ')';
                }
            }
            else if(Database.types.dates.includes(defaultDef.type.toUpperCase())){
                if(defaultDef.default == "0000-00-00 00:00:00"){
                    defaultDef.default = 'NOW()';
                }

                if(defaultDef.default.indexOf('(') == -1){
                    q1 = q2 = "'";
                }
            }

            defaultDef.st += ' DEFAULT ' + q1 + defaultDef.default + q2;
        }

        if(defaultDef.notNull && !defaultDef.primary){
            defaultDef.st += ' NOT NULL';
        }
        
        if(defaultDef.primary){
            defaultDef.st += ' PRIMARY KEY';
        }

        let st = '`' + defaultDef.name + '` ' + defaultDef.stType + defaultDef.st;
        return st;
    }

    /**
     * Cria um statement para o tipo de campo,
     * pode ser utilizado para criar um novo campo ou alterar o valor de um campo
     * @param {String} type 
     * @param {Int} size 
     */
    static stType = (type, size)=>{
        if(typeof(type) == 'object'){
            let obj = type;
            type = obj.type;
            size = size ? size : obj.size;
        }


        let st = '';
        let stSize = '';

        type = type.toUpperCase();
        
        if(!isNaN(size)){
            size = Number(size);
        }

        if(typeof(size) == 'number' && parseInt(size) > 0){
            stSize = '('+parseInt(size)+')';
        }

        if(Database.types.numbers.includes(type) || Database.types.floats.includes(type)){
            st = type == 'NUMBER' ?'INT' : type;
            st += stSize;
        }
        else if(Database.types.strings.includes(type)){
            st = type == 'STRING' ? 'VARCHAR' : type;
            if(st == 'CAR' && size > 255){
                stSize = '(255)';
            }
            else if(st == 'VARCHAR' && size > 65535){
                stSize = '(65535)';
            }

            if((st == 'VARCHAR' || st == 'CHAR')){
                if(stSize == ''){
                    stSize = '(255)';
                }
                st += stSize;
            }
        }
        else if(Database.types.dates.includes(type)){
            st = type;
        }
        else{
            st = 'VARCHAR(255)';
        }

        return st;
    }

    /**
     * Determina se um nome de tabela ou campo é válido, ou seja,
     * pode ser utilizado em uma query
     * @param {String} name 
     */
    static validadeName = (name)=>{
        let regex = /[!@#\$%\^\&*\)\(+=.\-\'\"]/g;
        if(regex.test(name)){
            return false;
        }

        regex = /^[0-9]/g;
        if(regex.test(name)){
            return false;
        }

        return true;
    }

    /**
     * Converte um valor para uma string de data
     * @param {Any} value 
     */
    static toDateTime = (value)=>{
        let date = new Date();

        if(typeof(value) == 'string'){
            if(value.toUpperCase().trim() == 'NOW' || value.toUpperCase().trim() == 'NOW()'){
                //retorna a data atual do sistema;
                //nada faz;
            }
            else{
                date = new Date(value);
            }
        }
        else if(typeof(value) == 'object'){
            if(value instanceof Date) date = value;
        }
        else if(typeof(value) == 'number'){
            date = new Date(value);
        }

        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day = date.getDate();
        let hour = date.getHours();
        let minutes = date.getMinutes();
        let seconds = date.getSeconds();
        let offset = date.getTimezoneOffset()/60 * 100;

        return `${year}-${month}-${day} ${hour}:${minutes}:${seconds}`;
    }

    static types = types;
}

module.exports = Database;