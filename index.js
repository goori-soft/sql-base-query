const mysql = require('mysql');
const debug = require('@goori-soft/logger');
const defaultConfig = require('./lib/config.js');
const types = require('./lib/types');

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
    };

    status = 0; //indica que a base de dados está desconectada
    con = null;

    tables = [];
    schema = {};

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
                    let name = typeof(fields[i].name) == 'string'  ? fields[i].name : i;
                    fields[i].name = name;
                    let st = Database.stDefinition(fields[i]);
                    if(st != null && !columnNames.includes(name)){
                        columnNames.push(name);
                        definitions.push('ADD COLUMN ' + st);
                    }
                }

                if(definitions.length > 0){
                    let query = 'ALTER TABLE `' + tableName + '` ' + '\n' + definitions.join(', ' + '\n');
                    this.query(query, callback).then(result=>{
                        resolve(result);
                    }).catch(err=>{
                        debug.err(err);
                        reject(err);
                    });
                    return;
                }
                else{
                    let msg = 'No valid columns were found to be add in ' + tableName.toUpperCase();
                    debug.warn(msg);
                    resolve(null);
                    return;
                }

            }).catch(err=>{
                debug.err(err);
                reject(err);
            })
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
                    debug.debug('Actual state: ' +  this.con.state, {color: 'red'});
                    debug.debug(msg, {color: 'red'});
                    
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
                    //tabela não exists, vamos criar uma tabela nova
                    query = 'CREATE TABLE IF NOT EXISTS `'+tableName+'` (';
                    let createDefinitionArray = [];
                    let fieldsCount = 0;
                    let columnNames = [];

                    for(let i in fields){

                        let def = Database.stDefinition(fields[i]);
                        if(def){
                            let name = i;
                            if(fields[i].name){
                                name = fields[i].name;
                            }

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

                    this.query(query, callback).then(result=>{
                        resolve(result);
                    }).catch(err=>{
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
    delete = (tableName, where, limit, callback)=>{
        return new Promise((resolve, reject)=>{
            /**
             * getSchema deve retornar o schema da tabela desejada
             * Em geral este schema já estará carregado na memória,
             * por isso esta promisse não dever ter um tempo de retorno longo
             */
            this.getSchema(tableName).then((schema)=>{
                
                /**
                 * Monta uma string (statement where) na qual a palavra WHERE já vem inserida no início
                 * NOTA: qualquer indice de where que não esteja no schema será ignorado
                 */
                let whereSt = this.mountWhereStatement(where, schema);

                let limitString = '';
                if(typeof(limit) == 'number' || !isNaN(limit)){
                    limitString = ' LIMIT ' + parseInt(limit);
                }

                let query = 'DELETE FROM `' + tableName +  '` ' + whereSt + limitString;
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
     * Insert injeta um novo registro em uma tabela
     * Se value for um objeto um único registro será injetado,
     * se value for um array de objetos insert tentará inserir vários registros em uma única chamada
     */
    insert = (tableName, values, callback) =>{
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
                let msg = 'The insert command failed because the values ​​parameter must be an object or array of objects';
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

                    //Reservado para o valor de retorno deste callback
                    let returnValues = {};
                    
                    //Vamos fazer uma varredura nos valores de uma inserção;
                    for(let i in valuesObject){
                        //vamos verificar se o campo existe
                        if(typeof(schema.fields[i]) != 'undefined'){
                            //vamos assinar este campo para sabermos que ele está sendo utilizado
                            requiredFields[i] = schema.fields[i];

                            //vamos normalizar o valor deste campo, incluindo aspas se necessário;
                            let q = '';
                            if(schema.fields[i].type == 'string'){
                                q = '"'; //caso o tipo seja string vamos inserir aspas para garantir que o valor seja normalizado
                            }
                            else if(schema.fields[i].type == 'date' && typeof(valuesObject[i]) == 'string' && valuesObject[i].toUpperCase() != 'NULL' && valuesObject[i].toUpperCase() != 'DEFAULT' && isNaN(valuesObject[i])){
                                q = '"'; //o tipo de valor é uma data e o valor é uma string válida
                            }

                            returnValues[i] = q + valuesObject[i] + q;
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
                
                
                //Vamos fazer uma chamada para query e repassar o callbak
                //Por isso não temos de nos preocupar em resolver este callback
                //query dará um jeito nisso por nós;
                this.query(query, callback).then( result =>{
                    return resolve(result);
                }).catch( err =>{
                    return reject(err);
                });

                return;
                //Vamos fazer uma varredura em ValuesGroup para nos sertificarmos de que todos os grupos possuem os mesmos parametros,
                //do contrário vamos escrever o parametro faltante com o valor padrão

            }).catch((err)=>{
                let msg = 'The insert failed because the table schema could not be loaded: ' + tableName;
                debug.error(msg);
                reject(msg);
            });
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
     * Monta um where statement para complementar uma query baseado em um schema. Qualquer valor de where que não esteja em schema será ignorado,
     * exceto se where for uma string, neste caso o retorno será igual a entrada do parâmentro where.
     * NOTA: a string já vem com o keyword WHERE no inicio.
     * 
     * @param {Object | String} where 
     * @param {Object} schema 
     */
    mountWhereStatement = (where, schema)=>{
        let whereValues = [];
        if(typeof(where) == 'object'){
            for(let i in where){
                //verificando se este campo existe no schema;
                if(typeof(schema.fields[i]) != 'undefined'){

                    //verificando se será necessário incluir aspas no valor
                    let q = '';
                    if(schema.fields[i].type == 'string' && where[i] != null){
                        q = '"'; //caso o tipo seja string vamos inserir aspas para garantir que o valor seja normalizado
                    }
                    else if(schema.fields[i].type == 'date' && typeof(where[i]) == 'string' && where[i].toUpperCase() != 'NULL' && where[i].toUpperCase() != 'DEFAULT' && isNaN(where[i])){
                        q = '"'; //o tipo de valor é uma data e o valor é uma string válida
                    }
                    
                    if(where[i] == null) {
                        where[i] = 'NULL';
                        q = '';
                    }

                    //cria uma linha de update
                    let st = '`' + i +'` = ' + q + where[i] + q;
                    whereValues.push(st);
                }
            }
        }
        else if(typeof(where) == 'string'){
            whereValues.push(where);
        }

        let whereSt = '';
        if(whereValues.length > 0){
            whereSt = ` WHERE ${whereValues.join(' AND ')}`;
        }

        return whereSt;
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
                    this.query(query, callback).then((result, fields)=>{
                        //Executa o resolver caso a query tenha sido realizada com sucesso;
                        //repassando os paramentros recebidos desta nova query
                        resolve(result, fields);

                        //Neste caso não precisamos executar o callbak pois ele já será executado pela nova chamada;
                        //Do contrário fariamos uma chamada dupla de callback, uma aqui e outra no sucesso da query;
                    }).catch((err)=>{
                        //Executamos o reject caso a query tenha falahdo
                        reject(err);
                    });
                });
            }
            else{
                //Aqui vamos tentar executar a query
                this.con.query(query, (err, result, fields)=>{
                    if(!err){
                        if(typeof(callback) == 'function'){
                            callback(result, fields);
                        }
                        resolve(result, fields);
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
    renodeetSchema = ()=>{
        this.schema = {};
        return true;
    }

    /**
     * Realiza uma busca em uma determinada tabela
     * @param {String} tableName 
     * @param {String | Object | Any} term 
     * @param {Function} callback 
     */
    search = (tableName, term, callback)=>{
        /*******************************/



        /*******************************/
    }

    /**
     * Captura um ou mais registros de uma tabela obedecendo os parametros passados em where
     * Alias: where();
     * @param {String} tableName 
     * @param {Object} where 
     * @param {Int} limit
     * @param {Function} callback 
     */
    select = (tableName, where, limit, callback)=>{
        return this.where(tableName, where, limit, callback);
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
    update = (tableName, values, where, callback)=>{
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
                
                /**
                 * Vamos fazer uma varredura nos valores e verificar se seus indices estão no schema da tabela
                 * indices que não estiverem no schema serão simplesmente ignorados
                 */
                let updateValues = [];
                for(let i in values){

                    //verificando se este campo existe no schema;
                    if(typeof(schema.fields[i]) != 'undefined'){

                        //verificando se será necessário incluir aspas no valor
                        let q = '';
                        if(schema.fields[i].type == 'string'){
                            q = '"'; //caso o tipo seja string vamos inserir aspas para garantir que o valor seja normalizado
                        }
                        else if(schema.fields[i].type == 'date' && typeof(values[i]) == 'string' && values[i].toUpperCase() != 'NULL' && values[i].toUpperCase() != 'DEFAULT' && isNaN(values[i])){
                            q = '"'; //o tipo de valor é uma data e o valor é uma string válida
                        }
                        
                        //cria uma linha de update
                        let st = '`' + i +'` = ' + q + values[i] + q;
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
                let whereSt = this.mountWhereStatement(where, schema);

                let query = 'UPDATE `' + tableName + '` ' + updateSt + whereSt;
                
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
                //Vamos fazer uma varredura em ValuesGroup para nos sertificarmos de que todos os grupos possuem os mesmos parametros,
                //do contrário vamos escrever o parametro faltante com o valor padrão
            }).catch(err=>{
                let msg = 'Update has failed because the table schema could not be loaded: ' + tableName;
                debug.err(msg);
                reject(msg);
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
    where = (tableName, where, limit, callback)=>{
        return new Promise((resolve, reject)=>{
            this.getSchema(tableName).then(schema => {

                /**
                 * Monta uma string (statement where) já com a palavra WHERE inserida no início
                 * NOTA: qualquer indice de where que não esteja presente no schema será ignorado
                 */
                let whereSt = this.mountWhereStatement(where, schema);

                let limitString = '';
                if((typeof(limit) == 'number' || !isNaN(limit)) && limit > 0){
                    limitString = ' LIMIT ' + limit;
                }

                let query = 'SELECT * FROM `' + tableName + '` ' + whereSt + limitString;
                
                this.query(query, callback).then( result=>{
                    resolve(result);
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

    static types = types;
}

module.exports = Database;